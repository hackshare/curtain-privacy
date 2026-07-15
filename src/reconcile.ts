/**
 * Post-detection reconciliation: deterministic passes over original-text
 * offsets, run after the detector emits spans and before the default-deny
 * policy.
 *
 *  - snapNameSpans widens a name/street span whose edge fell mid-word (a
 *    subword tag such as "Smit" for "Smith") out to the whole word, so no
 *    letter fragment of a redacted name is left beside its placeholder.
 *  - stripLeadingTitles trims an honorific ("Mr", "Herr", "Señora") the model
 *    swept into a name span. This is the one pass that narrows a span; it is
 *    safe because a title is not PII, so removing it exposes no identifier while
 *    the name it precedes stays redacted.
 *  - propagateSurfaces redacts every other whole-word occurrence of a value the
 *    detector flagged once, so a name mentioned many times but tagged once does
 *    not leak on the rest.
 *
 * Every pass but stripLeadingTitles only widens or adds redactions, matching the
 * library's recall-over-precision threat model; stripLeadingTitles removes only
 * non-PII title characters, so it does not weaken that model.
 */
import { shouldRedact, type PiiLabel, type Span } from "./types";

/** Contextual labels whose spans snap to word boundaries. Structured IDs are
 * handled by extendSpans; snapping a keep-set label would not change what is
 * redacted. */
const SNAP_LABELS = new Set<PiiLabel>(["GIVEN_NAME", "SURNAME", "STREET_NAME"]);

/** Person-name labels a leading honorific attaches to. */
const TITLE_STRIP_LABELS = new Set<PiiLabel>(["GIVEN_NAME", "SURNAME"]);

/**
 * Honorifics the model tends to sweep into an adjacent name span, folded to
 * lowercase and accent-free. Limited to unambiguous titles: entries that also
 * occur as names or common words (Sen = Senator and the surname Sen, M, Fr, Rey,
 * Bar, Sind) are deliberately excluded and left to the model, which can use
 * context a fixed list cannot.
 */
const TITLES = new Set<string>([
  // English
  "mr", "mrs", "ms", "miss", "mister", "mistress", "master", "mstr", "madam", "madame",
  "sir", "dr", "prof", "professor", "doctor", "rev", "reverend", "dame",
  // French
  "monsieur", "mademoiselle", "mlle", "mme", "mtre", "maitre", "docteure", "professeure", "professeur",
  // German / Dutch
  "herr", "frau", "fraulein", "doktorin", "professorin", "meister", "meist", "doktor",
  "burgermeisterin", "bgm", "dhr", "mevr", "mevrouw", "mej",
  // Italian
  "signor", "signore", "signora", "signorina", "sig", "maestro", "senatore", "sindaca",
  "sindaco", "dottore", "dottoressa", "professore", "professoressa",
  // Spanish
  "senor", "senora", "senorita", "sr", "sra", "srta", "dra", "ingeniero", "ing",
  // Portuguese
  "senhor", "senhora", "senhorita", "menina", "mna", "mw",
  // Official / legislative (unabbreviated forms only)
  "mayoress", "mairesse", "alcalde", "alc", "minister", "ministre", "senator", "senateur",
  "presidente", "cde",
]);

const COMBINING = /\p{M}/gu;

/** Lowercase and strip accents so "Señor"/"Senor"/"SEÑOR" all match. */
function foldTitle(word: string): string {
  return word.toLowerCase().normalize("NFKD").replace(COMBINING, "");
}

/** A leading word (optionally dotted) followed by whitespace, at offset 0. */
const LEADING_WORD = /^(\p{L}+)\.?(\s+)/u;

const LETTER = /\p{L}/u;

/** True when text[i] exists and is a Unicode letter. */
function isLetter(text: string, i: number): boolean {
  return i >= 0 && i < text.length && LETTER.test(text[i]);
}

