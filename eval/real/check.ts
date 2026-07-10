import { ChatGuard } from "../../src/guard.ts";
import { loadNerClassifier, detectNer } from "../../src/ner/classifier.ts";
import { resolveThresholds } from "../../src/thresholds.ts";
import { loadCases } from "./load.ts";
import { runEval } from "./run.ts";
import type { Report } from "./score.ts";

export interface RealThresholds {
  minProtectedRate: number;
  maxKeepViolationRate: number;
}

export const REAL_THRESHOLDS: RealThresholds = { minProtectedRate: 0.97, maxKeepViolationRate: 0.03 };

export function checkReal(report: Report, t: RealThresholds): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const p = report.overall.protectedRate;
  const k = report.overall.keepViolationRate;
  if (p < t.minProtectedRate) failures.push(`protected_rate ${(p * 100).toFixed(2)}% < ${(t.minProtectedRate * 100).toFixed(2)}%`);
  if (k > t.maxKeepViolationRate) failures.push(`keep_violation_rate ${(k * 100).toFixed(2)}% > ${(t.maxKeepViolationRate * 100).toFixed(2)}%`);
  return { ok: failures.length === 0, failures };
}

/** The cases file to score: the `--cases <path>` value, or the real-eval default.
 * Kept pure and exported so the fairness gate can reuse this scorer over a
 * different cases file without a second copy of the harness. */
export function casesPath(argv: string[]): string {
  const i = argv.indexOf("--cases");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : "eval/real/cases.jsonl";
}

async function main(): Promise<void> {
  const model = process.env.CURTAIN_MODEL;
  if (!model) {
    console.error("set CURTAIN_MODEL to a built curtain model path (see train/) before running the gate");
    process.exit(1);
  }
  const casesFile = casesPath(process.argv.slice(2));
  const cases = loadCases(casesFile);
  const classifier = await loadNerClassifier({ model, device: "cpu" });
  const threshold = resolveThresholds("balanced");
  const guard = new ChatGuard({ ner: (t) => detectNer(t, classifier, threshold) });
  const report = await runEval(cases, (t) => guard.detectRedactions(t));
  const result = checkReal(report, REAL_THRESHOLDS);
  console.log(`eval gate [${casesFile}]: protected ${(report.overall.protectedRate * 100).toFixed(2)}%, keep_violation ${(report.overall.keepViolationRate * 100).toFixed(2)}% -> ${result.ok ? "PASS" : "FAIL"}`);
  if (!result.ok) { for (const f of result.failures) console.error(`  ${f}`); process.exit(1); }
}

if (import.meta.main) { await main(); }
