/**
 * The native bench: run the shipped pipeline over the frozen held-out set and
 * emit `summary.json` / `by_language.json`. The predictions come from the exact
 * TypeScript code that ships, scored by the TypeScript code under test.
 *
 *   bun eval/bench/run.ts --out eval/bench/runs/native
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectHeuristics } from "../../src/heuristics";
import { detectNer, loadNerClassifier } from "../../src/ner/classifier";
import { resolveThresholds, type OperatingPoint } from "../../src/thresholds.ts";
import { extendSpans } from "../../src/recognizers.ts";
import { applyPolicy } from "../../src/policy";
import { reconcileSpans } from "../../src/reconcile.ts";
import { premask, projectMaskedSpan, NO_PREMASK_LABELS } from "../../src/premask";
import { KEEP_LABELS, type Span } from "../../src/types";
import { LeakAccumulator, type GoldTerm } from "./leaks.ts";
import { mapOpenPiiLabel } from "./labels";
import { type GoldSpan, type PredSpan, percentile, Stratum, expectedCalibrationError } from "./score";
import { charCoverage } from "./coverage.ts";

const IOU_THRESHOLDS = [1, 0.5, 0];

interface Row {
  uid: number;
  language: string;
  source_text: string;
  privacy_mask: { label: string; start: number; end: number; value: string }[];
}

function arg(name: string, fallback: string): string {
  const eq = Bun.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  const idx = Bun.argv.indexOf(`--${name}`);
  return idx >= 0 && Bun.argv[idx + 1] && !Bun.argv[idx + 1].startsWith("--") ? Bun.argv[idx + 1] : fallback;
}

/** Build gold spans + private/public terms, anchored at OpenPII offsets. */
function buildGold(row: Row): { spans: GoldSpan[]; privTerms: GoldTerm[]; pubTerms: GoldTerm[] } {
  const spans: GoldSpan[] = [];
  const privTerms: GoldTerm[] = [];
  const pubTerms: GoldTerm[] = [];
  for (const entry of row.privacy_mask) {
    const raw = entry.value ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let start: number;
    let end: number;
    if (typeof entry.start === "number" && row.source_text.slice(entry.start, entry.end) === raw) {
      start = entry.start;
      end = entry.end;
    } else {
      const idx = row.source_text.indexOf(trimmed);
      if (idx < 0) continue;
      start = idx;
      end = idx + trimmed.length;
    }
    const value = row.source_text.slice(start, end);
    const ours = mapOpenPiiLabel(entry.label);
    const term: GoldTerm = { value, label: ours, start, end };
    if (ours === "O") {
      pubTerms.push(term);
    } else {
      spans.push({ label: ours, start, end });
      privTerms.push(term);
    }
  }
  return { spans, privTerms, pubTerms };
}

