import { expect, test } from "vitest";
import { ChatGuard } from "./guard.ts";
import type { Span } from "./types.ts";

test("detectRedactions returns redact-class spans and drops keep-set labels", async () => {
  const text = "Alice lives in Boston";
  const at = (needle: string) => text.indexOf(needle);
  const ner = async (): Promise<Span[]> => [
    { start: at("Alice"), end: at("Alice") + 5, label: "GIVEN_NAME", score: 0.9, source: "ner", text: "Alice" },
    { start: at("Boston"), end: at("Boston") + 6, label: "CITY", score: 0.9, source: "ner", text: "Boston" },
  ];
  // noPrefilter so the stub ner's original-text offsets are used directly (no premask shift).
  const guard = new ChatGuard({ ner, noPrefilter: true });
  const spans = await guard.detectRedactions(text);
  const covers = (s: number, e: number) => spans.some((sp) => sp.start <= s && sp.end >= e);
  expect(covers(at("Alice"), at("Alice") + 5)).toBe(true);   // redact-class -> redacted
  expect(covers(at("Boston"), at("Boston") + 6)).toBe(false); // keep-set -> dropped
});
