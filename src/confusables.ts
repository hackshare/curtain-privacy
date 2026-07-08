// src/confusables.ts

/**
 * Curated cross-script confusables: characters from non-Latin scripts that read
 * as Latin letters or digits, mapped to their ASCII skeleton. NFKC already folds
 * fullwidth and mathematical-alphanumeric forms, so this table only carries the
 * cross-script residual (Cyrillic, Greek, and a few others). Values are always a
 * single ASCII character. Extend this table if the adversarial eval surfaces a
 * homoglyph that slips through.
 */
export const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic lowercase
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c",
  "у": "y", "х": "x", "і": "i", "ѕ": "s", "ј": "j",
  "һ": "h", "ԛ": "q", "ԝ": "w", "ԁ": "d",
  // Cyrillic uppercase
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M",
  "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T",
  "У": "Y", "Х": "X", "І": "I", "Ј": "J", "Ѕ": "S",
  // Greek lowercase
  "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v",
  "ο": "o", "ρ": "p", "υ": "u", "χ": "x",
  // Greek uppercase
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H",
  "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O",
  "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
  // Other common Latin lookalikes
  "ı": "i", // ı dotless i
  "ɡ": "g", // ɡ script g
};

export function foldConfusable(ch: string): string {
  return CONFUSABLES[ch] ?? ch;
}
