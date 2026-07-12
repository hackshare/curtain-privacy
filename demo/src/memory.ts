import type { MappingRow } from "./mapping.ts";

/** One completed, redacted turn in the rolling window. `content` is placeholdered. */
export interface MemoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** How many recent messages the model gets as context. Small enough that the 0.5B
 * model does not drown in history; the build-time multi-turn check settles it. */
export const WINDOW_TURNS = 6;

/**
 * In-browser conversation memory, two tiers. The rolling window is the recent
 * redacted turns the model conditions on; the entity list is the durable, deduped
 * record of values kept off the wire, which persists for the whole conversation.
 * Holds only redacted content and the local value->token mapping; nothing here is
 * ever sent anywhere.
 */
export class ConversationMemory {
  private turns: MemoryTurn[] = [];
  private rows: MappingRow[] = [];

  /** Record a completed redacted turn; drop the oldest past WINDOW_TURNS. */
  append(role: "user" | "assistant", content: string): void {
    this.turns.push({ role, content });
    if (this.turns.length > WINDOW_TURNS) this.turns = this.turns.slice(-WINDOW_TURNS);
  }

  /** The recent redacted turns the model gets as context. */
  window(): readonly MemoryTurn[] {
    return [...this.turns];
  }

  /** Merge a turn's value->token rows into the durable memory, deduped by value.
   * The same value maps to one stable token because the guard is not reset. */
  noteMapping(rows: readonly MappingRow[]): void {
    for (const r of rows) {
      if (!this.rows.some((seen) => seen.value === r.value)) this.rows.push({ ...r });
    }
  }

  /** The durable deduped rows: values kept off the wire this conversation. */
  entities(): readonly MappingRow[] {
    return [...this.rows];
  }

  /** Every placeholder token seen this conversation, joined for the vet/repair
   * routines, which extract tokens by regex from a string. Includes tokens whose
   * turn has already left the window. */
  seenTokens(): string {
    return this.rows.map((r) => r.placeholder).join(" ");
  }

  /** Forget everything (new conversation). */
  clear(): void {
    this.turns = [];
    this.rows = [];
  }
}
