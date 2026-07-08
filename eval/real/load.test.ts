import { expect, test } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCases } from "./load.ts";

function fixture(...lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "realeval-"));
  const p = join(dir, "cases.jsonl");
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n"));
  return p;
}

test("resolves a value to its offsets", () => {
  const p = fixture({ id: "a", tier: "normal", text: "call 555-0100 today", redact: [{ label: "PHONE", value: "555-0100" }] });
  const c = loadCases(p)[0];
  expect(c.redact[0]).toMatchObject({ label: "PHONE", start: 5, end: 13 });
  expect(c.text.slice(c.redact[0].start, c.redact[0].end)).toBe("555-0100");
});

test("occurrence anchors the intended duplicate", () => {
  const p = fixture({ id: "b", tier: "messy", text: "Sam paged Sam", redact: [{ label: "GIVEN_NAME", value: "Sam", occurrence: 1 }] });
  const c = loadCases(p)[0];
  expect(c.redact[0].start).toBe(10); // the second "Sam"
});

test("keep terms need no label", () => {
  const p = fixture({ id: "c", tier: "normal", text: "order $240 now", keep: [{ value: "$240" }] });
  expect(loadCases(p)[0].keep[0]).toMatchObject({ value: "$240", start: 6, end: 10 });
});

test("throws with the case id on a missing value", () => {
  const p = fixture({ id: "bad1", tier: "normal", text: "no pii here", redact: [{ label: "EMAIL", value: "x@y.com" }] });
  expect(() => loadCases(p)).toThrow(/bad1.*x@y\.com/);
});

test("throws on an out-of-range occurrence", () => {
  const p = fixture({ id: "bad2", tier: "normal", text: "one Sam", redact: [{ label: "GIVEN_NAME", value: "Sam", occurrence: 1 }] });
  expect(() => loadCases(p)).toThrow(/bad2/);
});

test("throws on a bad tier", () => {
  const p = fixture({ id: "bad3", tier: "weird" as any, text: "hi", redact: [] });
  expect(() => loadCases(p)).toThrow(/bad3.*tier/);
});
