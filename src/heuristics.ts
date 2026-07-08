/**
 * Heuristic detectors: the cheap, synchronous, zero-model first pass.
 *
 * Digit-bearing PII (SSN, card, phone, routing) is found over the *digit
 * projection* (see normalize.ts) so every separator variant collapses to one
 * rule: `888-88-8888`, `888 88 8888`, `888.88.8888`, and `888888888` all match.
 * Text-shaped PII (email, URL, IP) is matched on the raw string where the
 * structure lives in the punctuation.
 */

import type { PiiLabel, Span } from "./types";
import { isLuhnValid, isValidSsn } from "./validators";
import { detectGovernmentIds } from "./gov-id";
import { detectCuedPhone } from "./phone";
import { detectPassport } from "./passport";

/** A fixed-length digit candidate paired with its label and validator. */
interface DigitRule {
  readonly label: PiiLabel;
  /** Exact digit lengths to try, longest first so cards beat SSN/phone. */
  readonly lengths: readonly number[];
  /** Returns true if the digit slice is a real instance of this entity. */
  readonly validate: (digits: string) => boolean;
}

// Order matters: longer/stricter entities are tried first so a 16-digit card is
// never carved into a 9-digit "SSN". Overlap is also resolved later in merge.
const DIGIT_RULES: readonly DigitRule[] = [
  { label: "CREDIT_CARD", lengths: [19, 18, 17, 16, 15, 14, 13], validate: isLuhnValid },
  { label: "SSN", lengths: [9], validate: isValidSsn },
];

/**
 * A contiguous digit run with its inline separators, e.g. `888 12 3456`. Runs
 * never span a letter or other word boundary, so digits from different fields
 * ("...3456 and income is 50000") can't merge into one phantom candidate.
 */
interface DigitRun {
  /** Separator-free digits of the run. */
  readonly digits: string;
  /** `rawIndex[i]` is the raw offset of `digits[i]`. */
  readonly rawIndex: number[];
}

// A run is digits joined only by single inline separators (space, dash, dot).
const DIGIT_RUN = /\d(?:[ .-]?\d)*/g;

function extractRuns(raw: string): DigitRun[] {
  const runs: DigitRun[] = [];
  DIGIT_RUN.lastIndex = 0;
  for (let m = DIGIT_RUN.exec(raw); m !== null; m = DIGIT_RUN.exec(raw)) {
    const digits: string[] = [];
    const rawIndex: number[] = [];
    for (let i = 0; i < m[0].length; i++) {
      const code = m[0].charCodeAt(i);
      if (code >= 0x30 && code <= 0x39) {
        digits.push(m[0][i]);
        rawIndex.push(m.index + i);
      }
    }
    runs.push({ digits: digits.join(""), rawIndex });
  }
  return runs;
}

/**
 * Scan each digit run for fixed-length, validator-backed entities. A candidate
 * is anchored to the *whole* run (start..len and end-len..end) so we only match
 * when the run length equals the entity length — preventing a 9-digit SSN from
 * firing inside a longer account number. The raw span includes interior
 * separators so redaction covers `888-12-3456` whole.
 */
function detectDigitEntities(raw: string): Span[] {
  const spans: Span[] = [];
  for (const run of extractRuns(raw)) {
    for (const rule of DIGIT_RULES) {
      if (!rule.lengths.includes(run.digits.length)) continue;
      if (!rule.validate(run.digits)) continue;
      const start = run.rawIndex[0];
      const end = run.rawIndex[run.rawIndex.length - 1] + 1;
      spans.push({ start, end, label: rule.label, score: 1, source: "heuristic", text: raw.slice(start, end) });
      break; // first matching rule (rules are ordered strict→loose) wins the run
    }
  }
  return spans;
}

