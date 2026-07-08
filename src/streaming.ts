/**
 * Streaming placeholder reveal.
 *
 * The assistant streams tokens, so a placeholder can be split across chunks:
 *   chunk A: "...thanks [NA"
 *   chunk B: "ME_1] for..."
 * A per-chunk regex replace would emit the broken `[NA` and never match. This
 * buffers the smallest suffix that could still become a placeholder, emits
 * everything safe before it, and flushes the remainder at stream end.
 */

import { PLACEHOLDER_PATTERN } from "./session";

/** Resolves a placeholder token to its real value, or null to leave it as-is. */
export type PlaceholderResolver = (token: string) => string | null;

// A run that *might* grow into a placeholder: '[' then [A-Z_], then optional
// '_' digits, then the optional '.' salt suffix, not yet closed by ']'. If a
// suffix matches this, hold it until the token completes or is ruled out.
const PARTIAL_TOKEN = /\[[A-Z_]*(?:_\d*(?:\.[0-9a-f]*)?)?$/;

// A real token's pre-']' text is short (label + counter + 12-hex salt). A held
// run longer than this can never complete into a valid token, so it is emitted
// as plain text rather than buffered — this bounds the held buffer and keeps
// reveal linear instead of O(n^2) on an unclosed '[' flood.
const MAX_PARTIAL_TOKEN = 128;

/**
 * Stateful reveal for a token stream. Feed chunks in order; `push` returns the
 * text safe to render now, `flush` returns whatever was held at the end.
 */
export class StreamingReveal {
  private buffer = "";

  constructor(private readonly resolve: PlaceholderResolver) {}

  /** Reveal complete placeholders in `chunk`, holding any partial tail. */
  push(chunk: string): string {
    this.buffer += chunk;
    const revealed = this.replaceComplete(this.buffer);
    // Find the longest suffix that could still be completing a placeholder.
    const partial = revealed.match(PARTIAL_TOKEN);
    if (partial === null || partial[0].length > MAX_PARTIAL_TOKEN) {
      this.buffer = "";
      return revealed;
    }
    const cut = revealed.length - partial[0].length;
    this.buffer = revealed.slice(cut);
    return revealed.slice(0, cut);
  }

  /** Emit any buffered tail (e.g. a lone `[` that never became a token). */
  flush(): string {
    const out = this.replaceComplete(this.buffer);
    this.buffer = "";
    return out;
  }

  private replaceComplete(text: string): string {
    return text.replace(PLACEHOLDER_PATTERN, (token) => this.resolve(token) ?? token);
  }
}

/**
 * A Web Streams transform that reveals placeholders in a string stream — drop
 * it into an AI SDK text stream pipeline so the user never sees `[NAME_1]`.
 */
export function createRevealTransform(resolve: PlaceholderResolver): TransformStream<string, string> {
  const reveal = new StreamingReveal(resolve);
  return new TransformStream<string, string>({
    transform(chunk, controller) {
      const out = reveal.push(chunk);
      if (out) controller.enqueue(out);
    },
    flush(controller) {
      const out = reveal.flush();
      if (out) controller.enqueue(out);
    },
  });
}
