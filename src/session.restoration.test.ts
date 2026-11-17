import { expect, test } from "vitest";
import { createGuard } from "./guard";
import { SessionEntityTable } from "./session";
import type { Span } from "./types";

// Synthetic detector spans; no model or captured user input is needed.
function person(raw: string, value: string, score = 0.9): Span {
  const start = raw.indexOf(value);
  return { start, end: start + value.length, text: value, score, label: "GIVEN_NAME", source: "ner" };
}

test("restores the full union when a shorter, higher-confidence span wins", () => {
  const table = new SessionEntityTable();
  const raw = "amelia brooks";
  const result = table.scrub(raw, [person(raw, "amelia"), person(raw, raw, 0.8)]);
  expect(result.placeholders).toHaveLength(1);
  expect(result.text).toBe(result.placeholders[0]);
  expect(table.rehydrate(result.text)).toBe(raw);
});

test("restores a chain of overlapping spans with surrounding text unchanged", () => {
  const table = new SessionEntityTable();
  const raw = "Meet Ana Lee Park today.";
  const result = table.scrub(raw, [person(raw, "Ana Lee"), person(raw, "Lee Park", 0.8)]);
  expect(result.placeholders).toHaveLength(1);
  expect(result.text).toBe(`Meet ${result.placeholders[0]} today.`);
  expect(table.rehydrate(result.text)).toBe(raw);
});

test("slices merged intervals using original UTF-16 offsets", () => {
  const table = new SessionEntityTable();
  const raw = "🙂 Zoë Smith!";
  const result = table.scrub(raw, [person(raw, "Zoë"), person(raw, "Zoë Smith", 0.8)]);
  expect(result.placeholders).toHaveLength(1);
  expect(result.text).toBe(`🙂 ${result.placeholders[0]}!`);
  expect(table.rehydrate(result.text)).toBe(raw);
});

test("stores the original spelling rather than a detector's normalized text", () => {
  const table = new SessionEntityTable();
  const raw = "Zoë";
  const result = table.scrub(raw, [{ ...person(raw, raw), text: "Zoe" }]);
  expect(table.rehydrate(result.text)).toBe(raw);
});

test("uses the original input for multiple right-to-left replacements", () => {
  const table = new SessionEntityTable();
  const raw = "Meet Ana Lee and Zoe Park.";
  const result = table.scrub(raw, [
    person(raw, "Ana Lee", 0.8), person(raw, "Lee"),
    person(raw, "Zoe Park", 0.8), person(raw, "Zoe"),
  ]);
  expect(result.placeholders).toHaveLength(2);
  expect(result.text).toBe(`Meet ${result.placeholders[0]} and ${result.placeholders[1]}.`);
  expect(table.rehydrate(result.text)).toBe(raw);
});

test("reuses the complete value's token even if the next detection is shorter", () => {
  const table = new SessionEntityTable();
  const raw = "Nora Vega";
  const first = table.scrub(raw, [person(raw, raw)]);
  const second = table.scrub(raw, [person(raw, "Nora"), person(raw, raw, 0.8)]);
  expect(second).toEqual(first);
  expect(table.rehydrate(second.text)).toBe(raw);
});

test("keeps normalized identity and first-seen spelling across later variants", () => {
  const table = new SessionEntityTable();
  const firstRaw = "Ana  Lee";
  const laterRaw = "ANA LEE";
  const first = table.scrub(firstRaw, [person(firstRaw, firstRaw)]);
  const later = table.scrub(laterRaw, [person(laterRaw, laterRaw)]);
  expect(later).toEqual(first);
  // This patch does not change the existing normalized-value identity contract.
  expect(table.rehydrate(later.text)).toBe(firstRaw);
});

test("retains the redact-class winner and alias when it overlaps a kept span", () => {
  const table = new SessionEntityTable({ GIVEN_NAME: "NAME" });
  const raw = "New York";
  const result = table.scrub(raw, [
    { ...person(raw, raw, 1), label: "CITY" },
    person(raw, "York", 0.8),
  ]);
  expect(result.placeholders).toHaveLength(1);
  expect(result.text).toMatch(/^\[NAME_1\.[0-9a-f]+\]$/);
  expect(table.rehydrate(result.text)).toBe(raw);
});

test.each(["protect", "protectReply"] as const)("%s restores merged intervals through the guard API", async (method) => {
  const raw = "Meet amelia brooks today.";
  const guard = await createGuard({
    ner: async (text) => [person(text, "amelia"), person(text, "amelia brooks", 0.8)],
  });
  const result = await guard[method](raw);
  expect(result.placeholders).toHaveLength(1);
  expect(result.text).toBe(`Meet ${result.placeholders[0]} today.`);
  expect(guard.reveal(result.text)).toBe(raw);
});
