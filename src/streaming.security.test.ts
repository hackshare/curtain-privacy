import { expect, test } from "vitest";
import { StreamingReveal } from "./streaming";

const salt = "abcdef012345";
const resolve = (token: string): string | null =>
  token === `[SSN_1.${salt}]` ? "123-45-6789" : null;

test("a salted token split across chunks is revealed whole", () => {
  const reveal = new StreamingReveal(resolve);
  const parts = ["thanks [SS", "N_1.abc", "def012", "345] bye"];
  const out = parts.map((p) => reveal.push(p)).join("") + reveal.flush();
  expect(out).toBe("thanks 123-45-6789 bye");
});

test("an unclosed '[' flood stays linear (bounded held buffer)", () => {
  const reveal = new StreamingReveal(resolve);
  // 200k of '[AAAA...' that can never close would be O(n^2) if held whole.
  const chunk = "[" + "A".repeat(50_000);
  const start = performance.now();
  let out = "";
  for (let i = 0; i < 8; i++) out += reveal.push(chunk);
  out += reveal.flush();
  const ms = performance.now() - start;
  // The full input must survive (nothing dropped) and it must be fast.
  expect(out.length).toBe(chunk.length * 8);
  expect(ms).toBeLessThan(1000);
});
