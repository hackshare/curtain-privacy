// src/normalize.test.ts
import { describe, it, expect } from "vitest";
import { normalizeForDetection, remapSpan } from "./normalize";
import type { Span } from "./types";

describe("normalizeForDetection", () => {
  it("removes zero-width and invisible characters", () => {
    // \u200B zero-width spaces interleaved between digits
    const nrm = normalizeForDetection("1\u200B2\u200B3");
    expect(nrm.text).toBe("123");
    expect(nrm.rawStart).toEqual([0, 2, 4]);
    expect(nrm.rawEnd).toEqual([1, 3, 5]);
  });

  it("NFKC-folds fullwidth forms to ASCII", () => {
    const nrm = normalizeForDetection("ＳＳＮ"); // fullwidth S, S, N
    expect(nrm.text).toBe("SSN");
  });

  it("folds confusables to Latin, preserving offsets", () => {
    const nrm = normalizeForDetection("jоhn"); // Cyrillic о (U+043E)
    expect(nrm.text).toBe("john");
    expect(nrm.rawEnd[nrm.rawEnd.length - 1]).toBe(4);
  });

  it("folds unusual spaces to a regular space", () => {
    // \u00A0 non-breaking space
    const nrm = normalizeForDetection("a\u00A0b");
    expect(nrm.text).toBe("a b");
  });

  it("preserves case", () => {
    expect(normalizeForDetection("AB-123").text).toBe("AB-123");
  });

  it("does not undo neutralized fullwidth brackets", () => {
    // U+FF3B fullwidth left bracket, U+FF3D fullwidth right bracket
    const nrm = normalizeForDetection("［SSN_1］");
    expect(nrm.text).toBe("［SSN_1］");
  });

  it("keeps the offset-map length invariant", () => {
    // café (é = accented e), \u200B zero-width space, fullwidth digits １２
    const nrm = normalizeForDetection("café \u200B １２");
    expect(nrm.rawStart.length).toBe(nrm.text.length);
    expect(nrm.rawEnd.length).toBe(nrm.text.length);
  });

  it("keeps offsets correct when NFKC expands one code point to many", () => {
    const original = "xﬁy"; // ﬁ is the ﬁ ligature; NFKC -> "fi"
    const nrm = normalizeForDetection(original);
    expect(nrm.text).toBe("xfiy");
    // both output chars 'f' and 'i' must map back to the single source code point at offset 1
    expect(nrm.rawStart[1]).toBe(1);
    expect(nrm.rawEnd[1]).toBe(2);
    expect(nrm.rawStart[2]).toBe(1);
    expect(nrm.rawEnd[2]).toBe(2);
    expect(nrm.rawStart.length).toBe(nrm.text.length);
  });

  it("folds an NFKC-resistant unusual space via the UNUSUAL_SPACE set", () => {
    const nrm = normalizeForDetection("a b"); // U+1680 OGHAM SPACE MARK has no NFKC decomposition
    expect(nrm.text).toBe("a b");
  });

  it("returns empty maps for all-invisible input", () => {
    // \u200B zero-width space, \u200C zero-width non-joiner, \u200D zero-width joiner
    const nrm = normalizeForDetection("\u200B\u200C\u200D");
    expect(nrm.text).toBe("");
    expect(nrm.rawStart).toEqual([]);
  });
});

describe("remapSpan", () => {
  it("maps a normalized-coordinate span back to the exact original substring", () => {
    // \u200B zero-width spaces inserted between digits of the SSN prefix
    const original = "call 1\u200B2\u200B3-45-6789 now";
    const nrm = normalizeForDetection(original);
    // "123-45-6789" occupies normalized offsets 5..16
    const start = nrm.text.indexOf("123-45-6789");
    const span: Span = {
      start,
      end: start + "123-45-6789".length,
      label: "SSN",
      score: 1,
      source: "heuristic",
      text: "123-45-6789",
    };
    const mapped = remapSpan(span, nrm, original);
    expect(original.slice(mapped.start, mapped.end)).toBe("1\u200B2\u200B3-45-6789");
    expect(mapped.text).toBe("1\u200B2\u200B3-45-6789");
  });
});
