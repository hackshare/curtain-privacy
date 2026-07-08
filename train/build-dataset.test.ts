import { expect, test } from "vitest";
import { buildExample } from "./build-dataset.ts";

const row = (source_text: string, mask: { label: string; start: number; end: number; value: string }[]) => ({
  uid: 1,
  language: "en",
  source_text,
  privacy_mask: mask,
});

test("maps a name span onto folded text with correct offsets", () => {
  const ex = buildExample(
    row("Contact José Réyes today", [
      { label: "GIVENNAME", start: 8, end: 12, value: "José" },
      { label: "SURNAME", start: 13, end: 18, value: "Réyes" },
    ]),
  );
  expect(ex.text).toBe("contact jose reyes today"); // folded
  const given = ex.spans.find((s) => s.label === "GIVEN_NAME")!;
  expect(ex.text.slice(given.start, given.end)).toBe("jose"); // offsets re-projected through the fold
});

test("premasks SSN/CREDIT_CARD/IP_ADDRESS to sentinels; keeps EMAIL as a class", () => {
  // SOCIALNUM is the exact key in OPENPII_TO_OURS that maps to SSN
  const ex = buildExample(
    row("ssn 123-45-6789 mail a@b.com", [
      { label: "SOCIALNUM", start: 4, end: 15, value: "123-45-6789" },
      { label: "EMAIL", start: 21, end: 28, value: "a@b.com" },
    ]),
  );
  expect(ex.text).toContain("[ssn]"); // sentinel (folded → lowercased)
  expect(ex.spans.some((s) => s.label === "SSN")).toBe(false); // SSN not a training label
  const email = ex.spans.find((s) => s.label === "EMAIL")!;
  expect(ex.text.slice(email.start, email.end)).toBe("a@b.com");
});

test("dates/ages/income map to O (no span emitted)", () => {
  const ex = buildExample(
    row("born 1990 age 34", [
      { label: "DATE", start: 5, end: 9, value: "1990" },
      { label: "AGE", start: 14, end: 16, value: "34" },
    ]),
  );
  expect(ex.spans).toHaveLength(0);
});
