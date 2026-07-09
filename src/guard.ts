/**
 * ChatGuard: per-conversation PII filter for wiring into a chat app.
 *
 *   const guard = await createGuard({ model: "./path/to/built/curtain" });
 *   const safe = await guard.protect(userInput);
 *   const reply = await llm(safe.text);
 *   guard.reveal(reply);                    // non-streaming
 *   stream.pipeThrough(guard.revealTransform()); // streaming
 *
 * The entity table lives only on the client; the real values never leave the
 * device. Each guard keeps placeholder identity stable across every turn of a
 * conversation.
 *
 *   user message
 *     → heuristics (sync, structured PII)
 *     → NER (optional, async, contextual PII)
 *     → merge + default-deny policy (keep {city, state, zip})
 *     → session table: replace with stable placeholders
 *   assistant reply
 *     → rehydrate placeholders → render to user
 */

import { detectHeuristics } from "./heuristics";
import { loadNerClassifier, detectNer, type NerOptions } from "./ner/classifier";
import { createWorkerClassifier, type WorkerMessagePort } from "./ner/worker";
import { premask, projectMaskedSpan, NO_PREMASK_LABELS } from "./premask";
import { createRevealTransform } from "./streaming";
import { SessionEntityTable, neutralizePlaceholders, type PlaceholderAliases, type ScrubResult } from "./session";
import { extendSpans } from "./recognizers";
import { resolveKeepLabels, type PiiLabel, type Span } from "./types";
import { applyPolicy } from "./policy";
import { resolveThresholds, type OperatingPoint } from "./thresholds";
import { normalizeForDetection, remapSpan } from "./normalize";

/** An async contextual detector. Matches both the in-process and worker forms. */
export type NerDetector = (text: string) => Promise<Span[]>;

/**
 * Default placeholder aliases. Empty: names are split into GIVEN_NAME/SURNAME
 * and a household may share a surname, so each keeps its own typed token
 * (`[GIVEN_NAME_1]`, `[SURNAME_1]`) rather than collapsing to a single `NAME`.
 */
export const DEFAULT_ALIASES: PlaceholderAliases = {};

/** Default input-length cap. ~100k chars covers any real chat message while
 * bounding the synchronous redaction work on untrusted input. */
export const DEFAULT_MAX_INPUT_CHARS = 100_000;

/** Default worker init/detect timeout. */
export const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

export interface GuardOptions {
  /** Placeholder aliases. Defaults to `{}` — typed tokens like `[GIVEN_NAME_1]`. */
  readonly aliases?: PlaceholderAliases;
  /** Labels to preserve; defaults to `{CITY, STATE, ZIP_CODE}`. */
  readonly keepLabels?: readonly PiiLabel[];
  /**
   * When `true`, skip the structured-PII premask before the model. Required for
   * a model trained without prefilter (no-prefilter ablation) whose classes
   * include SSN / CREDIT_CARD / IP_ADDRESS. Heuristic spans for those types
   * still run as a safety net.
   */
  readonly noPrefilter?: boolean;
  /** Pre-built NER detector. When set, `model` is ignored. */
  readonly ner?: NerDetector;
  /** When `true`, skip the classifier and run heuristics only. */
  readonly heuristicsOnly?: boolean;
  /**
   * Local directory path to a built `curtain` model (q4 ONNX), or a Hugging Face
   * id if you host your own. Required unless `ner` or `heuristicsOnly` is set;
   * build the model with the `train/` pipeline and pass its path.
   */
  readonly model?: string;
  /** HF revision (commit or tag) to pin when `model` is a HF id. */
  readonly revision?: string;
  /** Worker script URL. When set, NER runs off the main thread. */
  readonly worker?: string | URL;
  /** Backend. `"wasm"`/`"webgpu"` in browsers; `"cpu"` for Node. */
  readonly device?: NerOptions["device"];
  /** Spans below this score are discarded. */
  readonly minScore?: number;
  /**
   * Reject input longer than this many characters (default
   * {@link DEFAULT_MAX_INPUT_CHARS}). Redaction runs synchronously over the whole
   * string, so an unbounded paste is a self-inflicted stall on the path that gates
   * outbound text; cap it. Set higher only if you knowingly need larger messages.
   */
  readonly maxInputChars?: number;
  /**
   * When NER runs in a `worker`, fail a stalled model load or detection after this
   * many milliseconds instead of hanging forever (default
   * {@link DEFAULT_WORKER_TIMEOUT_MS}). Ignored for the in-process detector.
   */
  readonly workerTimeoutMs?: number;
  /**
   * Recall/retention dial for the in-process detector. Defaults to "balanced".
   * NOTE: not applied when NER runs in a `worker` — worker mode uses the
   * balanced default. Same limitation applies to `thresholdOverrides`.
   */
  readonly operatingPoint?: OperatingPoint;
  /** Per-label anchor overrides (advanced). */
  readonly thresholdOverrides?: Partial<Record<PiiLabel, number>>;
}

