import { expect, test } from "vitest";
import { detectCuedIds } from "./cued-ids";

const rule = { candidate: /\b[A-Z]{2,5}-?\d{4,12}\b/g, cues: /\bcue\b/, label: "GOVERNMENT_ID" as const };
const ids = (text: string) => detectCuedIds(text, rule).map((s) => s.text);

test("emits a candidate only when a cue precedes it in the window", () => {
  expect(ids("cue AB-1234 here")).toEqual(["AB-1234"]);
  expect(ids("no marker AB-1234 here")).toEqual([]);
});

test("skips a '#'-prefixed order code even with a cue nearby", () => {
  expect(ids("cue #AB-1234")).toEqual([]);
});

test("clamps the cue window to the previous match so a cue cannot bleed forward", () => {
  // 'cue' is far (>48 chars) before the second code; the first code ends between them.
  const text = "cue AB-1234" + " ".repeat(50) + "CD-5678";
  expect(ids(text)).toEqual(["AB-1234"]);
});

test("emits the existing-label span shape", () => {
  const [span] = detectCuedIds("cue AB-1234", rule);
  expect(span).toMatchObject({ start: 4, end: 11, label: "GOVERNMENT_ID", score: 1, source: "heuristic", text: "AB-1234" });
});
