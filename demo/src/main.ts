import { buildUi } from "./ui.ts";
import { loadGuard, makeReplySource } from "./models.ts";
import { hasWebGpu } from "./capability.ts";
import { runTurn } from "./pipeline.ts";

const READY = "Ready. Everything runs in your browser; nothing you type leaves the device.";

const ui = buildUi(document.querySelector("#app") as HTMLElement);
ui.setMode(hasWebGpu() ? "on-device LLM" : "scripted reply");
ui.setBusy(true);

try {
  ui.setStatus("Loading the redaction model...");
  const guard = await loadGuard();
  ui.setStatus(hasWebGpu() ? "Loading the on-device LLM..." : "Ready.");
  const reply = await makeReplySource((p) => ui.setStatus(`Loading the on-device LLM... ${describe(p)}`));
  ui.setStatus(READY);
  ui.setBusy(false);

  ui.onSend(async (text) => {
    ui.setError(false);
    ui.setBusy(true);
    ui.setStatus("Redacting, generating, revealing...");
    try {
      ui.addTurn(await runTurn(guard, reply, text));
      ui.setStatus(READY);
    } catch (e) {
      ui.setStatus(`Error: ${errText(e)}`);
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
