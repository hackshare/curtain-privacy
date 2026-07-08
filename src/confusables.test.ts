// src/confusables.test.ts
import { describe, it, expect } from "vitest";
import { foldConfusable, CONFUSABLES } from "./confusables";

describe("foldConfusable", () => {
  it("folds Cyrillic lookalikes to Latin", () => {
    expect(foldConfusable("а")).toBe("a"); // а
    expect(foldConfusable("о")).toBe("o"); // о
    expect(foldConfusable("е")).toBe("e"); // е
    expect(foldConfusable("р")).toBe("p"); // р
    expect(foldConfusable("с")).toBe("c"); // с
  });

  it("folds Greek lookalikes to Latin", () => {
    expect(foldConfusable("ο")).toBe("o"); // ο
    expect(foldConfusable("Α")).toBe("A"); // Α
  });

  it("leaves ASCII and unrelated characters unchanged", () => {
    expect(foldConfusable("a")).toBe("a");
    expect(foldConfusable("Z")).toBe("Z");
    expect(foldConfusable("7")).toBe("7");
    expect(foldConfusable("@")).toBe("@");
    expect(foldConfusable("中")).toBe("中"); // 中, out of scope
  });

  it("maps every table value to a single ASCII character", () => {
    for (const value of Object.values(CONFUSABLES)) {
      expect(value).toMatch(/^[\x21-\x7E]$/);
    }
  });
});