type ChatGuardConfig = Pick<GuardOptions, "ner" | "aliases" | "keepLabels" | "noPrefilter" | "maxInputChars">;

export class ChatGuard {
  private readonly table: SessionEntityTable;
  private readonly ner?: NerDetector;
  private readonly noPrefilter: boolean;
  private readonly keepLabels: ReadonlySet<PiiLabel>;
  private readonly maxInputChars: number;

  constructor(config: ChatGuardConfig = {}) {
    this.keepLabels = resolveKeepLabels(config.keepLabels);
    this.table = new SessionEntityTable(config.aliases, this.keepLabels);
    this.ner = config.ner;
    this.noPrefilter = config.noPrefilter ?? false;
    this.maxInputChars = config.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  }

  /** Reject oversized input before any synchronous work (neutralize, detection)
   * touches it, so a huge paste cannot stall the outbound-gating path. */
  private ensureWithinCap(text: string): void {
    if (text.length > this.maxInputChars) {
      throw new RangeError(
        `[pii-filter] input of ${text.length} chars exceeds maxInputChars ${this.maxInputChars}`,
      );
    }
  }

  private async detect(text: string): Promise<Span[]> {
    const heuristic = detectHeuristics(text);
    if (this.ner === undefined) return heuristic;
    if (this.noPrefilter) {
      const modelSpans = await this.ner(text);
      return extendSpans(text, [...heuristic, ...modelSpans]);
    }
    const map = premask(text, heuristic.filter((s) => !NO_PREMASK_LABELS.has(s.label)));
    const maskedSpans = await this.ner(map.masked);
    const contextual: Span[] = [];
    for (const span of maskedSpans) {
      const projected = projectMaskedSpan(span, text, map);
      if (projected !== null) contextual.push(projected);
    }
    return extendSpans(text, [...heuristic, ...contextual]);
  }

  /** Detect on a normalized view of `safe`, returning spans on `safe`'s original
   * offsets. Normalization removes zero-width characters and folds confusable /
   * compatibility forms so obfuscated PII still matches; the offset map projects
   * every span back so redaction removes the user's actual characters. */
  private async detectOnOriginal(safe: string): Promise<Span[]> {
    const nrm = normalizeForDetection(safe);
    const spans = await this.detect(nrm.text);
    return spans.map((s) => remapSpan(s, nrm, safe));
  }

  /**
   * The spans this guard will redact for `text`, on original-text offsets —
   * the same set `protect` hides (keep-set filtered and merged by applyPolicy).
   * Read-only: does not mutate the session table.
   */
  async detectRedactions(text: string): Promise<Span[]> {
    this.ensureWithinCap(text);
    const safe = neutralizePlaceholders(text);
    return applyPolicy(await this.detectOnOriginal(safe), this.keepLabels);
  }

