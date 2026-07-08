import { expect, test } from "vitest";
import { resolveThresholds, DEFAULT_THRESHOLD } from "./thresholds.ts";

test("balanced returns the base threshold for a known label", () => {
  expect(resolveThresholds("balanced")("GIVEN_NAME")).toBeCloseTo(0.4, 6);
});

test("aggressive scales the base down by 0.6", () => {
  expect(resolveThresholds("aggressive")("GIVEN_NAME")).toBeCloseTo(0.24, 6);
});

test("conservative scales the base up by 1.6", () => {
  expect(resolveThresholds("conservative")("GIVEN_NAME")).toBeCloseTo(0.64, 6);
});

test("unknown label falls back to DEFAULT_THRESHOLD (scaled)", () => {
  expect(resolveThresholds("balanced")("NOT_A_LABEL")).toBeCloseTo(DEFAULT_THRESHOLD, 6);
  expect(resolveThresholds("aggressive")("NOT_A_LABEL")).toBeCloseTo(DEFAULT_THRESHOLD * 0.6, 6);
});

test("clamp floor is 0.15 — aggressive cannot push below the rescue floor", () => {
  expect(resolveThresholds("aggressive", { GIVEN_NAME: 0.2 })("GIVEN_NAME")).toBeCloseTo(0.15, 6);
});

test("overrides win over the base vector", () => {
  expect(resolveThresholds("balanced", { GIVEN_NAME: 0.3 })("GIVEN_NAME")).toBeCloseTo(0.3, 6);
});

test("default operating point is balanced", () => {
  expect(resolveThresholds()("GIVEN_NAME")).toBeCloseTo(0.4, 6);
});

test("throws on an unknown operating point (fail-closed, not NaN)", () => {
  expect(() => resolveThresholds("balaced" as any)("GIVEN_NAME")).toThrow(/unknown operating point/);
});

test("ceiling clamp — conservative with high override is capped at 0.99", () => {
  expect(resolveThresholds("conservative", { GIVEN_NAME: 0.7 })("GIVEN_NAME")).toBeCloseTo(0.99, 6);
});
