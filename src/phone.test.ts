import { expect, test } from "vitest";
import { detectCuedPhone } from "./phone";

const phones = (text: string) => detectCuedPhone(text).map((s) => s.text);

test("detects a formatted number near a phone cue", () => {
  expect(phones("call me at 0721 234 567 tomorrow")).toContain("0721 234 567");
  expect(phones("phone (030) 1234 5678")).toContain("(030) 1234 5678");
});

test("does not match a bare digit run even next to a cue", () => {
  expect(phones("order 12345678 by phone")).toEqual([]);
});

test("does not match a formatted number with no cue nearby", () => {
  expect(phones("the ratio was 30-1234-5678 overall")).toEqual([]);
});

test("emits PHONE spans with the heuristic shape", () => {
  const [span] = detectCuedPhone("call 0721 234 567");
  expect(span).toMatchObject({ label: "PHONE", score: 1, source: "heuristic" });
});
