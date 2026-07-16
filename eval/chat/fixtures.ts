/**
 * Fixtures for the informal-chat recall / over-redaction gate. Two chat conventions
 * the shipped detector handles unevenly:
 *
 *  - speaker-labels: a name in speaker-prefix ("Marites:"), (M)/(F), endearment, or
 *    repeated-subject position, including common-noun-homograph nicknames (Princess,
 *    Boy, Inday) that read as ordinary words. This is the Tagalog OpenPII chat
 *    convention; recall here sits well below generic per-language recall.
 *  - salutation sweep: a chat opener ("Hi", "Hey", "Dear") the detector pulls into
 *    the following name span. reconcile.stripLeadingTitles trims these, so the gate
 *    fails if any greeting is over-redacted, guarding that fix from regressing.
 *
 * Every fixture is deterministic (no RNG), so the gate is reproducible. Name pools
 * and templates are lifted from the speaker-label augmentation recipe.
 */

export type Span = { start: number; end: number };
export type Case = { text: string; redact: Span[]; keep: Span[] };

type Piece = [string, ("redact" | "keep")?];

/** Assemble a sentence from pieces, recording the char offsets of tagged tokens.
 * A "redact" token must be covered by a redaction; a "keep" token must not be. */
export function build(pieces: Piece[]): Case {
  let text = "";
  const redact: Span[] = [], keep: Span[] = [];
  for (const [s, tag] of pieces) {
    const start = text.length;
    text += s;
    const end = text.length;
    if (tag === "redact") redact.push({ start, end });
    if (tag === "keep") keep.push({ start, end });
  }
  return { text, redact, keep };
}

// Curated Filipino given names and nicknames, including the common-noun homographs
// (Princess, Baby, Boy, Girlie) and speaker-label nicknames the OpenPII Tagalog chat
// data uses. They leak because they are ordinary words; name position is the signal.
const GIVEN = [
  "Princess", "Baby", "Boy", "Girlie", "Totoy", "Nene", "Inday", "Dodong", "Bong", "Jun",
  "Noel", "Jomar", "Rowena", "Consolación", "Divina", "Rizza", "Marites", "Dranreb", "Jayvee",
  "Ping", "Bogart", "Junjun", "Dwarding", "Ligaya", "Luningning", "Bayani", "Amihan", "Reynaldo", "Ederlyn",
];
const SUR = [
  "Cruz", "Reyes", "Santos", "Bautista", "Aquino", "Mendoza", "Panganiban", "Dela Cruz", "Bacani",
  "Villanueva", "Magsaysay", "Dimaculangan", "Aguinaldo", "Macaraeg", "Pagcaliwagan", "Tanjuatco", "Sumulong",
];
const g = (i: number) => GIVEN[((i % GIVEN.length) + GIVEN.length) % GIVEN.length];
const s = (i: number) => SUR[((i % SUR.length) + SUR.length) % SUR.length];

// Speaker-label / Tagalog-chat templates: a name in speaker-prefix, (M)/(F),
// endearment, repeated-subject, or "given surname:" position. Only the name tokens
// are redact spans; the surrounding chat text is context.
const SPEAKER: ((i: number) => Case)[] = [
  (i) => build([[g(i), "redact"], [": Sige po, aandar na ako mamaya. Salamat!"]]),
  (i) => build([[g(i), "redact"], [" (M): Tapos na ang report kahapon."]]),
  (i) => build([[g(i), "redact"], [" (F): Nakatanggap ako ng bagong email ngayon."]]),
  (i) => build([["Mahal kong "], [g(i), "redact"], [", kumusta ka na diyan?"]]),
  (i) => build([[g(i), "redact"], [" "], [s(i), "redact"], [": Naghihintay pa rin kami sa opisina."]]),
  (i) => build([["Kontakin si "], [g(i), "redact"], [" "], [s(i), "redact"], [" para sa mga detalye."]]),
  (i) => build([[g(i), "redact"], [": Oo, pwede. "], [g(i), "redact"], [": Sige, pupunta ako."]]),
  (i) => build([["Mga sangkot: "], [g(i), "redact"], [" (M), "], [g(i + 1), "redact"], [" (M). Follow-up."]]),
  (i) => build([["Dear "], [g(i), "redact"], [" "], [s(i), "redact"], [", salamat sa iyong sulat."]]),
  (i) => build([["11:33 "], [g(i), "redact"], [": Mag-check muna tayo bukas."]]),
];

/** ~160 speaker-label cases: every template filled across the name pool. */
export function speakerCases(): Case[] {
  const out: Case[] = [];
  SPEAKER.forEach((t, ti) => {
    for (let k = 0; k < 16; k++) out.push(t(ti * 7 + k * 3));
  });
  return out;
}

const GREETINGS = ["Hi", "Hey", "Hello", "Dear", "Hola", "Ciao"];
const SALUT_NAMES = ["John", "Priya", "Sarah", "Maria", "Bob", "Alex", "Cruz", "Müller", "García", "Rossi", "Noor", "Wei"];

/** Salutation-sweep cases: the greeting is a keep token (must not be redacted), the
 * name after it is a redact token. Guards reconcile's greeting strip. */
export function salutationCases(): Case[] {
  const out: Case[] = [];
  GREETINGS.forEach((gr, gi) => {
    for (let k = 0; k < 8; k++) {
      const name = SALUT_NAMES[(gi * 5 + k) % SALUT_NAMES.length];
      out.push(build([[gr, "keep"], [" "], [name, "redact"], [", can you confirm the time?"]]));
    }
  });
  return out;
}

const INITIALS = ["J", "M", "A", "R", "T", "K"];

/** Single-letter-initial cases: the lone letter is a keep token. Reported for
 * context only; a single letter is not identifying, so its over-redaction is
 * accepted rather than gated. */
export function initialCases(): Case[] {
  const out: Case[] = [];
  INITIALS.forEach((letter, li) => {
    for (let k = 0; k < 4; k++) {
      out.push(build([["Please pass this to "], [letter, "keep"], [". "], [s(li * 3 + k), "redact"], [" before Friday."]]));
    }
  });
  return out;
}

const overlaps = (spans: Span[], a: number, b: number) => spans.some((sp) => sp.start < b && sp.end > a);

export type Tally = { redTot: number; redHit: number; keepTot: number; keepViol: number; leaks: string[]; over: string[] };

/** Tally one case against predicted redaction spans: which redact tokens were
 * covered (recall) and which keep tokens were wrongly covered (over-redaction). */
export function scoreCase(c: Case, spans: Span[]): Tally {
  const t: Tally = { redTot: 0, redHit: 0, keepTot: 0, keepViol: 0, leaks: [], over: [] };
  for (const r of c.redact) {
    t.redTot++;
    if (overlaps(spans, r.start, r.end)) t.redHit++;
    else t.leaks.push(c.text.slice(r.start, r.end));
  }
  for (const k of c.keep) {
    t.keepTot++;
    if (overlaps(spans, k.start, k.end)) { t.keepViol++; t.over.push(c.text.slice(k.start, k.end)); }
  }
  return t;
}
