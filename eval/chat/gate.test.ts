import { expect, test } from "vitest";
import { build, speakerCases, salutationCases, initialCases, scoreCase, type Span } from "./fixtures.ts";

test("build records offsets that slice back to the tagged tokens", () => {
  const c = build([["Hi "], ["John", "redact"], [" from "], ["NYC", "keep"], ["."]]);
  expect(c.text).toBe("Hi John from NYC.");
  expect(c.redact.map((r) => c.text.slice(r.start, r.end))).toEqual(["John"]);
  expect(c.keep.map((k) => c.text.slice(k.start, k.end))).toEqual(["NYC"]);
});

test("every fixture token slices to a real word and redact/keep never overlap", () => {
  for (const c of [...speakerCases(), ...salutationCases(), ...initialCases()]) {
    for (const r of c.redact) expect(c.text.slice(r.start, r.end).trim().length).toBeGreaterThan(0);
    for (const k of c.keep) expect(c.text.slice(k.start, k.end).trim().length).toBeGreaterThan(0);
    for (const r of c.redact) for (const k of c.keep) expect(r.start < k.end && k.start < r.end).toBe(false);
  }
});

test("fixtures are deterministic and cover the templates", () => {
  expect(speakerCases().map((c) => c.text)).toEqual(speakerCases().map((c) => c.text));
  expect(speakerCases().length).toBeGreaterThan(120);
  expect(salutationCases().length).toBeGreaterThan(24);
  // Every salutation case marks the greeting keep and the name redact.
  for (const c of salutationCases()) { expect(c.keep.length).toBe(1); expect(c.redact.length).toBe(1); }
});

test("scoreCase recalls a covered redact token and reports an uncovered one as a leak", () => {
  const c = build([["Hi "], ["John", "redact"]]);
  expect(scoreCase(c, [{ start: 3, end: 7 }])).toMatchObject({ redTot: 1, redHit: 1, leaks: [] });
  expect(scoreCase(c, [] as Span[])).toMatchObject({ redTot: 1, redHit: 0, leaks: ["John"] });
});

test("scoreCase flags a covered keep token as over-redaction", () => {
  const c = build([["Hi", "keep"], [" "], ["John", "redact"]]);
  const r = scoreCase(c, [{ start: 0, end: 7 }]); // one span covering "Hi John"
  expect(r.keepViol).toBe(1);
  expect(r.over).toEqual(["Hi"]);
  expect(r.redHit).toBe(1);
});
