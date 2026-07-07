import { expect, test } from "vitest";
import { redactSentence } from "./smoke.ts";

test("detects a contextual name as a redact span", async () => {
  const spans = await redactSentence("My name is Alex Rivera and I live in Boston.");
  const labels = spans.map((s) => s.label);
  // The model should tag the given name and/or surname in "Alex Rivera".
  expect(labels.some((l) => l === "GIVEN_NAME" || l === "SURNAME")).toBe(true);
}, 120_000);
