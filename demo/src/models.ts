import { createGuard } from "curtain-privacy";
import { pipeline, type ProgressCallback } from "@huggingface/transformers";
import { hasWebGpu } from "./capability.ts";
import { scriptedReply } from "./scripted-reply.ts";
import { repairModelTokens, vetModelReply } from "./reply-quality.ts";
import type { ReplySource, TurnGuard } from "./pipeline.ts";

const LLM_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";

// The example codes here are illustrative of the shape, never instructions to
// output them, so the model does not copy the sample salt (an earlier prompt that
// told the model to greet with a spelled-out token had it copy that token). Naming
// the exact failure ("invent one like [YOUR_NAME]") and "do not introduce yourself"
// beat a vaguer "do not restate their details", which pushed the model into
// confused replies that asked the user who they were.
const SYSTEM_PROMPT =
  "You are a helpful assistant. Some words in the user's message are codes in square brackets like [GIVEN_NAME_1.ab12cd] that stand for private details you cannot see. Reply with one short, friendly sentence that responds to their message. If you refer to one of their details, write the exact bracketed code, copied character for character; never write a code from memory, shorten it, or invent one like [YOUR_NAME]. Do not introduce yourself and do not mention the codes.";

/** Load the curtain redaction guard from Hugging Face at the pinned revision. */
export async function loadGuard(): Promise<TurnGuard> {
  const guard = await createGuard({
    model: "hackshare/curtain-privacy",
    revision: "v1.0.0",
    device: "wasm",
  });
  return guard as unknown as TurnGuard;
}

/** Which reply source actually loaded, so the UI can label the turn honestly. */
export type ReplyKind = "llm" | "scripted";
export interface LoadedReplySource {
  reply: ReplySource;
  kind: ReplyKind;
}

/** A reply source plus what it turned out to be: the WebGPU LLM when available and
 * it loads, otherwise the scripted reply. `hasWebGpu()` only checks that the API
 * exists, so the LLM can still fail to load (no adapter, out of memory); when it
 * does, this reports "scripted" so the badge and stepper do not claim otherwise.
 * The LLM only ever receives the redacted text. */
export async function makeReplySource(onProgress?: ProgressCallback): Promise<LoadedReplySource> {
  const scripted: LoadedReplySource = {
    reply: async (redacted) => ({ text: scriptedReply(extractPlaceholders(redacted)), source: "scripted" }),
    kind: "scripted",
  };
  if (!hasWebGpu()) return scripted;
  try {
    // q4, not q4f16: fp16 activations are numerically unstable on some WebGPU
    // backends and produce corrupted output. q4 is larger and degrades far less
    // often, but not never, which is why the reply is vetted before it is shown.
    const generate = await pipeline("text-generation", LLM_MODEL, {
      device: "webgpu",
      dtype: "q4",
      progress_callback: onProgress,
    });
    const reply: ReplySource = async (redacted, ctx) => {
      const history = ctx?.window ?? [];
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((t) => ({ role: t.role, content: t.content })),
        { role: "user", content: redacted },
      ];
      // Sampled rather than greedy. A greedy loop is a fixed point of argmax and
      // cannot escape itself; sampling can. The usual repetition controls are no
      // help here: transformers.js applies repetition_penalty and
      // no_repeat_ngram_size across the prompt as well as the generated text, so
      // both would penalize the one thing this prompt asks for, copying a token
      // back verbatim. The temperature stays low for the same reason.
      const out = (await generate(messages, {
        // 96 rather than 64: enough room to finish a short reply, so it is cut off
        // mid-token less often. The reply source recovers a reply the cap still
        // truncates, so a larger budget does not risk a broken token reaching the
        // user; past ~96 the tiny model tends to ramble rather than answer better.
        max_new_tokens: 96,
        do_sample: true,
        temperature: 0.3,
        top_p: 0.9,
      })) as Array<{ generated_text: Array<{ role: string; content: string }> }>;
      const raw = out[0].generated_text.at(-1)!.content;
      // Validate against every token seen this conversation, not just this turn, so
      // a reply may reuse a token from an earlier turn ("your name is [GIVEN_NAME_1]").
      // Without memory, fall back to the current redacted text (single-turn use).
      const validTokens = ctx?.seenTokens ?? redacted;
      // Repair tokens the model reformatted (GIVEN_NAME_1 -> "Given Name 1") back
      // to the ones we minted before vetting, recovering replies that are correct
      // in substance but were rewritten. modelRaw keeps the untouched output so the
      // UI still shows what the model actually wrote.
      const vetted = vetModelReply(repairModelTokens(raw, validTokens), validTokens);
      // A rejected reply falls back to the scripted line and reports the fallback,
      // rather than let the badge imply the LLM answered.
      if (vetted !== null) return { text: vetted, source: "llm", modelRaw: raw };
      return { ...(await scripted.reply(redacted)), modelRaw: raw };
    };
    return { reply, kind: "llm" };
  } catch (e) {
    console.error("on-device LLM load failed; falling back to scripted reply", e);
    return scripted;
  }
}

const PLACEHOLDER_RE = /\[[A-Z][A-Z_]*_\d+\.[0-9a-f]+\]/g;
function extractPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER_RE) ?? [];
}
