import { createGuard } from "curtain-privacy";
import { pipeline, type ProgressCallback } from "@huggingface/transformers";
import { hasWebGpu } from "./capability.ts";
import { scriptedReply } from "./scripted-reply.ts";
import type { ReplySource, TurnGuard } from "./pipeline.ts";

const LLM_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";

const SYSTEM_PROMPT =
  "You are a concise, friendly assistant in a privacy demo. The user's message contains placeholder tokens in square brackets, like [GIVEN_NAME_1.a1b2], standing in for private values you cannot see. When you greet the user or refer to details they gave, reuse the exact bracketed token from their message, copied character for character, instead of asking for the information again. For example, if their message contains [GIVEN_NAME_1.a1b2], greet them with \"Hi [GIVEN_NAME_1.a1b2]\". Never invent, rename, translate, or put brackets around any other word. Reply in one or two short, natural sentences, and do not mention tokens, brackets, or that anything is hidden.";

/** Load the curtain redaction guard from Hugging Face at the pinned revision. */
export async function loadGuard(): Promise<TurnGuard> {
  const guard = await createGuard({
    model: "hackshare/curtain-privacy",
    revision: "v1.0.0",
    device: "wasm",
  });
  return guard as unknown as TurnGuard;
}

/** A reply source: the WebGPU LLM when available and it loads, otherwise the
 * scripted reply. The LLM only ever receives the redacted text. */
export async function makeReplySource(onProgress?: ProgressCallback): Promise<ReplySource> {
  const scripted: ReplySource = async (redacted) => scriptedReply(extractPlaceholders(redacted));
  if (!hasWebGpu()) return scripted;
  try {
    // q4, not q4f16: fp16 activations are numerically unstable on some WebGPU
    // backends and produce corrupted output. q4 is larger but reliable.
    const generate = await pipeline("text-generation", LLM_MODEL, {
      device: "webgpu",
      dtype: "q4",
      progress_callback: onProgress,
    });
    return async (redacted) => {
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: redacted },
      ];
      const out = (await generate(messages, { max_new_tokens: 128, do_sample: false })) as Array<{ generated_text: Array<{ role: string; content: string }> }>;
      return out[0].generated_text.at(-1)!.content;
    };
  } catch (e) {
    console.error("on-device LLM load failed; falling back to scripted reply", e);
    return scripted;
  }
}

const PLACEHOLDER_RE = /\[[A-Z][A-Z_]*_\d+\.[0-9a-f]+\]/g;
function extractPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER_RE) ?? [];
}
