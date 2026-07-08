/**
 * Tune the balanced per-label anchors on the calibration slice. For each model
 * label, pick the lowest anchor whose marginal over-redaction keeps aggregate
 * public char-retention within TARGET_DROP of the 0.4 value — recovering
 * low-confidence spans only where retention allows. Prints the vector as JSON.
 *
 *   bun eval/bench/tune-thresholds.ts --data eval/bench/data/calib.jsonl
 */
import { readFile } from "node:fs/promises";
import { detectHeuristics } from "../../src/heuristics";
import { detectNer, loadNerClassifier } from "../../src/ner/classifier";
import { applyPolicy } from "../../src/policy";
import { premask, projectMaskedSpan, NO_PREMASK_LABELS } from "../../src/premask";
import { extendSpans } from "../../src/recognizers";
import type { Span } from "../../src/types";
import { charCoverage } from "./coverage";
import { mapOpenPiiLabel } from "./labels";

const GRID = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const TARGET_DROP = 0.0005; // 0.05pp aggregate retention budget per label
const MODEL_LABELS = [
  "GIVEN_NAME","SURNAME","PHONE","URL","EMAIL","TAX_ID","BANK_ACCOUNT","ROUTING_NUMBER",
  "GOVERNMENT_ID","PASSPORT","DRIVERS_LICENSE","BUILDING_NUMBER","STREET_NAME","SECONDARY_ADDRESS","CITY","STATE","ZIP_CODE",
];

interface Row { language: string; source_text: string; privacy_mask: { label: string; start: number; end: number; value: string }[]; }
interface Term { value: string; label: string; start: number; end: number; }

function gold(row: Row): { priv: Term[]; pub: Term[] } {
  const priv: Term[] = []; const pub: Term[] = [];
  for (const e of row.privacy_mask) {
    const raw = e.value ?? ""; if (!raw.trim()) continue;
    let start: number; let end: number;
    if (typeof e.start === "number" && row.source_text.slice(e.start, e.end) === raw) { start = e.start; end = e.end; }
    else { const i = row.source_text.indexOf(raw.trim()); if (i < 0) continue; start = i; end = i + raw.trim().length; }
    const value = row.source_text.slice(start, end); const ours = mapOpenPiiLabel(e.label);
    (ours === "O" ? pub : priv).push({ value, label: ours, start, end });
  }
  return { priv, pub };
}

async function main(): Promise<void> {
  const dataArg = process.argv.indexOf("--data");
  const dataPath = dataArg >= 0 ? process.argv[dataArg + 1] : "eval/bench/data/calib.jsonl";
  const rows: Row[] = (await readFile(dataPath, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  const clf = await loadNerClassifier({ model: process.env.CURTAIN_MODEL ?? "", device: "cpu" });

  // Cache per row exactly what the pipeline needs to recompute redaction as a
  // function of the per-label anchor: the raw text, the heuristic spans, and the
  // model spans (projected to raw offsets) with their scores. Model runs ONCE at
  // the 0.15 floor so every rescue-eligible span is available for the sweep.
  const cache: { priv: Term[]; pub: Term[]; text: string; heur: Span[]; modelSpans: Span[] }[] = [];
  for (const row of rows) {
    const { priv, pub } = gold(row);
    const heur = detectHeuristics(row.source_text);
    const map = premask(row.source_text, heur.filter((s) => !NO_PREMASK_LABELS.has(s.label)));
    const masked = await detectNer(map.masked, clf, 0.15); // floor: keep all rescue-eligible spans
    const modelSpans: Span[] = [];
    for (const s of masked) { const p = projectMaskedSpan(s, row.source_text, map); if (p !== null) modelSpans.push(p); }
    cache.push({ priv, pub, text: row.source_text, heur, modelSpans });
  }

  // Redaction as the pipeline computes it for a given per-label anchor: keep model
  // spans whose score clears their label's anchor, then extendSpans + policy over
  // the merged heuristic+model set — approximates run.ts (spans cached at the 0.15
  // floor, filtered by score — the per-anchor rescue band is not re-derived).
  function redactFor(c: (typeof cache)[number], anchor: (label: string) => number): Span[] {
    const model = c.modelSpans.filter((s) => s.score >= anchor(s.label));
    return applyPolicy(extendSpans(c.text, [...c.heur, ...model]));
  }

  // Aggregate public retention for a given per-label anchor map.
  function retention(anchor: (label: string) => number): number {
    let chars = 0; let covered = 0;
    for (const c of cache) {
      const redact = redactFor(c, anchor);
      for (const t of c.pub) { const cc = charCoverage(t.value, t.start, redact); chars += cc.significant; covered += cc.covered; }
    }
    return chars ? (chars - covered) / chars : 1;
  }

  const base: Record<string, number> = {};
  for (const l of MODEL_LABELS) base[l] = 0.4;
  const at04 = retention((l) => base[l] ?? 0.4);

  for (const label of MODEL_LABELS) {
    let chosen = 0.4;
    for (const t of GRID) {
      const trial = { ...base, [label]: t };
      if (retention((l) => trial[l] ?? 0.4) >= at04 - TARGET_DROP) { chosen = t; break; } // GRID ascending-from-floor: first (lowest) that holds retention
    }
    base[label] = chosen;
  }
  console.log(JSON.stringify(base, null, 2));
}
await main();
