import { expect, test } from "vitest";
import { buildMapping } from "./mapping.ts";
import type { Span } from "curtain-privacy";

const span = (label: string, text: string, start: number): Span =>
  ({ start, end: start + text.length, label: label as Span["label"], score: 1, source: "ner", text });

test("pairs values with placeholders across a multi-entity message", () => {
  // detectRedactions returns spans right to left; protect placeholders are left to right.
  const spans = [span("EMAIL", "bob@example.com", 21), span("GIVEN_NAME", "Alice", 0)];
  const placeholders = ["[GIVEN_NAME_1.s]", "[EMAIL_1.s]"];
  expect(buildMapping(spans, placeholders)).toEqual([
    { placeholder: "[GIVEN_NAME_1.s]", label: "GIVEN_NAME", value: "Alice" },
    { placeholder: "[EMAIL_1.s]", label: "EMAIL", value: "bob@example.com" },
  ]);
});

test("reuses one placeholder for a repeated value (one token per occurrence)", () => {
  const spans = [span("GIVEN_NAME", "Alex", 20), span("GIVEN_NAME", "Alex", 0)];
  const placeholders = ["[GIVEN_NAME_1.s]", "[GIVEN_NAME_1.s]"];
  expect(buildMapping(spans, placeholders)).toEqual([
    { placeholder: "[GIVEN_NAME_1.s]", label: "GIVEN_NAME", value: "Alex" },
  ]);
});
