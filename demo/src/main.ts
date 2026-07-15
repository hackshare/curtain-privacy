import { buildUi } from "./ui.ts";
import { loadGuard, makeReplySource, resolveRevisions, REDACTION_MODELS, DEFAULT_REVISION } from "./models.ts";
import { hasWebGpu } from "./capability.ts";
import { runTurn, type TurnGuard } from "./pipeline.ts";
import { ConversationMemory } from "./memory.ts";

const READY = "Ready. Everything runs in your browser; nothing you type leaves the device.";

const modelName = (rev: string) => REDACTION_MODELS.find((m) => m.revision === rev)?.name ?? "the redaction model";

// tag -> immutable commit SHA, populated at startup so the model loads from a
// SHA-pinned URL and the browser cache stays correct when a tag is re-pointed.
let resolved = new Map<string, string>();
const immutableRev = (tag: string) => resolved.get(tag) ?? tag;

// Guards are cached by resolved revision: the first switch to a model downloads it
// and every switch after that flips instantly. A re-pointed tag resolves to a new
// SHA on the next page load, so the cache never serves a stale model.
const guards = new Map<string, TurnGuard>();
async function getGuard(tag: string): Promise<TurnGuard> {
  const rev = immutableRev(tag);
  const cached = guards.get(rev);
  if (cached) return cached;
  const g = await loadGuard(rev);
  guards.set(rev, g);
  return g;
}

const ui = buildUi(document.querySelector("#app") as HTMLElement);
const memory = new ConversationMemory();
// Optimistic until the LLM actually loads; corrected from the loaded kind below.
ui.setMode(hasWebGpu() ? "on-device LLM" : "scripted reply");
ui.setBusy(true);

try {
  ui.setModel(DEFAULT_REVISION);
  ui.setStatus(`Loading ${modelName(DEFAULT_REVISION)}...`);
  resolved = await resolveRevisions();
  let guard = await getGuard(DEFAULT_REVISION);
  ui.setStatus(hasWebGpu() ? "Loading the on-device LLM (downloads once, then cached)..." : "Ready.");
  const { reply, kind } = await makeReplySource((p) => ui.setStatus(`Loading the on-device LLM (downloads once, then cached)... ${describe(p)}`));
  ui.setMode(kind === "llm" ? "on-device LLM" : "scripted reply");
  ui.setStatus(READY);
  ui.setBusy(false);

  ui.onSend(async (text) => {
    ui.setError(false);
    ui.setBusy(true);
    ui.setStatus("Working through the round-trip...");
    ui.beginTurn(text);
    try {
      const turn = await runTurn(guard, reply, text, {
        memory,
        onPhase: (phase, ctx) => ui.advancePhase(phase, ctx),
      });
      ui.completeTurn(turn);
      ui.setStatus(READY);
    } catch (e) {
      ui.failTurn();
      ui.setStatus(`Error: ${errText(e)}`);
      ui.setError(true);
    } finally {
      ui.setBusy(false);
    }
  });

  ui.onNewConversation(() => {
    memory.clear();
    guard.reset();
    ui.resetChat();
    ui.setStatus(READY);
  });

  // Switching the redaction model loads the chosen one (cached after the first
  // time) and starts a clean conversation, since placeholders are per-guard.
  ui.onModelChange(async (revision) => {
    ui.setError(false);
    ui.setBusy(true);
    ui.setStatus(guards.has(revision) ? `Switching to ${modelName(revision)}...` : `Downloading ${modelName(revision)}...`);
    try {
      guard = await getGuard(revision);
      guard.reset();
      memory.clear();
      ui.resetChat();
      ui.setModel(revision);
      ui.setStatus(READY);
    } catch (e) {
      ui.setStatus(`Could not switch model: ${errText(e)}`);
      ui.setError(true);
    } finally {
      ui.setBusy(false);
    }
  });
} catch (e) {
  console.error("demo load failed", e);
  ui.setStatus(`Could not load the demo: ${errText(e)}`);
  ui.setError(true);
  ui.setBusy(false);
}

function errText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return "see the browser console for details";
}

function describe(p: unknown): string {
  const o = p as { status?: string; progress?: number };
  return o.status === "progress" && typeof o.progress === "number" ? `${Math.round(o.progress)}%` : (o.status ?? "");
}
