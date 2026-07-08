/**
 * Training-data builder for the Rampart NER model.
 *
 * Converts OpenPII gold rows into folded training examples that match the text
 * the runtime feeds the model at serve time: same label projection, same premask
 * sentinel substitution, same BERT fold (lowercase + NFKD + combining-mark strip).
 * Reusing the runtime transforms directly prevents train/serve skew.
 *
 * Transform order:
 *   1. Map OpenPII labels onto our taxonomy via mapOpenPiiLabel.
 *   2. Premask-splice: replace SSN/CREDIT_CARD/IP_ADDRESS spans with sentinel
 *      literals, shifting remaining entity-span offsets by the running length delta.
 *   3. Fold: run foldForModel over the premask-spliced string, then project each
 *      entity span's masked-space [start, end) into the folded coordinate system.
 *
 * The emitted `text` is the folded string; `start`/`end` in each span are folded
 * offsets satisfying `text.slice(start, end) === <folded entity value>`.
 */

import { foldForModel, type FoldedProjection } from "../src/ner/classifier.ts";
import { mapOpenPiiLabel } from "../eval/bench/labels.ts";
import { sentinelFor } from "../src/premask.ts";
import type { PiiLabel } from "../src/types.ts";

export type OpenPiiRow = {
  uid: number;
  language: string;
  source_text: string;
  privacy_mask: { label: string; start: number; end: number; value: string }[];
};

export type TrainExample = {
  text: string;
  spans: { label: string; start: number; end: number }[];
};

const PREMASK_LABELS = new Set<string>(["SSN", "CREDIT_CARD", "IP_ADDRESS"]);

type RawSpan = { label: string; start: number; end: number };

export function buildExample(row: OpenPiiRow): TrainExample {
  // 1. Map labels; partition into premask spans and entity spans; drop O.
  const premaskSpans: RawSpan[] = [];
  const entitySpans: RawSpan[] = [];

  for (const entry of row.privacy_mask) {
    const mapped = mapOpenPiiLabel(entry.label);
    if (mapped === "O") continue;
    if (PREMASK_LABELS.has(mapped)) {
      premaskSpans.push({ label: mapped, start: entry.start, end: entry.end });
    } else {
      entitySpans.push({ label: mapped, start: entry.start, end: entry.end });
    }
  }

  // 2. Premask-splice: build the masked string and compute shifted entity offsets.
  //    Premask spans are in source coords; we walk them left→right, splicing in
  //    sentinels and accumulating the length delta for all spans that follow.
  const sortedPremask = premaskSpans.slice().sort((a, b) => a.start - b.start);

  let masked = "";
  let cursor = 0;
  for (const ps of sortedPremask) {
    masked += row.source_text.slice(cursor, ps.start);
    masked += sentinelFor(ps.label as PiiLabel);
    cursor = ps.end;
  }
  masked += row.source_text.slice(cursor);

  // For each entity span, sum the length deltas from all premask spans whose
  // source end is <= the entity's source start; drop any that overlap.
  const maskedEntitySpans: RawSpan[] = [];
  for (const es of entitySpans) {
    let totalDelta = 0;
    let overlaps = false;
    for (const ps of sortedPremask) {
      const sentinel = sentinelFor(ps.label as PiiLabel);
      const delta = sentinel.length - (ps.end - ps.start);
      if (ps.end <= es.start) {
        totalDelta += delta;
      } else if (ps.start < es.end) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) {
      maskedEntitySpans.push({
        label: es.label,
        start: es.start + totalDelta,
        end: es.end + totalDelta,
      });
    }
  }

  // 3. Fold and project entity spans from masked coords to folded coords.
  const proj = foldForModel(masked);
  const spans: TrainExample["spans"] = [];
  for (const es of maskedEntitySpans) {
    const folded = projectSpan(proj, es.start, es.end);
    if (folded !== null) {
      spans.push({ label: es.label, start: folded.start, end: folded.end });
    }
  }

  return { text: proj.text, spans };
}

/**
 * Project a masked-space span [s, e) into the folded coordinate system.
 *
 * foldedStart: first folded index i where proj.rawStart[i] >= s (the first
 * folded char whose source lies at or after s).
 * foldedEnd: (last folded index i where proj.rawEnd[i] <= e) + 1 (exclusive).
 *
 * Returns null if the span maps to nothing in the folded text (e.g. the span
 * covers only combining marks that were stripped).
 */
function projectSpan(
  proj: FoldedProjection,
  s: number,
  e: number,
): { start: number; end: number } | null {
  const n = proj.rawStart.length;
  let foldedStart = -1;
  let foldedEnd = -1;
  for (let i = 0; i < n; i++) {
    if (foldedStart === -1 && proj.rawStart[i] >= s) {
      foldedStart = i;
    }
    if (proj.rawEnd[i] <= e) {
      foldedEnd = i;
    }
  }
  if (foldedStart === -1 || foldedEnd < foldedStart) return null;
  return { start: foldedStart, end: foldedEnd + 1 };
}

// CLI: bun train/build-dataset.ts --in <fetched.jsonl> --out <train.jsonl>
if (import.meta.main) {
  const args = process.argv.slice(2);
  const inIdx = args.indexOf("--in");
  const outIdx = args.indexOf("--out");
  if (inIdx === -1 || outIdx === -1 || !args[inIdx + 1] || !args[outIdx + 1]) {
    console.error("Usage: bun train/build-dataset.ts --in <fetched.jsonl> --out <train.jsonl>");
    process.exit(1);
  }
  const inPath = args[inIdx + 1];
  const outPath = args[outIdx + 1];

  const text = await Bun.file(inPath).text();
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const outLines: string[] = [];
  let total = 0;
  let withSpans = 0;

  for (const line of lines) {
    const row: OpenPiiRow = JSON.parse(line);
    const example = buildExample(row);
    outLines.push(JSON.stringify(example));
    total++;
    if (example.spans.length > 0) withSpans++;
  }

  await Bun.write(outPath, outLines.join("\n") + "\n");
  console.log(`Wrote ${total} examples (${withSpans} with spans) → ${outPath}`);
}
