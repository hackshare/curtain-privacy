import { createGuard } from "curtain-privacy";
import { pipeline, type ProgressCallback } from "@huggingface/transformers";
import { hasWebGpu } from "./capability.ts";
import { scriptedReply } from "./scripted-reply.ts";
import { repairModelTokens, vetModelReply } from "./reply-quality.ts";
import type { ReplySource, TurnGuard } from "./pipeline.ts";

const LLM_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";
// Pinned to a specific commit, not "main". The redaction model tracks its moving
// tag live because we own and re-point it; this is a third-party repo, so tracking
// its main would silently adopt an unvetted re-export on the next visit. Bump this
// deliberately after re-testing a newer commit. Pinning also keeps the browser
// cache stable, since the revision is part of each file URL.
const LLM_REVISION = "cc5cc01a65cc3ff17bdb73a7de33d879f62599b0";

// The example codes here are illustrative of the shape, never instructions to
// output them, so the model does not copy the sample salt (an earlier prompt that
// told the model to greet with a spelled-out token had it copy that token). Naming
// the exact failure ("invent one like [YOUR_NAME]") and "do not introduce yourself"
// beat a vaguer "do not restate their details", which pushed the model into
// confused replies that asked the user who they were.
const SYSTEM_PROMPT =
  "You are a helpful assistant. Some words in the user's message are codes in square brackets like [GIVEN_NAME_1.ab12cd] that stand for private details you cannot see. Reply with one short, friendly sentence that responds to their message. If you refer to one of their details, write the exact bracketed code, copied character for character; never write a code from memory, shorten it, or invent one like [YOUR_NAME]. Do not introduce yourself and do not mention the codes.";

/** The two published redaction models, a size/quality tier. curtain-small is the
 * default; curtain-tiny is the smaller, faster footprint. The note is the one real
 * reason to pick each, stated plainly. */
export interface RedactionModel {
  readonly revision: string;
  readonly name: string;
  readonly size: string;
  readonly note: string;
}
export const REDACTION_MODELS: readonly RedactionModel[] = [
  { revision: "v2.0.0", name: "curtain-small", size: "60 MB", note: "24 languages" },
  { revision: "v1.0.0", name: "curtain-tiny", size: "14 MB", note: "fastest" },
];
export const DEFAULT_REVISION = REDACTION_MODELS[0].revision;

const REPO = "hackshare/curtain-privacy";

/** Resolve each tag to the immutable commit it currently points to. Loading the
 * model from a SHA-pinned revision keeps the browser cache correct when a moving
 * tag (v2.0.0) is re-pointed to a newer build: the SHA changes, so transformers.js
 * fetches the new files rather than serving the stale ones it cached under the
 * tag. Falls back to the tag itself if Hugging Face is unreachable. */
export async function resolveRevisions(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await fetch(`https://huggingface.co/api/models/${REPO}/refs`);
    if (res.ok) {
      const data = (await res.json()) as { tags?: { name: string; targetCommit: string }[] };
      for (const t of data.tags ?? []) if (t.name && t.targetCommit) map.set(t.name, t.targetCommit);
    }
  } catch {
    /* offline or blocked: callers fall back to the tag, which still loads */
  }
  return map;
}

/** Load the curtain redaction guard from Hugging Face at a pinned revision (a
 * commit SHA, or a tag as a fallback). Callers cache the result so switching
 * models flips instantly after the first load. */
export async function loadGuard(revision: string): Promise<TurnGuard> {
  const guard = await createGuard({
    model: REPO,
    revision,
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
      revision: LLM_REVISION,
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
