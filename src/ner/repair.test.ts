import { expect, test } from "vitest";
import { repairSpans } from "./classifier.ts";
import type { Span } from "../types.ts";

function span(text: string, start: number, end: number, label: string, score: number): Span {
  return { start, end, label: label as Span["label"], score, source: "ner", text: text.slice(start, end) };
}

test("per-label threshold keeps a name at 0.30 while dropping it at 0.50", () => {
  const text = "Contact Ulas today";
  const s = span(text, 8, 12, "GIVEN_NAME", 0.35); // "Ulas"
  const keptLow = repairSpans(text, [s], (l) => (l === "GIVEN_NAME" ? 0.3 : 0.4));
  const keptHigh = repairSpans(text, [s], (l) => (l === "GIVEN_NAME" ? 0.5 : 0.4));
  expect(keptLow.some((k) => k.label === "GIVEN_NAME")).toBe(true);
  expect(keptHigh.some((k) => k.label === "GIVEN_NAME")).toBe(false);
});