// Text-shaped entities: structure lives in the punctuation, so match raw.
// EMAIL and URL are structured text-shaped PII: a regex catches them at near-
// 100% recall, far better than the model (URL recall is ~5% model-alone), so
// the deterministic layer owns them and premasks them to sentinels before the
// model — exactly as it does for SSN/CC/IP. The model's vestigial EMAIL/URL
// head no longer needs to fire.
const TEXT_RULES: readonly { label: PiiLabel; pattern: RegExp; group?: number }[] = [
  // Email: local part (with +tags and dots) @ dotted domain. Matches Unicode
  // letters and digits so accented local parts (e.g. `mémoichon@`) are captured
  // whole. Whitespace still bounds the match — space in the local part clips it.
  // Negative lookbehind anchors the scan to run starts so the engine never
  // restarts inside a long whitespace-free token (avoids O(n²) backtracking).
  { label: "EMAIL", pattern: /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu },
  // URL with explicit scheme: everything up to whitespace / closing bracket /
  // quote. Trailing sentence punctuation is left in the span (harmless — the
  // sensitive host+path is what matters and the whole run is redacted).
  { label: "URL", pattern: /\bhttps?:\/\/[^\s<>"'\])}]+/g },
  // Schemeless web URL: `www.` host followed by the rest of the URL. Unicode
  // letters cover accented hostnames (e.g. `www.café.fr`).
  { label: "URL", pattern: /\bwww\.[\p{L}\p{N}.-]+\.[\p{L}]{2,}(?:\/[^\s<>"'\])}]*)?/gu },
  { label: "IP_ADDRESS", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  // IPv6: full and `::`-compressed forms. Every alternative requires either 8
  // colon-separated groups or a `::`, so it never fires on times ("12:34") or
  // MAC addresses (handled below); the lookarounds keep it off larger tokens.
  {
    label: "IP_ADDRESS",
    pattern:
      /(?<![:.\w])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}|::(?:[0-9A-Fa-f]{1,4}:){0,6}[0-9A-Fa-f]{1,4})(?![:.\w])/g,
  },
  // MAC address: six hex pairs joined by ":" or "-".
  { label: "IP_ADDRESS", pattern: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g },
  // Driver's-license format XX-NNNNNN (two letters, hyphen, six digits). Runs on
  // raw text before the model, so its redact-class span overrides the model's
  // tendency to tag the two-letter prefix as a kept STATE code.
  { label: "DRIVERS_LICENSE", pattern: /\b[A-Z]{2}-\d{6}\b/g },
  // NANP phone: optional +1, area + exchange (first digit 2-9, the NANP rule
  // that keeps this off dates/SSN/CC/IP and bare account numbers), a required
  // separator between groups, 4-digit subscriber. Conservative: formatted
  // 10-digit only — no bare digit runs, 7-digit locals, or extensions. Boundary
  // guards keep it from matching inside a longer digit sequence. Premasked with
  // the other text-shaped PII, so the model's PHONE head is a backstop.
  {
    label: "PHONE",
    pattern: /(?<!\d)(?:\+?1[-.\s])?\(?[2-9]\d{2}\)?[-.\s][2-9]\d{2}[-.\s]\d{4}(?!\d)/g,
  },
  // Secondary address line: an apartment/unit/suite designator followed by a
  // number (optionally '#'-prefixed, with an optional trailing letter like 4B).
  // Requires the designator keyword and a digit, so bare '#4B' and keyword-only
  // "Suite Life" do not match. Not premasked (see premask.ts) so the model keeps
  // the surrounding address context.
  {
    label: "SECONDARY_ADDRESS",
    pattern: /\b(?:apartment|apt|unit|suite|ste|room|rm|floor|building|bldg)\.?\s*#?\s*[A-Za-z]?\d{1,5}[A-Za-z]?\b/gi,
  },
  // E.164 international phone: an explicit leading '+' (the precision anchor)
  // followed by a bounded run of digits and separators. Not premasked (PHONE is
  // in NO_PREMASK_LABELS). Overlaps with the NANP rule are resolved in merge.
  { label: "PHONE", pattern: /(?<!\d)\+\d[\d().\s-]{7,17}\d(?!\d)/g },
];

function detectTextEntities(raw: string): Span[] {
  const spans: Span[] = [];
  for (const { label, pattern, group } of TEXT_RULES) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(raw); m !== null; m = pattern.exec(raw)) {
      const text = group === undefined ? m[0] : m[group];
      const offset = group === undefined ? 0 : m[0].indexOf(text);
      spans.push({
        start: m.index + offset,
        end: m.index + offset + text.length,
        label,
        score: 1,
        source: "heuristic",
        text,
      });
    }
  }
  return spans;
}

/** Run all heuristic detectors over the raw input. Spans may overlap; the
 * pipeline's merge step resolves conflicts before redaction. */
export function detectHeuristics(raw: string): Span[] {
  return [
    ...detectDigitEntities(raw),
    ...detectTextEntities(raw),
    ...detectGovernmentIds(raw),
    ...detectCuedPhone(raw),
    ...detectPassport(raw),
  ];
}
