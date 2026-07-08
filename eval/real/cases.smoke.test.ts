import { expect, test } from "vitest";
import { loadCases } from "./load.ts";

const REDACT_CLASSES = [
  "GIVEN_NAME", "SURNAME", "EMAIL", "PHONE", "SSN", "CREDIT_CARD", "STREET_NAME",
  "BUILDING_NUMBER", "TAX_ID", "BANK_ACCOUNT", "ROUTING_NUMBER", "PASSPORT",
  "DRIVERS_LICENSE", "GOVERNMENT_ID", "IP_ADDRESS", "URL",
];

test("corpus loads with zero offset-resolution errors", () => {
  const cases = loadCases("eval/real/cases.jsonl");
  expect(cases.length).toBeGreaterThanOrEqual(150);
  expect(cases.length).toBeLessThanOrEqual(250);
});

test("both tiers are well represented (each >= 30%)", () => {
  const cases = loadCases("eval/real/cases.jsonl");
  for (const tier of ["normal", "messy"]) {
    const n = cases.filter((c) => c.tier === tier).length;
    expect(n / cases.length).toBeGreaterThanOrEqual(0.3);
  }
});

test("every redact-class has >= 8 occurrences", () => {
  const cases = loadCases("eval/real/cases.jsonl");
  const counts: Record<string, number> = {};
  for (const c of cases) for (const t of c.redact) counts[t.label ?? "?"] = (counts[t.label ?? "?"] ?? 0) + 1;
  for (const cls of REDACT_CLASSES) expect(counts[cls] ?? 0, `class ${cls}`).toBeGreaterThanOrEqual(8);
});

test(">= 20 keep landmines with >= 5 PII-mimicking numbers", () => {
  const cases = loadCases("eval/real/cases.jsonl");
  const keeps = cases.flatMap((c) => c.keep);
  expect(keeps.length).toBeGreaterThanOrEqual(20);
  const numberish = keeps.filter((k) => /[0-9]/.test(k.value)).length;
  expect(numberish).toBeGreaterThanOrEqual(5);
});
