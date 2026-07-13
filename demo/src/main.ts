import { buildUi } from "./ui.ts";
import { loadGuard, makeReplySource } from "./models.ts";
import { hasWebGpu } from "./capability.ts";
import { runTurn } from "./pipeline.ts";
import { ConversationMemory } from "./memory.ts";

const READY = "Ready. Everything runs in your browser; nothing you type leaves the device.";

const ui = buildUi(document.querySelector("#app") as HTMLElement);
const memory = new ConversationMemory();
// Optimistic until the LLM actually loads; corrected from the loaded kind below.
ui.setMode(hasWebGpu() ? "on-device LLM" : "scripted reply");
ui.setBusy(true);

try {
  ui.setStatus("Loading the redaction model...");
  const guard = await loadGuard();
  ui.setStatus(hasWebGpu() ? "Loading the on-device LLM..." : "Ready.");
  const { reply, kind } = await makeReplySource((p) => ui.setStatus(`Loading the on-device LLM... ${describe(p)}`));
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