/**
 * Widen each name/street span outward across letters to its whitespace- or
 * punctuation-delimited word, so a subword tag cannot leave a letter fragment
 * of the name exposed. Spans of other labels pass through untouched.
 */
export function snapNameSpans(text: string, spans: readonly Span[]): Span[] {
  return spans.map((s) => {
    if (!SNAP_LABELS.has(s.label)) return s;
    let start = s.start;
    let end = s.end;
    while (isLetter(text, start - 1)) start--;
    while (isLetter(text, end)) end++;
    return start === s.start && end === s.end
      ? s
      : { ...s, start, end, text: text.slice(start, end) };
  });
}

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every whole-word, case-insensitive occurrence of `surface` in `text`, as
 * [start, end) pairs. Whole-word means neither side abuts a Unicode letter, so
 * "Li" matches the standalone word but never the "li" inside "climbs".
 */
function* wholeWordOccurrences(text: string, surface: string): Generator<[number, number]> {
  const re = new RegExp(escapeRegExp(surface), "giu");
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (!isLetter(text, start - 1) && !isLetter(text, end)) yield [start, end];
    if (re.lastIndex === start) re.lastIndex++;
  }
}

/**
 * For every redact-class span, add a same-label span at each other whole-word
 * occurrence of its surface. A value the detector caught once is thus redacted
 * everywhere it appears in the message. Keep-class spans are not propagated.
 * The originals are returned alongside the additions; overlap and duplication
 * are resolved later by mergeSpans.
 */
export function propagateSurfaces(
  text: string,
  spans: readonly Span[],
  keepLabels: ReadonlySet<PiiLabel>,
): Span[] {
  const additions: Span[] = [];
  const done = new Set<string>();
  for (const s of spans) {
    if (!shouldRedact(s.label, keepLabels)) continue;
    const surface = text.slice(s.start, s.end);
    if (surface.length === 0) continue;
    const key = `${s.label}:${surface.toLowerCase()}`;
    if (done.has(key)) continue;
    done.add(key);
    for (const [start, end] of wholeWordOccurrences(text, surface)) {
      additions.push({ ...s, start, end, text: text.slice(start, end) });
    }
  }
  return [...spans, ...additions];
}

/**
 * Trim a leading honorific ("Mr", "Herr", "Señora", ...) from each redact-class
 * GIVEN_NAME / SURNAME span the model widened to include it. A title is stripped
 * only when it is a whole word followed by whitespace and more span content, so
 * the name it precedes always stays redacted and a title-only span (no trailing
 * name) is left untouched. Stacked titles ("Prof Dr Smith") are trimmed in turn.
 */
export function stripLeadingTitles(
  text: string,
  spans: readonly Span[],
  keepLabels: ReadonlySet<PiiLabel>,
): Span[] {
  return spans.map((s) => {
    if (!TITLE_STRIP_LABELS.has(s.label) || !shouldRedact(s.label, keepLabels)) return s;
    let start = s.start;
    for (;;) {
      const m = LEADING_WORD.exec(text.slice(start, s.end));
      if (m === null || !TITLES.has(foldTitle(m[1]))) break;
      const next = start + m[0].length;
      if (next >= s.end) break; // never consume the whole span
      start = next;
    }
    return start === s.start ? s : { ...s, start, text: text.slice(start, s.end) };
  });
}

/**
 * Run the reconciliation passes in order: snap name spans to word boundaries,
 * strip any honorific the model swept into a name span, then propagate every
 * redact-class surface to its whole-word repeats. Snap runs first so the name is
 * whole; strip runs before propagate so the repeats searched for are the clean
 * name, not the title-prefixed span.
 */
export function reconcileSpans(
  text: string,
  spans: readonly Span[],
  keepLabels: ReadonlySet<PiiLabel>,
): Span[] {
  return propagateSurfaces(
    text,
    stripLeadingTitles(text, snapNameSpans(text, spans), keepLabels),
    keepLabels,
  );
}
