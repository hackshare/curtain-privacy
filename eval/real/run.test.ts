import { expect, test } from "vitest";
import type { Span } from "../../src/types.ts";
import type { ResolvedCase } from "./load.ts";
import { runEval } from "./run.ts";
import { renderResults } from "./report.ts";

const cases: ResolvedCase[] = [
  { id: "a", tier: "normal", text: "mail a@b.com keep $240",
    redact: [{ label: "EMAIL", value: "a@b.com", start: 5, end: 12 }],
    keep: [{ value: "$240", start: 18, end: 22 }] },
  { id: "b", tier: "messy", text: "ssn 123-45-6789",
    redact: [{ label: "SSN", value: "123-45-6789", start: 4, end: 15 }], keep: [] },
];

// stub guard: redacts the email fully, MISSES the ssn, and over-grabs $240
const stub = async (text: string): Promise<Span[]> => {
  if (text.startsWith("mail")) return [
    { start: 5, end: 12, label: "EMAIL", score: 1, source: "heuristic", text: "" },
    { start: 18, end: 22, label: "SSN", score: 1, source: "heuristic", text: "" },
  ];
  return [];
};

test("runEval scores leaks and keep-violations from the detector", async () => {
  const r = await runEval(cases, stub);
  expect(r.cases).toBe(2);
  expect(r.overall.protectedRate).toBe(0.5);            // email protected, ssn leaked
  expect(r.overall.keepViolationRate).toBe(1);          // $240 grabbed
  expect(r.leaks.map((l) => l.value)).toEqual(["123-45-6789"]);
  expect(r.violations.map((v) => v.value)).toEqual(["$240"]);
});

test("renderResults produces the headline + inspection sections", async () => {
  const md = renderResults(await runEval(cases, stub));
  expect(md).toContain("# Real-World Eval Results");
  expect(md).toContain("protected_rate");
  expect(md).toContain("123-45-6789");   // leak is listed
  expect(md).toContain("$240");          // violation is listed
});
