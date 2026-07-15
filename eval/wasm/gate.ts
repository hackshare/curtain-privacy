// WASM keep-violation gate: score real-157 and fairness through onnxruntime-web
// (the deterministic browser consumer backend), driving the library's real
// ChatGuard/detectNer pipeline. Native onnxruntime-node over-redaction is
// platform-specific (Linux CI differs from macOS); WASM is one binary, identical
// everywhere, so this is what CI should gate on. No browser required.
//
//   CURTAIN_MODEL=train/runs/model-ml-final bun eval/wasm/gate.ts
import { readFileSync } from "node:fs";
import { ChatGuard } from "../../src/guard.ts";
import { detectNer } from "../../src/ner/classifier.ts";
import { resolveThresholds } from "../../src/thresholds.ts";
import { loadWasmClassifier } from "./classifier.ts";

const modelDir = process.env.CURTAIN_MODEL ?? "train/runs/model-ml-final";

function covered(text: string, val: string, spans: { start: number; end: number }[]): boolean {
  let i = text.indexOf(val);
  while (i !== -1) {
    const e = i + val.length;
    if (spans.some((s) => s.start < e && s.end > i)) return true;
    i = text.indexOf(val, i + 1);
  }
  return false;
}

const classifier = await loadWasmClassifier(modelDir);
const threshold = resolveThresholds("balanced");
const guard = new ChatGuard({ ner: (t) => detectNer(t, classifier, threshold) });

let failed = false;
for (const [name, file] of [
  ["real-157", "eval/real/cases.jsonl"],
  ["fairness-300", "train/fairness/cases.jsonl"],
] as const) {
  const cases = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  let redTot = 0, red = 0, keepTot = 0, keepViol = 0;
  for (const c of cases) {
    const spans = await guard.detectRedactions(c.text);
    for (const r of c.redact ?? []) { redTot++; if (covered(c.text, r.value, spans)) red++; }
    for (const k of c.keep ?? []) { keepTot++; if (covered(c.text, k.value, spans)) keepViol++; }
  }
  const kv = keepTot ? (100 * keepViol) / keepTot : 0;
  const ok = kv <= 3;
  if (!ok) failed = true;
  console.log(`[WASM] ${name}: protected ${(redTot ? (100 * red) / redTot : 100).toFixed(2)}%  keep_violation ${kv.toFixed(2)}% (${keepViol}/${keepTot}) -> ${ok ? "PASS" : "FAIL"}`);
}

if (failed) process.exit(1);
