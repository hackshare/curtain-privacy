/**
 * Session entity table: reversible placeholders for coherent chat.
 *
 * Blanket `[REDACTED]` makes the assistant's replies nonsense. Instead each
 * redacted value gets a stable, typed placeholder (`[GIVEN_NAME_1]`, `[SSN_2]`)
 * that survives across turns: the same raw value always maps to the same token,
 * so the model can reason about "GIVEN_NAME_1" and we {@link rehydrate} the real
 * value back into its reply before display.
 *
 * The map lives only on the client. What leaves the device is placeholdered
 * text; the table never crosses the wire.
 */

import { applyPolicy } from "./policy";
import { KEEP_LABELS, type PiiLabel, type Span } from "./types";

/** Result of scrubbing one message. */
export interface ScrubResult {
  /** Text with PII replaced by placeholders. Safe to send/log. */
  readonly text: string;
  /** Placeholders introduced or reused in this message. */
  readonly placeholders: readonly string[];
}

/**
 * Optional display aliases for placeholder tokens. By default a GIVEN_NAME span
 * becomes `[GIVEN_NAME_1]`; pass `{ GIVEN_NAME: "NAME" }` to get `[NAME_1]` instead.
 * Only the visible token changes — detection and policy are unaffected.
 */
export type PlaceholderAliases = Partial<Record<PiiLabel, string>>;

/** Token shape minted by the table; also the regex used to find them on the
 * way back. Kept in one place so scrub and rehydrate can never disagree.
 * The trailing `.<salt>` is a per-session secret (see {@link SessionEntityTable}):
 * without it the token namespace is guessable, so a placeholder an attacker types
 * or plants in a retrieved document could be echoed by the model and rehydrated
 * into someone's real PII. The salt makes a valid token unguessable. */
export const PLACEHOLDER_PATTERN = /\[[A-Z][A-Z_]*_\d+\.[0-9a-f]+\]/g;

/** Placeholder shapes to defuse in *inbound* user text — both the salted form
 * this table mints and the bare `[LABEL_N]` form, so a pasted token can never
 * round-trip through the model back into a real value. */
const INBOUND_PLACEHOLDER_PATTERN = /\[[A-Z][A-Z_]*_\d+(?:\.[0-9a-f]+)?\]/g;

/**
 * Neutralize any placeholder-shaped run in untrusted text before it reaches the
 * model, so it cannot collide with the live session table on the way back. The
 * ASCII brackets are swapped for their full-width lookalikes (`［`/`］`), which
 * reads the same to a human but no longer matches {@link PLACEHOLDER_PATTERN}.
 * Length-preserving: every replaced character maps 1:1, so detection offsets are
 * unchanged.
 */
export function neutralizePlaceholders(text: string): string {
  return text.replace(INBOUND_PLACEHOLDER_PATTERN, (m) => `［${m.slice(1, -1)}］`);
}

/** A per-session secret woven into every token. 48 bits of entropy: far beyond
 * guessing in an online attack, so a token minted this session cannot be forged. */
function mintSalt(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A per-conversation store mapping raw PII values to stable placeholders.
 * Keyed by `label + normalized value` so "John" stays `GIVEN_NAME_1` on every turn
 * and casing/whitespace noise doesn't mint duplicate tokens.
 */
export class SessionEntityTable {
  private readonly forward = new Map<string, string>();
  private readonly reverse = new Map<string, string>();
  private readonly counters = new Map<string, number>();
  /** Per-session secret woven into every token so the namespace is unguessable.
   * Re-minted on {@link reset} so tokens from a prior conversation go fully inert. */
  private salt: string;

  constructor(
    private readonly aliases: PlaceholderAliases = {},
    private readonly keepLabels: ReadonlySet<PiiLabel> = KEEP_LABELS,
    salt: string = mintSalt(),
  ) {
    this.salt = salt;
  }

  /** The visible name used in tokens for a label (alias or the label itself). */
  private displayName(label: PiiLabel): string {
    return this.aliases[label] ?? label;
  }

  /** Get or mint the placeholder for a given label+value. Idempotent. */
  placeholderFor(label: PiiLabel, value: string): string {
    const key = `${label}:${value.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const existing = this.forward.get(key);
    if (existing !== undefined) return existing;
    const name = this.displayName(label);
    const next = (this.counters.get(name) ?? 0) + 1;
    this.counters.set(name, next);
    const token = `[${name}_${next}.${this.salt}]`;
    this.forward.set(key, token);
    this.reverse.set(token, value);
    return token;
  }

  /**
   * Replace each redactable span with its placeholder. Spans are pre-sorted
   * right-to-left by {@link applyPolicy}, so splicing never invalidates an
   * earlier offset.
   */
  scrub(raw: string, spans: readonly Span[]): ScrubResult {
    const redactable = applyPolicy(spans, this.keepLabels);
    const placeholders: string[] = [];
    let text = raw;
    for (const span of redactable) {
      const token = this.placeholderFor(span.label, span.text);
      placeholders.push(token);
      text = `${text.slice(0, span.start)}${token}${text.slice(span.end)}`;
    }
    return { text, placeholders: placeholders.reverse() };
  }

  /**
   * Restore real values in an assistant reply. Used on the *outbound* response
   * so the user sees "John", not "[NAME_1]". Unknown tokens are left intact.
   */
  rehydrate(text: string): string {
    return text.replace(PLACEHOLDER_PATTERN, (token) => this.reverse.get(token) ?? token);
  }

  /** True if `token` is a placeholder this table can resolve. */
  knows(token: string): boolean {
    return this.reverse.has(token);
  }

  /**
   * Forget every binding. Call at a conversation boundary before reusing a guard
   * for a different conversation or user, so one conversation's values can never
   * surface in another. The salt is re-minted too, so a stale token from the
   * prior conversation resolves to nothing rather than to a new value.
   */
  reset(): void {
    this.forward.clear();
    this.reverse.clear();
    this.counters.clear();
    this.salt = mintSalt();
  }
}
