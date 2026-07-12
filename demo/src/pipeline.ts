import type { Span } from "curtain-privacy";
import { buildMapping, type MappingRow } from "./mapping.ts";
import type { ConversationMemory, MemoryTurn } from "./memory.ts";

/** The guard surface the demo uses; lets tests stub it. */
export interface TurnGuard {
  detectRedactions(text: string): Promise<Span[]>;
  protect(text: string): Promise<{ text: string; placeholders: readonly string[] }>;
  reveal(reply: string): string;
  /** Forget prior bindings so each message is numbered from one. */
  reset(): void;
}

/** One reply, plus which source actually produced it. In LLM mode a single turn
 * can still fall back to the scripted reply when the model's output fails vetting,
 * so this is per-turn, not per-session. */
export interface Reply {
  text: string;
  source: "llm" | "scripted";
  /** The model's raw output before vetting, present whenever a model ran (whether
   * its reply was used or rejected), absent in scripted mode where none ran. Lets
   * the UI show exactly what the model wrote back. */
  modelRaw?: string;
}

/** Per-turn context for the reply source when the demo has memory: the recent
 * redacted turns to condition on, and every token seen this conversation for the
 * reply source's own vetting. Absent for a single-turn (memory-less) call. */
export interface ReplyContext {
  window: readonly MemoryTurn[];
  seenTokens: string;
}

/** Produces the assistant reply from the redacted (placeholdered) text only. The
 * optional context is redacted too; a real value never reaches this function. */
export type ReplySource = (redactedText: string, ctx?: ReplyContext) => Promise<Reply>;

// reveal() has already restored every token the session table minted, so any
// bracketed run still standing is one the reply source invented. The salt may be
// any length and the closing bracket may be missing, because a model can be cut
// off mid-token; matching only the well-formed shape would let the rest through.
// The reply source vets its own output, so this is the second line of defence.
const ORPHAN_TOKEN_RE = /\[[A-Z][A-Z0-9_]*(?:\.[0-9a-f]*)?\]?/g;

function cleanReply(revealed: string): string {
  return revealed
    .replace(ORPHAN_TOKEN_RE, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,!?;:])/g, "$1")
    .trim();
}

/**
 * The stages of one turn, in order. Two run on the device (anonymizing,
 * restoring) and two describe the redacted text crossing to the model and back
 * (sending, generating). The UI narrates them so the privacy boundary is visible
 * rather than asserted.
 */
export type Phase = "anonymizing" | "sending" | "generating" | "restoring";

/** What is known at a phase boundary. `redacted` and `mapping` are absent during
 * anonymizing, since that stage is what produces them. */
export interface PhaseContext {
  redacted?: string;
  mapping?: MappingRow[];
}

export interface RunTurnOptions {
  /** When present, the turn reads and updates conversation memory. */
  memory?: ConversationMemory;
  /** Awaited between stages, so a caller can both react and pace the sequence. */
  onPhase?: (phase: Phase, ctx: PhaseContext) => void | Promise<void>;
}

export interface Turn {
  original: string;
  redacted: string;
  spans: Span[];
  placeholders: string[];
  mapping: MappingRow[];
  sentReply: string;
  reply: string;
  replySource: "llm" | "scripted";
  /** The model's raw output before vetting, when a model ran; else undefined. */
  modelRaw?: string;
  /** The redacted conversation the model saw this turn (window + current user
   * turn), for the panel. Empty when the turn ran without memory. */
  context: MemoryTurn[];
  /** The durable running mapping: values kept off the wire this conversation.
   * Empty when the turn ran without memory. */
  entities: MappingRow[];
}

/** One chat turn: detect, protect, generate a reply from the redacted text, reveal.
 * The reply source is only ever handed the redacted text, which is the guarantee
 * the verify panel makes visible. Phase hooks observe the same sequence. */
export async function runTurn(
  guard: TurnGuard,
  reply: ReplySource,
  original: string,
  opts: RunTurnOptions = {},
): Promise<Turn> {
  const { memory, onPhase } = opts;

  await onPhase?.("anonymizing", {});
  const spans = await guard.detectRedactions(original);
  const { text: redacted, placeholders } = await guard.protect(original);
  const mapping = buildMapping(spans, placeholders);
  memory?.noteMapping(mapping);

  const window = memory ? memory.window() : [];
  const context: MemoryTurn[] = memory ? [...window, { role: "user", content: redacted }] : [];

  await onPhase?.("sending", { redacted, mapping });
  await onPhase?.("generating", { redacted, mapping });
  const ctx: ReplyContext | undefined = memory ? { window, seenTokens: memory.seenTokens() } : undefined;
  const sent = await reply(redacted, ctx);

  await onPhase?.("restoring", { redacted, mapping });
  const revealed = cleanReply(guard.reveal(sent.text));

  memory?.append("user", redacted);
  memory?.append("assistant", sent.text);

  return {
    original,
    redacted,
    spans,
    placeholders: [...placeholders],
    mapping,
    sentReply: sent.text,
    reply: revealed,
    replySource: sent.source,
    modelRaw: sent.modelRaw,
    context,
    entities: memory ? [...memory.entities()] : [],
  };
}
