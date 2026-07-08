/**
 * Fetch a frozen, reproducible held-out sample from the OpenPII validation split.
 *
 * The row *data* is a regenerable local artifact (gitignored); the committed
 * output is the manifest — dataset revision, seed, and the exact row `uid`s — so
 * the held-out set is pinned and any drift in the upstream dataset is detected
 * on the next fetch. Rows are restricted to the seven supported Latin-script
 * languages.
 *
 *   HF_TOKEN=... bun eval/bench/fetch.ts --n 5000 --seed 0 --concurrency 8
 *
 * The OpenPII dataset is public (CC BY 4.0), so HF_TOKEN is optional — it is
 * used when present (higher rate limits) and the anonymous datasets-server
 * endpoint is used otherwise.
 */

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DATASET = "ai4privacy/pii-masking-openpii-1.5m";
const SPLIT = "validation";
const LATIN = new Set(["en", "es", "fr", "de", "it", "pt", "nl"]);
const PAGE = 100;

export interface Row {
  uid: number;
  language: string;
  source_text: string;
  privacy_mask: { label: string; start: number; end: number; value: string }[];
}

export interface RawItem {
  row: { uid: number; language: string; source_text: string; privacy_mask: unknown };
}

export function arg(name: string, fallback: string, argv = Bun.argv): string {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  const idx = argv.indexOf(`--${name}`);
  const next = idx >= 0 ? argv[idx + 1] : undefined;
  return next && !next.startsWith("--") ? next : fallback;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Write with a couple of retries: the sandbox occasionally returns ETXTBSY/EBUSY. */
async function safeWrite(path: string, contents: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await writeFile(path, contents);
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
}

export async function getJson(url: string, token: string | undefined): Promise<any> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return await res.json();
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        await sleep(Math.max(retryAfter * 1000, 2000 * 2 ** attempt));
        continue;
      }
      process.stderr.write(`\n[fetch ${res.status}] ${url}\n`);
    } catch (e) {
      process.stderr.write(`\n[fetch error] ${String(e)}\n`);
    }
    await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`failed to fetch ${url}`);
}

/**
 * Collect the first `n` Latin rows by consuming offsets in the GIVEN order, fetching up to
 * `concurrency` pages concurrently but consuming results strictly in offset order so the
 * result is independent of completion order. `fetchPage(offset)` returns that page's raw
 * items. Throws if any consumed page rejects (errors are not swallowed).
 */
export async function collectRows(
  offsets: readonly number[],
  fetchPage: (offset: number) => Promise<RawItem[]>,
  n: number,
  isLatin: (lang: string) => boolean,
  concurrency: number,
): Promise<Row[]> {
  const inflight = new Map<number, Promise<RawItem[]>>(); // index -> page promise
  const selected: Row[] = [];
  const seen = new Set<number>();
  let nextLaunch = 0;
  const launch = (): void => {
    if (nextLaunch < offsets.length && inflight.size < concurrency && selected.length < n) {
      const idx = nextLaunch++;
      inflight.set(idx, fetchPage(offsets[idx]));
      launch(); // fill the window
    }
  };
  launch();
  for (let idx = 0; idx < offsets.length && selected.length < n; idx++) {
    const page = await inflight.get(idx)!; // rejects propagate — do not catch
    inflight.delete(idx);
    for (const item of page) {
      if (selected.length >= n) break;
      const r = item.row;
      if (!isLatin(r.language) || seen.has(r.uid)) continue;
      seen.add(r.uid);
      selected.push({ uid: r.uid, language: r.language, source_text: r.source_text, privacy_mask: r.privacy_mask as Row["privacy_mask"] });
    }
    launch(); // top up after consuming one
  }
  return selected;
}

async function main(): Promise<void> {
  const token = process.env.HF_TOKEN; // optional: public dataset, used for higher rate limits
  const n = Number(arg("n", "5000"));
  const seed = Number(arg("seed", "0"));
  const concurrency = Number(arg("concurrency", "8"));
  const dataPath = arg("out", "eval/bench/data/heldout.jsonl");
  const manifestPath = arg("manifest", "eval/bench/heldout.manifest.json");
  const split = arg("split", SPLIT); // "validation" (eval) or "train" (retrain data)

  const info = await getJson(`https://datasets-server.huggingface.co/size?dataset=${DATASET}`, token);
  const splitInfo = info.size.splits.find((s: any) => s.split === split);
  const total: number = splitInfo.num_rows;

  // Deterministic, shuffled offsets so the sample spans the split rather than
  // one contiguous (language-clustered) region.
  const rng = mulberry32(seed);
  const offsets = Array.from({ length: Math.ceil(total / PAGE) }, (_, i) => i * PAGE);
  for (let i = offsets.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
  }

  await mkdir(dirname(dataPath), { recursive: true });
  await safeWrite(dataPath, ""); // truncate

  const rowsUrl = (offset: number): string =>
    `https://datasets-server.huggingface.co/rows?dataset=${DATASET}&config=default&split=${split}&offset=${offset}&length=${PAGE}`;

  let reported = 0;
  const fetchPage = (offset: number): Promise<RawItem[]> =>
    getJson(rowsUrl(offset), token).then((p: any) => {
      process.stderr.write(`\rcollected ~${reported}/${n}`);
      if (!Array.isArray(p.rows)) throw new Error(`datasets-server returned no rows for offset ${offset}`);
      return p.rows;
    });

  const selected = await collectRows(offsets, fetchPage, n, (lang) => LATIN.has(lang), concurrency);
  reported = selected.length;
  process.stderr.write(`\rcollected ${selected.length}/${n}\n`);

  // Write rows in the collected (deterministic) order
  const data = selected.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await appendFile(dataPath, data);

  const byLang: Record<string, number> = {};
  for (const r of selected) byLang[r.language] = (byLang[r.language] ?? 0) + 1;

  const manifest = {
    dataset: DATASET,
    split: split,
    revision: info.size?.dataset ?? null,
    seed,
    languages: [...LATIN],
    rows: selected.length,
    by_language: byLang,
    uids: selected.map((r) => r.uid),
  };
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  try {
    await safeWrite(manifestPath, manifestJson);
    console.log(`wrote ${selected.length} rows -> ${dataPath}\nmanifest -> ${manifestPath}\nby language: ${JSON.stringify(byLang)}`);
  } catch {
    // Sandbox teardown can ETXTBSY the final write; emit the manifest so it can
    // be captured from stdout. The streamed data file is already complete.
    console.log(`MANIFEST_BEGIN\n${manifestJson}MANIFEST_END`);
  }
}

if (import.meta.main) {
  await main();
}
