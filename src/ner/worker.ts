/**
 * Web Worker host for the NER classifier.
 *
 * Inference must not jank the chat UI, so the model lives on a worker thread.
 * The main thread talks to it through {@link createWorkerClassifier}, which
 * adapts the postMessage round-trip back into the {@link TokenClassifier}
 * signature the pipeline expects — so the rest of the system is agnostic to
 * whether detection runs on the main thread or off it.
 *
 * Bundle this file as the worker entry (it self-registers `onmessage`). The
 * client is created on the main thread with `new Worker(new URL(...))`.
 */

import { detectNer, loadNerClassifier, type NerOptions, type TokenClassifier } from "./classifier";

interface InitMessage {
  readonly kind: "init";
  readonly options: NerOptions;
}
interface DetectMessage {
  readonly kind: "detect";
  readonly id: number;
  readonly text: string;
  readonly minScore?: number;
}
type InboundMessage = InitMessage | DetectMessage;

type WorkerInboundEvent = {
  data: InboundMessage;
};

type WorkerOutboundEvent = {
  data: { kind: string; id?: number; spans?: unknown; message?: string };
};

export type WorkerMessagePort = {
  onmessage: ((event: WorkerInboundEvent) => void) | null;
  onerror?: ((event: { message?: string }) => void) | null;
  postMessage: (message: unknown) => void;
  terminate?: () => void;
};

/** Bound an error to a short string before it crosses the boundary, so a model
 * diagnostic that quotes the input cannot dump the whole text off-device. Caps
 * length rather than semantically stripping input, so treat the result as opaque. */
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 200)}`;
  return "[pii-filter] unknown worker error";
}

// --- Worker side (runs inside the worker thread) ---

/** Register the worker message handler. Call from the worker entry module. */
export function registerNerWorker(scope: WorkerMessagePort): void {
  let classifierPromise: Promise<TokenClassifier> | null = null;

  scope.onmessage = async (event: WorkerInboundEvent) => {
    const message = event.data;
    // The postMessage boundary erases types, so validate shape before use: a
    // malformed message must get a clean error back, never crash the handler.
    if (message === null || typeof message !== "object" || typeof (message as { kind?: unknown }).kind !== "string") {
      scope.postMessage({ kind: "error", message: "[pii-filter] invalid worker message" });
      return;
    }
    if (message.kind === "init") {
      try {
        classifierPromise = loadNerClassifier(message.options);
        await classifierPromise;
        scope.postMessage({ kind: "ready" });
      } catch (error) {
        // Surface init failures so the main thread can fail closed instead of
        // hanging forever on a `ready` message that never arrives.
        classifierPromise = null;
        scope.postMessage({ kind: "error", message: safeErrorMessage(error) });
      }
      return;
    }
    if (message.kind === "detect") {
      if (typeof message.text !== "string") {
        scope.postMessage({ kind: "error", id: message.id, message: "[pii-filter] detect.text must be a string" });
        return;
      }
      try {
        if (classifierPromise === null) throw new Error("[pii-filter] worker not initialized");
        const classifier = await classifierPromise;
        const spans = await detectNer(message.text, classifier, message.minScore);
        scope.postMessage({ kind: "result", id: message.id, spans });
      } catch (error) {
        scope.postMessage({ kind: "error", id: message.id, message: safeErrorMessage(error) });
      }
      return;
    }
    scope.postMessage({ kind: "error", message: `[pii-filter] unknown message kind: ${(message as { kind: string }).kind.slice(0, 40)}` });
  };
}

// --- Main-thread side ---

/**
 * Wrap a worker as a {@link TokenClassifier}-compatible async function. The
 * detection contract is span-in/span-out, so callers use it exactly like the
 * in-process classifier. Resolves once the worker reports `ready`.
 */
export function createWorkerClassifier(
  worker: WorkerMessagePort,
  options: NerOptions,
): { ready: Promise<void>; detect: (text: string, minScore?: number) => Promise<unknown>; terminate: () => void } {
  let nextId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  let resolveReady: () => void = () => {
    /* replaced synchronously by Promise constructor below */
  };
  let rejectReady: (error: unknown) => void = () => {
    /* replaced synchronously by Promise constructor below */
  };
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  worker.onmessage = (event: WorkerOutboundEvent) => {
    const data = event.data;
    if (data.kind === "ready") {
      resolveReady();
      return;
    }
    // Worker reports a pre-init failure (no id) → reject the ready promise so
    // callers fail loudly instead of hanging on `await ready`.
    if (data.kind === "error" && data.id === undefined) {
      rejectReady(new Error(data.message ?? "[pii-filter] worker init failed"));
      return;
    }
    if (data.id === undefined) return;
    const entry = pending.get(data.id);
    if (entry === undefined) return;
    pending.delete(data.id);
    if (data.kind === "error") entry.reject(new Error(data.message));
    else entry.resolve(data.spans);
  };

  // A crash or uncaught rejection *outside* the worker's onmessage try/catch
  // fires onerror, not a `result`/`error` message. Without this, every in-flight
  // detect() promise would hang forever. Reject them all so callers fail closed.
  worker.onerror = (event) => {
    const error = new Error(`[pii-filter] worker crashed: ${event.message ?? "unknown"}`);
    rejectReady(error);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  worker.postMessage({ kind: "init", options });

  function detect(text: string, minScore?: number): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ kind: "detect", id, text, minScore });
    });
  }

  function terminate(): void {
    const error = new Error("[pii-filter] worker terminated");
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    worker.terminate?.();
  }

  return { ready, detect, terminate };
}
