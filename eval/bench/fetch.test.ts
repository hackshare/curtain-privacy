import { describe, it, expect } from "vitest";
import { collectRows, arg } from "./fetch.ts";

interface RawItem {
  row: { uid: number; language: string; source_text: string; privacy_mask: unknown };
}

// Build a page of canned rows. uid and language are the interesting fields.
function makeItem(uid: number, language: string): RawItem {
  return { row: { uid, language, source_text: `text-${uid}`, privacy_mask: [] } };
}

const isLatin = (lang: string): boolean => new Set(["en", "es", "fr", "de", "it", "pt", "nl"]).has(lang);

// Reference: synchronous sequential filter — what collectRows must match.
function seqReference(pages: RawItem[][], n: number): number[] {
  const result: number[] = [];
  const seen = new Set<number>();
  for (const page of pages) {
    for (const item of page) {
      if (result.length >= n) break;
      const r = item.row;
      if (!isLatin(r.language) || seen.has(r.uid)) continue;
      seen.add(r.uid);
      result.push(r.uid);
    }
    if (result.length >= n) break;
  }
  return result;
}

describe("arg", () => {
  it("absent flag returns fallback (regression: was returning argv[0])", () => {
    // argv has no --concurrency flag; must return the fallback, not argv[0]
    expect(arg("concurrency", "8", ["bun", "--n", "40", "--seed", "0"])).toBe("8");
  });

  it("--name=value form returns value", () => {
    expect(arg("concurrency", "8", ["bun", "--concurrency=4"])).toBe("4");
  });

  it("--name value form returns value", () => {
    expect(arg("concurrency", "8", ["bun", "--concurrency", "4"])).toBe("4");
  });

  it("--name immediately followed by another --flag returns fallback", () => {
    expect(arg("concurrency", "8", ["bun", "--concurrency", "--seed", "0"])).toBe("8");
  });
});

describe("collectRows", () => {
  it("completion-order independence: same result regardless of promise resolution order", async () => {
    // 4 pages, mix of Latin and non-Latin
    const pages: RawItem[][] = [
      [makeItem(1, "en"), makeItem(2, "zh"), makeItem(3, "fr")],
      [makeItem(4, "de"), makeItem(5, "ja"), makeItem(6, "es")],
      [makeItem(7, "it"), makeItem(8, "ar"), makeItem(9, "nl")],
      [makeItem(10, "pt"), makeItem(11, "ko"), makeItem(12, "en")],
    ];
    const offsets = [0, 100, 200, 300];
    const n = 8;

    // Fetcher A: resolves immediately in call order
    const fetcherA = (offset: number): Promise<RawItem[]> => {
      const idx = offsets.indexOf(offset);
      return Promise.resolve(pages[idx]);
    };

    // Fetcher B: stagger resolution — later pages resolve first via extra microtask delays
    const fetcherB = (offset: number): Promise<RawItem[]> => {
      const idx = offsets.indexOf(offset);
      // Pages 2 and 3 resolve after extra microtask ticks to simulate out-of-order resolution
      const extraTicks = idx % 2 === 0 ? 3 : 0;
      let p: Promise<RawItem[]> = Promise.resolve(pages[idx]);
      for (let i = 0; i < extraTicks; i++) p = p.then((v) => v);
      return p;
    };

    const [resultA, resultB] = await Promise.all([
      collectRows(offsets, fetcherA, n, isLatin, 2),
      collectRows(offsets, fetcherB, n, isLatin, 2),
    ]);

    const uidsA = resultA.map((r) => r.uid);
    const uidsB = resultB.map((r) => r.uid);
    const expected = seqReference(pages, n);

    expect(uidsA).toEqual(expected);
    expect(uidsB).toEqual(expected);
  });

  it("stops at exactly n rows, honoring mid-page stop", async () => {
    // Each page has 3 Latin rows; n=5 means we stop inside the second page
    const pages: RawItem[][] = [
      [makeItem(1, "en"), makeItem(2, "fr"), makeItem(3, "de")],
      [makeItem(4, "es"), makeItem(5, "it"), makeItem(6, "nl")],
      [makeItem(7, "pt"), makeItem(8, "en"), makeItem(9, "fr")],
    ];
    const offsets = [0, 100, 200];
    const n = 5;

    const fetcher = (offset: number): Promise<RawItem[]> => {
      const idx = offsets.indexOf(offset);
      return Promise.resolve(pages[idx]);
    };

    const result = await collectRows(offsets, fetcher, n, isLatin, 4);

    expect(result.length).toBe(n);
    // First 3 from page 0, then 4 and 5 from page 1
    expect(result.map((r) => r.uid)).toEqual([1, 2, 3, 4, 5]);
  });

  it("errors are not swallowed: a rejected fetchPage propagates", async () => {
    const pages: RawItem[][] = [
      [makeItem(1, "en"), makeItem(2, "fr")],
      [makeItem(3, "de"), makeItem(4, "es")],
    ];
    const offsets = [0, 100];

    // Second page rejects
    const fetcher = (offset: number): Promise<RawItem[]> => {
      if (offset === 100) return Promise.reject(new Error("network failure"));
      return Promise.resolve(pages[0]);
    };

    await expect(collectRows(offsets, fetcher, 10, isLatin, 2)).rejects.toThrow("network failure");
  });
});
