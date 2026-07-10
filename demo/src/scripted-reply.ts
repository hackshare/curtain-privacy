/** A deterministic assistant reply used when no WebGPU LLM is available. It echoes
 * the placeholders it received, so reveal restores the real values and the visitor
 * still sees the full round-trip. */
export function scriptedReply(placeholders: readonly string[]): string {
  if (placeholders.length === 0) {
    return "Thanks. I found nothing to redact in that message.";
  }
  return `Thanks. I received your message with ${placeholders.join(", ")} and only ever saw those placeholders, never the real values.`;
}
