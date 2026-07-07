/**
 * Minimal end-to-end smoke of the forked pipeline: heuristics + premask + NER +
 * policy, mirroring eval/bench/run.ts but for a single sentence. Proves the
 * shipped model loads and produces spans before the full bench fetch.
 */
import { detectHeuristics } from "../src/heuristics.ts";
import { detectNer, loadNerClassifier, RAMPART_MODEL_ID } from "../src/ner/classifier.ts";
import { applyPolicy } from "../src/policy.ts";
import { premask, projectMaskedSpan } from "../src/premask.ts";
import type { Span } from "../src/types.ts";

export async function redactSentence(text: string): Promise<{ label: string; start: number; end: number }[]> {
  const classifier = await loadNerClassifier({ model: RAMPART_MODEL_ID, device: "cpu" });
  const heuristic = detectHeuristics(text);
  const map = premask(text, heuristic);
  const masked = await detectNer(map.masked, classifier);
  const modelSpans: Span[] = [];
  for (const s of masked) {
    const projected = projectMaskedSpan(s, text, map);
    if (projected !== null) modelSpans.push(projected);
  }
  const redactSpans = applyPolicy([...heuristic, ...modelSpans]);
  return redactSpans.map((s) => ({ label: s.label, start: s.start, end: s.end }));
}
