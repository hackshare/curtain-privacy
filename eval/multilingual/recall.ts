/**
 * Per-language person-recall over the pinned Latin-24 validation sample. A person
 * value counts protected only if every alphanumeric char in its gold offsets is
 * covered by a redaction span; insignificant chars (spaces, hyphens, combining
 * marks) do not count as leaks. Exits nonzero if any language is below --floor.
 *
 *   CURTAIN_MODEL=train/runs/model-ship bun eval/multilingual/recall.ts --floor 95
 */
import { readFileSync } from "node:fs";
import { createGuard } from "../../index.ts";
import { arg } from "../bench/fetch.ts";
import { LATIN24 } from "./fetch.ts";

const PERSON = new Set(["GIVENNAME", "SURNAME", "MIDDLENAME", "LASTNAME", "FIRSTNAME"]);
const SIGNIFICANT = /\p{L}|\p{N}/u;

/** True if every alphanumeric char in [start,end) lies inside some span. */
export function sigProtected(
  text: string,
  start: number,
  end: number,
  spans: { start: number; end: number }[],
): boolean {
  for (let i = start; i < end; i++) {
    if (!SIGNIFICANT.test(text[i])) continue;
    if (!spans.some((s) => s.start <= i && i < s.end)) return false;
  }
  return true;
}

/**
 * Gate decision over the aggregated per-language counts. Returns an error string
 * if the gate fails, or null if it passes. A floor of 0 disables the gate. When
 * the floor is active, every language in `expected` must have person samples —
 * a language with zero samples cannot be certified and fails the gate, closing
 * the silent-green hole where an empty or under-covered data file "passes".
 */
export function gateFailure(
  agg: Record<string, { n: number; prot: number }>,
  floor: number,
  expected: readonly string[],
): string | null {
  if (floor <= 0) return null;
  const missing = expected.filter((l) => !(l in agg));
  if (missing.length > 0) return `no person samples for ${missing.length} language(s): ${missing.join(", ")}`;
  let worst = 100;
  for (const lang of Object.keys(agg)) {
    worst = Math.min(worst, (agg[lang].prot / (agg[lang].n || 1)) * 100);
  }
  if (worst < floor) return `worst-language recall ${worst.toFixed(1)}% < ${floor}%`;
  return null;
}

async function main(): Promise<void> {
  const model = process.env.CURTAIN_MODEL;
  if (!model) { console.error("set CURTAIN_MODEL"); process.exit(1); }
  const dataPath = arg("data", "eval/multilingual/data/latin24.jsonl");
  const floor = Number(arg("floor", "0"));

  const guard = await createGuard({ model, device: "cpu" });
  const rows = readFileSync(dataPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  const agg: Record<string, { n: number; prot: number }> = {};
  for (const r of rows) {
    const spans = await guard.detectRedactions(r.source_text);
    for (const m of r.privacy_mask ?? []) {
      if (!PERSON.has(m.label)) continue;
      (agg[r.language] ??= { n: 0, prot: 0 }).n++;
      if (sigProtected(r.source_text, m.start, m.end, spans)) agg[r.language].prot++;
    }
  }

  let worst = 100;
  for (const lang of Object.keys(agg).sort()) {
    const a = agg[lang];
    const pct = (a.prot / (a.n || 1)) * 100;
    worst = Math.min(worst, pct);
    console.log(`${lang}\tn=${a.n}\trecall=${pct.toFixed(1)}%`);
  }
  console.log(`worst-language recall: ${Object.keys(agg).length ? worst.toFixed(1) : "n/a"}%  (floor ${floor}%)`);
  const fail = gateFailure(agg, floor, LATIN24);
  if (fail) {
    console.error(`GATE FAIL: ${fail}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
