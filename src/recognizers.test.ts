import { expect, test } from "vitest";
import { extendSpans } from "./recognizers.ts";
import type { Span } from "./types.ts";

function span(text: string, start: number, end: number, label: string): Span {
  return { start, end, label: label as Span["label"], score: 1, source: "ner", text: text.slice(start, end) };
}
function ext(text: string, s: Span): Span {
  return extendSpans(text, [s])[0];
}

test("extends left to include a CHE- prefix", () => {
  const text = "VAT CHE-108-040-140 due";
  const core = text.indexOf("108-040-140");
  const out = ext(text, span(text, core, core + "108-040-140".length, "TAX_ID"));
  expect(text.slice(out.start, out.end)).toBe("CHE-108-040-140");
});

test("extends left to include a leading digit", () => {
  const text = "id 2-87-06-51750-056-48 x";
  const core = text.indexOf("06-51750-056-48");
  const out = ext(text, span(text, core, core + "06-51750-056-48".length, "SSN"));
  expect(text.slice(out.start, out.end)).toBe("2-87-06-51750-056-48");
});

test("extends both ways over an alphanumeric wrapper", () => {
  const text = "code Ame.Del.26.M.17.6.BYB end";
  const core = text.indexOf("M.17.6.BY");
  const out = ext(text, span(text, core, core + "M.17.6.BY".length, "SSN"));
  expect(text.slice(out.start, out.end)).toBe("Ame.Del.26.M.17.6.BYB");
});

test("stops at whitespace — does not swallow adjacent words", () => {
  const text = "SSN 123-45-6789 and Bob";
  const core = text.indexOf("123-45-6789");
  const out = ext(text, span(text, core, core + "123-45-6789".length, "SSN"));
  expect(text.slice(out.start, out.end)).toBe("123-45-6789");
});

test("trims a trailing sentence period", () => {
  const text = "id 123-45-6789. Next";
  const core = text.indexOf("123-45-6789");
  const out = ext(text, span(text, core, core + "123-45-6789".length, "SSN"));
  expect(text.slice(out.start, out.end)).toBe("123-45-6789");
});

test("non-target label (GIVEN_NAME) is returned unchanged", () => {
  const text = "Jean-Pierre";
  const out = ext(text, span(text, 0, 4, "GIVEN_NAME")); // "Jean"
  expect(out.start).toBe(0);
  expect(out.end).toBe(4);
});
