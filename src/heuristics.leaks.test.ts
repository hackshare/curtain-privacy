import { expect, test } from "vitest";
import { detectHeuristics } from "./heuristics.ts";

test("DRIVERS_LICENSE recognizer matches XX-NNNNNN", () => {
  const spans = detectHeuristics("License WV-705081 issued");
  const dl = spans.find((s) => s.label === "DRIVERS_LICENSE");
  expect(dl).toBeDefined();
  expect(dl!.text).toBe("WV-705081");
});

test("DL recognizer does not match a bare zip", () => {
  const spans = detectHeuristics("ZIP 8000-250 area");
  expect(spans.some((s) => s.label === "DRIVERS_LICENSE")).toBe(false);
});

test("CREDIT_CARD length extension catches a Luhn-valid 13-digit card", () => {
  // 4222222222222 is a Luhn-valid 13-digit Visa test number.
  const spans = detectHeuristics("card 4222222222222 end");
  expect(spans.some((s) => s.label === "CREDIT_CARD")).toBe(true);
});

test("a non-Luhn 13-digit run is still not a card", () => {
  const spans = detectHeuristics("num 1111111111111 end");
  expect(spans.some((s) => s.label === "CREDIT_CARD")).toBe(false);
});
