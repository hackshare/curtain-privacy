/** Deterministic 32-bit PRNG (mulberry32) so a seed reproduces the exact corpus. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Insert a zero-width space between each pair of adjacent digits. */
export function injectZeroWidth(text: string): string {
  return text.replace(/(\d)(?=\d)/g, "$1\u200B");
}

const HOMOGLYPHS: Record<string, string> = {
  a: "а", e: "е", o: "о", p: "р", c: "с", x: "х",
};

/** Swap some Latin letters for Cyrillic lookalikes. */
export function homoglyphSwap(text: string): string {
  return text.replace(/[aeopcx]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
}

const FULLWIDTH_ZERO = 0xff10; // ０

/** Replace ASCII digits with fullwidth digits. */
export function fullwidthDigits(text: string): string {
  return text.replace(/\d/g, (d) => String.fromCharCode(FULLWIDTH_ZERO + (d.charCodeAt(0) - 48)));
}

/** Replace regular spaces with no-break spaces. */
export function nbspSpaces(text: string): string {
  return text.replace(/ /g, " ");
}

const TRANSFORMS = [injectZeroWidth, homoglyphSwap, fullwidthDigits, nbspSpaces];

/** Apply a seed-selected subset of transforms so each case is obfuscated but
 * reproducible. */
export function obfuscate(text: string, seed: number): string {
  const r = rng(seed);
  let out = text;
  for (const transform of TRANSFORMS) {
    if (r() < 0.7) out = transform(out);
  }
  return out;
}
