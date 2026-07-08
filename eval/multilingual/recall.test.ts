import { expect, test } from "vitest";
import { sigProtected } from "./recall.ts";
import { gateFailure } from "./recall.ts";

// "Anna Smith" -- offsets 0..10; a span covering 0..10 protects it.
test("fully covered value is protected", () => {
  expect(sigProtected("Anna Smith", 0, 10, [{ start: 0, end: 10 }])).toBe(true);
});

test("uncovered alphanumeric char is a leak", () => {
  // span misses the final 'h'
  expect(sigProtected("Anna Smith", 0, 10, [{ start: 0, end: 9 }])).toBe(false);
});

test("uncovered non-alphanumeric char is not a leak", () => {
  // value "Anna-Smith"; the hyphen at index 4 is uncovered but insignificant
  const text = "Anna-Smith";
  const spans = [{ start: 0, end: 4 }, { start: 5, end: 10 }];
  expect(sigProtected(text, 0, 10, spans)).toBe(true);
});

test("diacritic code point uncovered is not a leak", () => {
  // combining acute at index 3 is a mark, not alphanumeric
  const text = "Amélie"; // NFD: A m e + combining-acute(U+0301) l i e
  const spans = [{ start: 0, end: 3 }, { start: 4, end: 7 }]; // skips the combining mark at 3
  expect(sigProtected(text, 0, 7, spans)).toBe(true);
});

test("gate passes when floor is 0 regardless of coverage", () => {
  expect(gateFailure({}, 0, ["en", "vi"])).toBeNull();
});

test("gate fails on empty agg when floor is active", () => {
  expect(gateFailure({}, 95, ["en", "vi"])).toContain("no person samples");
});

test("gate fails when a language is missing from agg", () => {
  const agg = { en: { n: 10, prot: 10 } };
  expect(gateFailure(agg, 95, ["en", "vi"])).toContain("vi");
});

test("gate fails when worst language is below floor", () => {
  const agg = { en: { n: 10, prot: 10 }, vi: { n: 10, prot: 8 } }; // vi = 80%
  expect(gateFailure(agg, 95, ["en", "vi"])).toContain("80.0%");
});

test("gate passes when all languages present and above floor", () => {
  const agg = { en: { n: 10, prot: 10 }, vi: { n: 10, prot: 10 } };
  expect(gateFailure(agg, 95, ["en", "vi"])).toBeNull();
});
