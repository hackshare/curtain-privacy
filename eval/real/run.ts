import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Span } from "../../src/types.ts";
import { ChatGuard } from "../../src/guard.ts";
import { loadNerClassifier, detectNer } from "../../src/ner/classifier.ts";
import { resolveThresholds } from "../../src/thresholds.ts";
import { loadCases, type ResolvedCase } from "./load.ts";
import { scoreCase, aggregate, type Report } from "./score.ts";
import { renderResults } from "./report.ts";

export async function runEval(cases: ResolvedCase[], detect: (text: string) => Promise<Span[]>): Promise<Report> {
  const scores = [];
  for (const c of cases) {
    scores.push(scoreCase(c, await detect(c.text)));
  }
  return aggregate(cases, scores);
}

async function main(): Promise<void> {
  const dataArg = process.argv.indexOf("--data");
  const dataPath = dataArg >= 0 ? process.argv[dataArg + 1] : "eval/real/cases.jsonl";
  const outArg = process.argv.indexOf("--out");
  const outDir = outArg >= 0 ? process.argv[outArg + 1] : "eval/real";
  const modelArg = process.argv.indexOf("--model");
  const model = modelArg >= 0 ? process.argv[modelArg + 1] : process.env.CURTAIN_MODEL;
  if (!model) {
    console.error("pass --model <path> or set CURTAIN_MODEL to a built curtain model (see train/)");
    process.exit(1);
  }
  const opArg = process.argv.indexOf("--operating-point");
  const operatingPoint = (opArg >= 0 ? process.argv[opArg + 1] : "balanced") as Parameters<typeof resolveThresholds>[0];
  const scaleArg = process.argv.indexOf("--threshold-scale");
  const scale = scaleArg >= 0 ? parseFloat(process.argv[scaleArg + 1]) : 1;

  const cases = loadCases(dataPath);
  const classifier = await loadNerClassifier({ model, device: "cpu" });
  const base = resolveThresholds(operatingPoint);
  const threshold = scale === 1 ? base : (label: string) => Math.min(0.99, base(label) * scale);
  const guard = new ChatGuard({ ner: (t) => detectNer(t, classifier, threshold) });

  const report = await runEval(cases, (t) => guard.detectRedactions(t));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "RESULTS.md"), renderResults(report));
  console.log(`real-eval: ${report.cases} cases, protected_rate ${(report.overall.protectedRate * 100).toFixed(2)}%, keep_violation ${(report.overall.keepViolationRate * 100).toFixed(2)}%`);
}

if (import.meta.main) {
  await main();
}
