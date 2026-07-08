import { expect, test } from "vitest";
import { collectRowsPerLang } from "./fetch.ts";
import type { RawItem } from "../bench/fetch.ts";

function page(langs: string[], base: number): RawItem[] {
  return langs.map((language, i) => ({
    row: { uid: base + i, language, source_text: `t${base + i}`, privacy_mask: [] },
  }));
}

test("collects up to perLang per language and stops when full", async () => {
  const pages: Record<number, RawItem[]> = {
    0: page(["en", "en", "vi"], 0),
    100: page(["vi", "vi", "en"], 100),
    200: page(["en", "vi"], 200),
  };
  const offsets = [0, 100, 200];
  const out = await collectRowsPerLang(
    offsets,
    async (o) => pages[o],
    2,
    new Set(["en", "vi"]),
    2,
  );
  const byLang = out.reduce<Record<string, number>>((a, r) => {
    a[r.language] = (a[r.language] ?? 0) + 1;
    return a;
  }, {});
  expect(byLang).toEqual({ en: 2, vi: 2 });
});

test("ignores languages not requested", async () => {
  const out = await collectRowsPerLang(
    [0],
    async () => page(["de", "en"], 0),
    5,
    new Set(["en"]),
    1,
  );
  expect(out.map((r) => r.language)).toEqual(["en"]);
});
