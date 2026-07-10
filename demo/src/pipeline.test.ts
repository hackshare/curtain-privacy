import { expect, test } from "vitest";
import { runTurn } from "./pipeline.ts";
import type { Span } from "curtain-privacy";

const span = (label: string, text: string, start: number): Span =>
  ({ start, end: start + text.length, label: label as Span["label"], score: 1, source: "ner", text });

const guard = {
  detectRedactions: async () => [span("EMAIL", "b@x.com", 20), span("GIVEN_NAME", "Alex", 11)],
  protect: async () => ({ text: "My name is [GIVEN_NAME_1.s], email [EMAIL_1.s]", placeholders: ["[GIVEN_NAME_1.s]", "[EMAIL_1.s]"] }),
  reveal: (r: string) => r.replaceAll("[GIVEN_NAME_1.s]", "Alex").replaceAll("[EMAIL_1.s]", "b@x.com"),
};

test("hands the reply source only redacted text, reveals, and maps correctly", async () => {
  let sawRedacted = "";
  const reply = async (redacted: string) => { sawRedacted = redacted; return "Hi [GIVEN_NAME_1.s]"; };
  const turn = await runTurn(guard, reply, "My name is Alex, email b@x.com");
  expect(sawRedacted).toBe("My name is [GIVEN_NAME_1.s], email [EMAIL_1.s]");
  expect(turn.reply).toBe("Hi Alex");
  expect(turn.mapping).toEqual([
    { placeholder: "[GIVEN_NAME_1.s]", label: "GIVEN_NAME", value: "Alex" },
    { placeholder: "[EMAIL_1.s]", label: "EMAIL", value: "b@x.com" },
  ]);
});
