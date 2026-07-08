import { expect, test } from "vitest";
import { classifyLeak, LeakAccumulator, type GoldTerm } from "./leaks.ts";
import type { Span } from "../../src/types.ts";

function span(start: number, end: number, label: string): Span {
  return { start, end, label: label as Span["label"], score: 1, source: "ner", text: "" };
}
const term: GoldTerm = { value: "Rivera", label: "SURNAME", start: 10, end: 16 };

test("undetected: no span overlaps the term", () => {
  expect(classifyLeak(term, [span(0, 5, "GIVEN_NAME")], [])).toBe("undetected");
});

test("keep_misroute: an overlapping detected span carries a keep-set label", () => {
  // City span overlaps the term; applyPolicy would drop it (keep-set), so it leaked.
  expect(classifyLeak(term, [span(8, 16, "CITY")], [])).toBe("keep_misroute");
});

test("under_cover: a redact span overlaps but does not fully cover the term", () => {
  // Redacts [10,14) of the [10,16) term — "ra" of "Rivera" survives.
  expect(classifyLeak(term, [span(10, 14, "SURNAME")], [span(10, 14, "SURNAME")])).toBe("under_cover");
});

test("precedence: under_cover wins over keep_misroute", () => {
  const detected = [span(10, 14, "SURNAME"), span(8, 16, "STATE")];
  const redact = [span(10, 14, "SURNAME")];
  expect(classifyLeak(term, detected, redact)).toBe("under_cover");
});

test("fully covered at primary location (duplicate-value leak) -> undetected", () => {
  // A redact span fully covers the primary location; the leak is a duplicate elsewhere.
  expect(classifyLeak(term, [span(10, 16, "SURNAME")], [span(10, 16, "SURNAME")])).toBe("undetected");
});

test("accumulator: fully-covered term is protected; char_recall 1", () => {
  const acc = new LeakAccumulator();
  const term: GoldTerm = { value: "Jones", label: "SURNAME", start: 0, end: 5 };
  acc.add(term, [], [{ start: 0, end: 5, label: "SURNAME", score: 1, source: "ner", text: "Jones" }]);
  const rep = acc.report();
  expect(rep.SURNAME.private_total).toBe(1);
  expect(rep.SURNAME.fully_protected).toBe(1);
  expect(rep.SURNAME.leaked).toBe(0);
  expect(rep.SURNAME.protected_rate).toBe(1);
  expect(rep.SURNAME.char_recall).toBe(1);
});

test("accumulator: partially-covered multi-token term is leaked (under_cover) with fractional char_recall", () => {
  const acc = new LeakAccumulator();
  const term: GoldTerm = { value: "2 09 12", label: "SSN", start: 0, end: 7 };
  // redact only "09" (offsets 2-4): 2 of 5 significant chars covered
  const redact = [{ start: 2, end: 4, label: "SSN" as const, score: 1, source: "heuristic" as const, text: "09" }];
  acc.add(term, redact, redact);
  const rep = acc.report();
  expect(rep.SSN.fully_protected).toBe(0);
  expect(rep.SSN.leaked).toBe(1);
  expect(rep.SSN.char_recall).toBeCloseTo(0.4, 6);
  expect(rep.SSN.causes).toEqual({ undetected: 0, keep_misroute: 0, under_cover: 1 });
});

test("accumulator: aggregate() sums across labels with a Wilson CI", () => {
  const acc = new LeakAccumulator();
  acc.add({ value: "Ann", label: "GIVEN_NAME", start: 0, end: 3 }, [], [{ start: 0, end: 3, label: "GIVEN_NAME", score: 1, source: "ner", text: "Ann" }]);
  acc.add({ value: "Xu", label: "SURNAME", start: 10, end: 12 }, [], []); // uncovered -> leaked
  const agg = acc.aggregate();
  expect(agg.private_total).toBe(2);
  expect(agg.fully_protected).toBe(1);
  expect(agg.protected_rate).toBeCloseTo(0.5, 6);
  expect(agg.char_recall).toBeCloseTo(3 / 5, 6); // 3 covered of 5 significant chars
});
