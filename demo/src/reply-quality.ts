/**
 * Vetting for replies from the on-device LLM.
 *
 * A 0.5B model asked to copy a salted token back verbatim fails in a few ways: it
 * invents a token, it gets cut off mid-token at the generation cap, or decoding
 * collapses into a repetition loop. Some WebGPU backends make the last one far more
 * likely than a CPU run of the same weights does.
 *
 * None of that is a redaction failure, but a visitor cannot tell the difference, so
 * a garbled reply reads as "the privacy library is broken". The reply source vets
 * the model's output and falls back to the scripted reply rather than render it.
 */

/** The token shape the session table mints, and the only bracketed run a reply is
 * allowed to contain. */
const SENT_TOKEN = /\[[A-Z][A-Z_]*_\d+\.[0-9a-f]+\]/g;

interface SentToken {
  full: string;
  label: string;
  num: string;
  salt: string;
}

function parseSent(token: string): SentToken | null {
  const m = token.match(/^\[([A-Z][A-Z_]*)_(\d+)\.([0-9a-f]+)\]$/);
  return m ? { full: token, label: m[1], num: m[2], salt: m[3] } : null;
}

/**
 * Repair tokens the model rewrote before vetting. A 0.5B model often reuses a
 * token but reformats it: GIVEN_NAME_1 comes back as "Given Name 1", EMAIL_1 as
 * "Email Address 1". It keeps the salt exactly, and the salt is a per-session
 * secret, so any bracketed run carrying it must derive from a token we sent this
 * turn. Match each such run back to the real token by salt, then number, then
 * label (exact, else leading word), and splice the real token in so reveal can
 * restore it. Ambiguous or foreign-salt runs are left untouched for vetting to
 * reject, so a repair can only ever produce a token we actually minted.
 */
export function repairModelTokens(raw: string, redactedText: string): string {
  const sent = (redactedText.match(SENT_TOKEN) ?? []).map(parseSent).filter((t): t is SentToken => t !== null);
  if (sent.length === 0) return raw;
  const sessionSalt = sent[0].salt;

  // Tolerate whitespace the model sometimes inserts around the dot, e.g.
  // "[Given Name 1. <salt>]", so those tokens still match back by salt.
  return raw.replace(/\[([^\][]*?)\s*\.\s*([0-9a-f]+)\s*\]/g, (whole, inner: string, salt: string) => {
    if (salt !== sessionSalt) return whole;
    const num = inner.match(/(\d+)\s*$/)?.[1] ?? null;
    const label = inner
      .replace(/[\s_]*\d+\s*$/, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    let pool = num ? sent.filter((s) => s.num === num) : sent;
    if (pool.length === 0) pool = sent;

    const exact = pool.filter((s) => s.label === label);
    if (exact.length === 1) return exact[0].full;

    const firstWord = label.split("_")[0];
    const byWord = pool.filter((s) => s.label.split("_")[0] === firstWord);
    if (byWord.length === 1) return byWord[0].full;

    if (pool.length === 1) return pool[0].full;
    return whole;
  });
}

/** Terminal punctuation, ignoring dots that fall inside a token's salt. */
function lastSentenceEnd(text: string): number {
  const masked = text.replace(SENT_TOKEN, (m) => "A".repeat(m.length));
  return Math.max(masked.lastIndexOf("."), masked.lastIndexOf("!"), masked.lastIndexOf("?"));
}

/**
 * Drop a trailing partial sentence left behind when generation hits its token cap.
 * A reply that already ends on terminal punctuation, or that has none at all, is
 * returned unchanged.
 */
export function trimToLastSentence(text: string): string {
  const t = text.trim();
  if (/[.!?]["')\]]?$/.test(t)) return t;
  const end = lastSentenceEnd(t);
  return end >= 0 ? t.slice(0, end + 1).trim() : t;
}

/** True if any four-word window recurs often enough to be a decoding loop rather
 * than ordinary repetition. Short replies are exempt: they cannot loop. */
function hasRepetitionLoop(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < 12) return false;
  const seen = new Map<string, number>();
  for (let i = 0; i + 4 <= words.length; i++) {
    const gram = words.slice(i, i + 4).join(" ");
    const n = (seen.get(gram) ?? 0) + 1;
    if (n >= 3) return true;
    seen.set(gram, n);
  }
  return false;
}

/** A token the generator was cut off partway through: an open bracket with no
 * closing one before the end of the string. */
const TRAILING_PARTIAL_TOKEN = /\[[A-Za-z][^\][]*$/;

/**
 * Vet a raw model reply against the redacted text it was given. Returns the reply
 * to show, or null if the model produced something we should not render.
 *
 * The rule is that every bracket in the reply must belong to a token we actually
 * sent this turn. That catches an invented token, a renamed one, and the bracketed
 * fragments a collapsed decoder emits, without enumerating every broken shape.
 *
 * A reply cut off mid-token at the generation cap is common and recoverable: drop
 * the partial token and keep whatever complete sentences precede it, rather than
 * throw the whole reply away.
 */
export function vetModelReply(raw: string, redactedText: string): string | null {
  const sent = new Set(redactedText.match(SENT_TOKEN) ?? []);
  const untruncated = raw.replace(TRAILING_PARTIAL_TOKEN, "").trimEnd();
  const reply = trimToLastSentence(untruncated);
  if (reply.length === 0) return null;
  // If the tail was cut off, only keep it when whole sentences survive; a bare
  // fragment ("Let me try again: Hi") is not worth showing.
  if (untruncated !== raw && !/[.!?]["')\]]?$/.test(reply)) return null;
  const residue = reply.replace(SENT_TOKEN, (m) => (sent.has(m) ? "" : m));
  if (/[[\]]/.test(residue)) return null;
  if (hasRepetitionLoop(reply)) return null;
  return reply;
}
