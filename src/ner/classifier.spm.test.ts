import { expect, test } from "vitest";
import { detectNer, type TokenClassifier } from "./classifier.ts";

/** A bare mock classifier that returns pre-set BIO entities (by token index) and
 * exposes SentencePiece-style tokens (▁ = word start, cased), so detectNer's
 * offset reconstruction is exercised for XLM-R without a trained model. */
function spmMock(
  tokens: string[],
  entities: { entity: string; index: number; word: string; score?: number }[],
): TokenClassifier {
  const fn = (async () =>
    entities.map((e) => ({ entity: e.entity, index: e.index, word: e.word, score: e.score ?? 0.99, start: 0, end: 0 }))) as TokenClassifier;
  fn.tokenize = () => tokens;
  return fn;
}

test("SentencePiece: single-token names map to correct raw offsets", async () => {
  // XLM-R tokens for "Wei Chen was here": ▁-prefixed, cased.
  const mock = spmMock(
    ["▁Wei", "▁Chen", "▁was", "▁here"],
    [{ entity: "B-GIVEN_NAME", index: 1, word: "▁Wei" }, { entity: "B-SURNAME", index: 2, word: "▁Chen" }],
  );
  const spans = await detectNer("Wei Chen was here", mock, 0.4);
  const g = spans.find((s) => s.label === "GIVEN_NAME");
  const su = spans.find((s) => s.label === "SURNAME");
  expect(g && [g.start, g.end, g.text]).toEqual([0, 3, "Wei"]);
  expect(su && [su.start, su.end, su.text]).toEqual([4, 8, "Chen"]);
});

test("SentencePiece: continuation tokens merge (▁River + a = Rivera)", async () => {
  const mock = spmMock(
    ["▁Alex", "▁River", "a"],
    [
      { entity: "B-GIVEN_NAME", index: 1, word: "▁Alex" },
      { entity: "B-SURNAME", index: 2, word: "▁River" },
      { entity: "I-SURNAME", index: 3, word: "a" },
    ],
  );
  const spans = await detectNer("Alex Rivera", mock, 0.4);
  const su = spans.find((s) => s.label === "SURNAME");
  expect(su && [su.start, su.end, su.text]).toEqual([5, 11, "Rivera"]);
});