async function main(): Promise<void> {
  const dataPath = arg("data", "eval/bench/data/heldout.jsonl");
  const outDir = arg("out", "eval/bench/runs/native");
  const noPrefilter = process.argv.includes("--no-prefilter");
  const modelOnly = process.argv.includes("--model-only");
  const operatingPoint = arg("operating-point", "balanced") as OperatingPoint;
  const scale = parseFloat(arg("threshold-scale", "1"));
  const base = resolveThresholds(operatingPoint);
  const threshold = scale === 1 ? base : (label: string) => Math.min(0.99, base(label) * scale);

  const model = arg("model", process.env.CURTAIN_MODEL ?? "");
  if (!model) {
    console.error("pass --model <path> or set CURTAIN_MODEL to a built curtain model (see train/)");
    process.exit(1);
  }
  const rows: Row[] = (await readFile(dataPath, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  const classifier = await loadNerClassifier({ model, device: "cpu" });

  const overall = new Stratum();
  const byLang = new Map<string, Stratum>();
  const leakOverall = new LeakAccumulator();
  const leakByLang = new Map<string, LeakAccumulator>();
  let pubTotal = 0;
  let pubChars = 0;
  let pubCovered = 0;
  let pubFullyRetained = 0;
  const pubByLang = new Map<string, { total: number; chars: number; covered: number; fully: number }>();
  const latencies: number[] = [];
  const calibration: [number, boolean][] = [];

  for (const row of rows) {
    const { spans: gold, privTerms, pubTerms } = buildGold(row);

    const t0 = performance.now();
    // Match the shipped runtime: premask SSN/CC/IP_ADDRESS to sentinels before
    // the model unless --no-prefilter is set (npf models trained on raw digits).
    // --model-only skips heuristics entirely (model is the only detector).
    const heuristic = modelOnly ? [] : detectHeuristics(row.source_text);
    let modelSpans: Span[];
    if (noPrefilter || modelOnly) {
      modelSpans = await detectNer(row.source_text, classifier, threshold);
    } else {
      const map = premask(row.source_text, heuristic.filter((s) => !NO_PREMASK_LABELS.has(s.label)));
      const masked = await detectNer(map.masked, classifier, threshold);
      modelSpans = [];
      for (const s of masked) {
        const projected = projectMaskedSpan(s, row.source_text, map);
        if (projected !== null) modelSpans.push(projected);
      }
    }
    const detected: Span[] = extendSpans(row.source_text, [...heuristic, ...modelSpans]);
    // Match the shipped guard.detectOnOriginal: reconcile (snap name spans to word
    // boundaries, strip swept-in honorifics, propagate a caught surface to its
    // repeats) before the default-deny policy. Keep this in sync with src/guard.ts.
    const reconciled = reconcileSpans(row.source_text, detected, KEEP_LABELS);
    const redactSpans = applyPolicy(reconciled); // non-overlapping, keep-set filtered — exactly what ships
    latencies.push(performance.now() - t0);

    const pred: PredSpan[] = redactSpans.map((s) => ({ label: s.label, start: s.start, end: s.end, score: s.score }));

    const langLeak = leakByLang.get(row.language) ?? new LeakAccumulator();
    for (const t of privTerms) {
      leakOverall.add(t, detected, redactSpans);
      langLeak.add(t, detected, redactSpans);
    }
    leakByLang.set(row.language, langLeak);

    overall.addSpans(gold, pred, IOU_THRESHOLDS);
    const stratum = byLang.get(row.language) ?? new Stratum();
    stratum.addSpans(gold, pred, IOU_THRESHOLDS);
    byLang.set(row.language, stratum);

    const pl = pubByLang.get(row.language) ?? { total: 0, chars: 0, covered: 0, fully: 0 };
    for (const t of pubTerms) {
      const { significant, covered } = charCoverage(t.value, t.start, redactSpans);
      pubTotal += 1;
      pubChars += significant;
      pubCovered += covered;
      if (covered === 0) pubFullyRetained += 1;
      pl.total += 1;
      pl.chars += significant;
      pl.covered += covered;
      if (covered === 0) pl.fully += 1;
    }
    pubByLang.set(row.language, pl);

    // Calibration: per predicted span, score vs. whether it hit a gold span (IoU>=0.5).
    for (const p of pred) {
      const correct = gold.some((g) => g.label === p.label && spanIou(p, g) >= 0.5);
      calibration.push([Math.min(1, Math.max(0, p.score)), correct]);
    }
  }

  latencies.sort((a, b) => a - b);
  const agg = leakOverall.aggregate();
  const spanReport = overall.report() as Record<string, any>;
  const summary = {
    rows_scored: rows.length,
    private_total: agg.private_total,
    private_char_recall: agg.char_recall,
    private_protected_rate: agg.protected_rate,
    private_protected_rate_wilson95: agg.protected_rate_wilson95,
    private_fully_protected: agg.fully_protected,
    public_total: pubTotal,
    public_char_retention: pubChars ? (pubChars - pubCovered) / pubChars : 1,
    public_fully_retained_rate: pubTotal ? pubFullyRetained / pubTotal : 1,
    span_f1: spanReport.span_f1,
    calibration: { ece: expectedCalibrationError(calibration), n_pairs: calibration.length },
    latency_ms: {
      cold: latencies[latencies.length - 1] ?? 0,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      mean: latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1),
    },
    model,
  };
  const byLanguage = Object.fromEntries(
    [...byLang.entries()].sort().map(([lang, s]) => {
      const priv = (leakByLang.get(lang) ?? new LeakAccumulator()).aggregate();
      const pl = pubByLang.get(lang) ?? { total: 0, chars: 0, covered: 0, fully: 0 };
      return [lang, {
        private_char_recall: priv.char_recall,
        private_protected_rate: priv.protected_rate,
        private_protected_rate_wilson95: priv.protected_rate_wilson95,
        private_total: priv.private_total,
        public_char_retention: pl.chars ? (pl.chars - pl.covered) / pl.chars : 1,
        public_total: pl.total,
        span_f1: (s.report() as Record<string, any>).span_f1,
      }];
    }),
  );

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  await writeFile(join(outDir, "by_language.json"), JSON.stringify(byLanguage, null, 2) + "\n");

  const overallLeak = leakOverall.report();
  const causeTotals = { undetected: 0, keep_misroute: 0, under_cover: 0 };
  for (const r of Object.values(overallLeak)) {
    causeTotals.undetected += r.causes.undetected;
    causeTotals.keep_misroute += r.causes.keep_misroute;
    causeTotals.under_cover += r.causes.under_cover;
  }
  const leaks = {
    overall: overallLeak,
    by_language: Object.fromEntries([...leakByLang.entries()].sort().map(([lang, a]) => [lang, a.report()])),
    cause_totals: causeTotals,
  };
  await writeFile(join(outDir, "leaks.json"), JSON.stringify(leaks, null, 2) + "\n");
  console.log(`leaks: undetected ${causeTotals.undetected}  keep_misroute ${causeTotals.keep_misroute}  under_cover ${causeTotals.under_cover}`);

  const r = summary as Record<string, any>;
  console.log(`\nRows ${r.rows_scored}  private ${r.private_total}  public ${r.public_total}`);
  console.log(`Private char-recall ${(r.private_char_recall * 100).toFixed(2)}%  protected ${(r.private_protected_rate * 100).toFixed(2)}%  Wilson95 [${(r.private_protected_rate_wilson95[0] * 100).toFixed(2)}, ${(r.private_protected_rate_wilson95[1] * 100).toFixed(2)}]`);
  console.log(`Public char-retention ${(r.public_char_retention * 100).toFixed(2)}%`);
  console.log(`Span-F1 strict ${r.span_f1["iou_1.00"].f1.toFixed(3)}   latency p50 ${r.latency_ms.p50.toFixed(1)} ms`);
  console.log(`By language: ${Object.entries(byLanguage).map(([l, x]: [string, any]) => `${l} recall ${(x.private_char_recall * 100).toFixed(1)}%`).join("  ")}`);
  console.log(`\nwrote ${join(outDir, "summary.json")} + by_language.json`);
}

function spanIou(a: GoldSpan, b: GoldSpan): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  return inter === 0 ? 0 : inter / (Math.max(a.end, b.end) - Math.min(a.start, b.start));
}

await main();
