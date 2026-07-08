/**
 * Fetch a pinned, per-language-balanced sample from the OpenPII validation split
 * for the 24 Latin-script languages. Data is a regenerable local artifact
 * (gitignored); the committed manifest pins dataset revision, seed, and uids.
 *
 *   HF_TOKEN=... bun eval/multilingual/fetch.ts --per-lang 200 --seed 0
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { arg, getJson, mulberry32, type RawItem, type Row } from "../bench/fetch.ts";

const DATASET = "ai4privacy/pii-masking-openpii-1.5m";
const SPLIT = "validation";
const PAGE = 100;

export const LATIN24 = [
  "en", "es", "fr", "de", "it", "pt", "nl",
  "pl", "cs", "sk", "lt", "lv", "et", "sv", "da", "fi",
  "hu", "ro", "sl", "hr", "vi", "ms", "id", "tl",
] as const;

/**
 * Collect up to `perLang` rows for each language in `languages`, consuming pages
 * in offset order (result independent of completion order), stopping when every
 * language is full or offsets are exhausted. Rejections propagate.
 */
export async function collectRowsPerLang(
  offsets: readonly number[],
  fetchPage: (offset: number) => Promise<RawItem[]>,
  perLang: number,
  languages: Set<string>,
  concurrency: number,
): Promise<Row[]> {
  const inflight = new Map<number, Promise<RawItem[]>>();
  const counts = new Map<string, number>();
  const selected: Row[] = [];
  const seen = new Set<number>();
  const full = (): boolean => [...languages].every((l) => (counts.get(l) ?? 0) >= perLang);
  let nextLaunch = 0;
  const launch = (): void => {
    if (nextLaunch < offsets.length && inflight.size < concurrency && !full()) {
      const idx = nextLaunch++;
      inflight.set(idx, fetchPage(offsets[idx]));
      launch();
    }
  };
  launch();
  for (let idx = 0; idx < offsets.length && !full(); idx++) {
    const promise = inflight.get(idx);
    if (!promise) break;
    const page = await promise;
    inflight.delete(idx);
    for (const item of page) {
      const r = item.row;
      if (!languages.has(r.language) || seen.has(r.uid)) continue;
      if ((counts.get(r.language) ?? 0) >= perLang) continue;
      seen.add(r.uid);
      counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
      selected.push({ uid: r.uid, language: r.language, source_text: r.source_text, privacy_mask: r.privacy_mask as Row["privacy_mask"] });
    }
    launch();
  }
  return selected;
}

async function main(): Promise<void> {
  const token = process.env.HF_TOKEN;
  const perLang = Number(arg("per-lang", "200"));
  const seed = Number(arg("seed", "0"));
  const concurrency = Number(arg("concurrency", "8"));
  const dataPath = arg("out", "eval/multilingual/data/latin24.jsonl");
  const manifestPath = arg("manifest", "eval/multilingual/latin24.manifest.json");

  const info = await getJson(`https://datasets-server.huggingface.co/size?dataset=${DATASET}`, token);
  const total: number = info.size.splits.find((s: any) => s.split === SPLIT).num_rows;

  const rng = mulberry32(seed);
  const offsets = Array.from({ length: Math.ceil(total / PAGE) }, (_, i) => i * PAGE);
  for (let i = offsets.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
  }

  await mkdir(dirname(dataPath), { recursive: true });
  await writeFile(dataPath, "");

  const rowsUrl = (offset: number): string =>
    `https://datasets-server.huggingface.co/rows?dataset=${DATASET}&config=default&split=${SPLIT}&offset=${offset}&length=${PAGE}`;
  const fetchPage = (offset: number): Promise<RawItem[]> =>
    getJson(rowsUrl(offset), token).then((p: any) => {
      if (!Array.isArray(p.rows)) throw new Error(`no rows for offset ${offset}`);
      process.stderr.write(`\rfetching...`);
      return p.rows;
    });

  const selected = await collectRowsPerLang(offsets, fetchPage, perLang, new Set(LATIN24), concurrency);
  process.stderr.write(`\rcollected ${selected.length}\n`);

  await appendFile(dataPath, selected.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const byLang: Record<string, number> = {};
  for (const r of selected) byLang[r.language] = (byLang[r.language] ?? 0) + 1;
  const manifest = {
    dataset: DATASET, split: SPLIT, revision: info.size?.dataset ?? null,
    seed, per_lang: perLang, languages: [...LATIN24],
    rows: selected.length, by_language: byLang, uids: selected.map((r) => r.uid),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${selected.length} rows -> ${dataPath}\nby language: ${JSON.stringify(byLang)}`);
}

if (import.meta.main) {
  await main();
}
