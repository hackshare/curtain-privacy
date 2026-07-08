import { expect, test } from "vitest";
import { redactSentence } from "./smoke.ts";

// Model-dependent: needs a built curtain model. Skips unless CURTAIN_MODEL is set
// (the model is built locally from train/, not fetched, so CI has no model to load).
test.skipIf(!process.env.CURTAIN_MODEL)("detects a contextual name as a redact span", async () => {
  const spans = await redactSentence("My name is Alex Rivera and I live in Boston.");
  const labels = spans.map((s) => s.label);
  // The model should tag the given name and/or surname in "Alex Rivera".
  expect(labels.some((l) => l === "GIVEN_NAME" || l === "SURNAME")).toBe(true);
}, 120_000);
