import type { Span } from "curtain-privacy";
import { buildMapping, type MappingRow } from "./mapping.ts";

/** The subset of the guard the pipeline needs; lets tests stub it. */
export interface TurnGuard {
  detectRedactions(text: string): Promise<Span[]>;
  protect(text: string): Promise<{ text: string; placeholders: readonly string[] }>;
  reveal(reply: string): string;
}

/** Produces the assistant reply from the redacted (placeholdered) text only. */
export type ReplySource = (redactedText: string) => Promise<string>;

// A placeholder-shaped token: [LABEL.salt] with a hex salt. reveal() has already
// restored every real token, so any leftover match is one a weak reply model
// invented (e.g. wrapping a kept city in brackets); strip it rather than surface a
// broken token to the user.
const ORPHAN_TOKEN_RE = /\[[A-Za-z0-9_]+\.[0-9a-f]{6,}\]/g;

function cleanReply(revealed: string): string {
  return revealed
    .replace(ORPHAN_TOKEN_RE, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,!?;:])/g, "$1")
    .trim();
}

export interface Turn {
  original: string;
  redacted: string;
  spans: Span[];
  placeholders: string[];
  mapping: MappingRow[];
  sentReply: string;
  reply: string;
}

/** One chat turn: detect, protect, generate a reply from the redacted text, reveal.
 * The reply source is only ever handed the redacted text, which is the guarantee
 * the verify panel makes visible. */
export async function runTurn(guard: TurnGuard, reply: ReplySource, original: string): Promise<Turn> {
  const spans = await guard.detectRedactions(original);
  const { text: redacted, placeholders } = await guard.protect(original);
  const sentReply = await reply(redacted);
  return {
    original,
    redacted,
    spans,
    placeholders: [...placeholders],
    mapping: buildMapping(spans, placeholders),
    sentReply,
    reply: cleanReply(guard.reveal(sentReply)),
  };
}