  /**
   * Run this on the user's text *before* handing it to the AI SDK. Returns the
   * placeholdered text to send plus the placeholders introduced this turn.
   *
   * Placeholder-shaped runs in the input are neutralized first (see
   * {@link neutralizePlaceholders}) so a token the user pastes cannot round-trip
   * through the model into a real value on {@link reveal}.
   */
  async protect(text: string): Promise<ScrubResult> {
    this.ensureWithinCap(text);
    const safe = neutralizePlaceholders(text);
    const spans = await this.detectOnOriginal(safe);
    return this.table.scrub(safe, spans);
  }

  /** Restore real values in a complete (non-streaming) assistant reply. */
  reveal(reply: string): string {
    return this.table.rehydrate(reply);
  }

  /**
   * Forget every placeholder binding at a conversation boundary. Call before
   * reusing one guard for a different conversation or user so values from one
   * never surface in another.
   */
  reset(): void {
    this.table.reset();
  }

  /**
   * A Web Streams transform that reveals placeholders in a streamed reply,
   * correctly handling placeholders split across chunks. Pipe an AI SDK
   * `textStream` through it before rendering.
   */
  revealTransform(): TransformStream<string, string> {
    return createRevealTransform((token) => {
      const restored = this.table.rehydrate(token);
      return restored === token ? null : restored;
    });
  }

  /**
   * Defense in depth: scrub the model's *output* before logging/persisting it,
   * since a model can emit PII the user never typed. Returns placeholdered text.
   */
  async protectReply(reply: string): Promise<ScrubResult> {
    this.ensureWithinCap(reply);
    const safe = neutralizePlaceholders(reply);
    const spans = await this.detectOnOriginal(safe);
    return this.table.scrub(safe, spans);
  }
}

type NerLoadOptions = Pick<GuardOptions, "model" | "revision" | "worker" | "minScore" | "device" | "operatingPoint" | "thresholdOverrides" | "workerTimeoutMs">;

/** Reject if `p` has not settled within `ms`, so a wedged worker cannot hang the
 * caller forever. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[pii-filter] ${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function buildNer(options: NerLoadOptions): Promise<NerDetector> {
  const { model, revision, worker, minScore, device = "wasm", operatingPoint = "balanced", thresholdOverrides } = options;
  const timeoutMs = options.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
  const threshold = minScore !== undefined ? minScore : resolveThresholds(operatingPoint, thresholdOverrides);
  const modelOptions = { model, revision, device, minScore };

  if (worker !== undefined) {
    // The DOM `Worker` types `onmessage` with `MessageEvent`; `WorkerMessagePort`
    // is the deliberately DOM-free structural port the worker module also uses.
    // They are not mutually assignable, so cast at this single boundary.
    const port = new Worker(worker, { type: "module" }) as unknown as WorkerMessagePort;
    const classifier = createWorkerClassifier(port, modelOptions);
    await withTimeout(classifier.ready, timeoutMs, "worker init");
    return async (text) => (await withTimeout(classifier.detect(text), timeoutMs, "worker detect")) as Span[];
  }

  const classifier = await loadNerClassifier(modelOptions);
  return (text) => detectNer(text, classifier, threshold);
}

/**
 * Build a conversation guard. There is no default model: pass `model` (a Hugging
 * Face id such as `hackshare/curtain-privacy`, optionally with `revision`, or a
 * local path), `heuristicsOnly: true` to skip NER, or `ner` to inject a custom
 * detector.
 */
export async function createGuard(options: GuardOptions = {}): Promise<ChatGuard> {
  const { aliases = DEFAULT_ALIASES, keepLabels, noPrefilter, ner, heuristicsOnly, maxInputChars, ...nerLoad } = options;

  let detector = ner;
  if (detector === undefined && heuristicsOnly !== true) {
    detector = await buildNer(nerLoad);
  }

  return new ChatGuard({ ner: detector, aliases, keepLabels, noPrefilter, maxInputChars });
}
