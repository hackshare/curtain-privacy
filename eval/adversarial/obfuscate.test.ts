import { describe, it, expect } from "vitest";
import { injectZeroWidth, homoglyphSwap, fullwidthDigits, nbspSpaces, obfuscate } from "./obfuscate";
import { normalizeForDetection } from "../../src/normalize";

describe("obfuscators", () => {
  it("injectZeroWidth adds characters that normalization removes", () => {
    const out = injectZeroWidth("123456789");
    expect(out).not.toBe("123456789");
    expect(normalizeForDetection(out).text).toBe("123456789");
  });

  it("homoglyphSwap changes bytes but normalizes back to ASCII", () => {
    const out = homoglyphSwap("john@example.com");
    expect(normalizeForDetection(out).text).toBe("john@example.com");
  });

  it("fullwidthDigits normalizes back to ASCII digits", () => {
    const out = fullwidthDigits("555");
    expect(out).not.toBe("555");
    expect(normalizeForDetection(out).text).toBe("555");
  });

  it("nbspSpaces normalizes back to regular spaces", () => {
    const input = "a b c";
    const out = nbspSpaces(input);
    expect(out).not.toBe(input);
    expect(normalizeForDetection(out).text).toBe("a b c");
  });

  it("obfuscate is deterministic for a fixed seed", () => {
    expect(obfuscate("john@example.com 123-45-6789", 7)).toBe(
      obfuscate("john@example.com 123-45-6789", 7),
    );
  });
});
