import { expect, test } from "vitest";
import { detectPassport } from "./passport";

const ids = (text: string) => detectPassport(text).map((s) => s.text);

test("detects a passport code when a passport cue precedes it", () => {
  expect(ids("passport no. X1234567 issued")).toEqual(["X1234567"]);
  expect(ids("my passport is 987654321")).toEqual(["987654321"]);
});

test("does not fire without the passport cue", () => {
  expect(ids("the code X1234567 is internal")).toEqual([]);
});

test("does not match a word-shaped candidate with no digit", () => {
  expect(ids("passport photo ABCDEFG looks great")).toEqual([]);
});

test("emits PASSPORT spans with the heuristic shape", () => {
  const [span] = detectPassport("passport X1234567");
  expect(span).toMatchObject({ label: "PASSPORT", score: 1, source: "heuristic" });
});
