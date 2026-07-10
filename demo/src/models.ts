import { createGuard } from "curtain-privacy";
import { pipeline, type ProgressCallback } from "@huggingface/transformers";
import { hasWebGpu } from "./capability.ts";
import { scriptedReply } from "./scripted-reply.ts";
import type { ReplySource, TurnGuard } from "./pipeline.ts";

const LLM_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";

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
 * scripted reply. The LLM only ever receives redacted text. */
export async function makeReplySource(onProgress?: ProgressCallback): Promise<ReplySource> {
  const scripted: ReplySource = async (redacted) => scriptedReply(extractPlaceholders(redacted));
  if (!hasWebGpu()) return scripted;
  try {
    const generate = await pipeline("text-generation", LLM_MODEL, {
      device: "webgpu",
      dtype: "q4",
      progress_callback: onProgress,
    });
    return async (redacted) => {
      const messages = [
        { role: "system", content: "You are a helpful assistant. The user's message may contain placeholder tokens like [GIVEN_NAME_1.xxxx]; treat them as opaque values and reuse them verbatim." },
        { role: "user", content: redacted },
      ];
      const out = (await generate(messages, { max_new_tokens: 128, do_sample: false })) as Array<{ generated_text: Array<{ role: string; content: string }> }>;
      return out[0].generated_text.at(-1)!.content;
    };
  } catch {
    return scripted;
  }
}

const PLACEHOLDER_RE = /\[[A-Z][A-Z_]*_\d+\.[0-9a-f]+\]/g;
function extractPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER_RE) ?? [];
}
