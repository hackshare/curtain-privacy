import type { Turn } from "./pipeline.ts";

export interface DemoUi {
  root: HTMLElement;
  onSend(handler: (text: string) => void): void;
  setMode(mode: "on-device LLM" | "scripted reply"): void;
  setStatus(text: string): void;
  setError(on: boolean): void;
  addTurn(turn: Turn): void;
  setBusy(busy: boolean): void;
}

/** Build the chat + verify-panel skeleton. Styling is applied later from the design
 * brief; this provides the structure and behavior only. */
export function buildUi(root: HTMLElement): DemoUi {
  root.innerHTML = `
    <div data-role="phone">
      <div data-role="badge"></div>
      <div data-role="status"></div>
      <ul data-role="messages"></ul>
      <form data-role="composer">
        <input data-role="input" placeholder="Type a message with a name, email, or SSN" />
        <button type="submit">Send</button>
      </form>
    </div>
    <aside data-role="verify">
      <h2>What the assistant actually saw</h2>
      <div data-role="verify-body"></div>
    </aside>`;
  const phone = root.querySelector('[data-role="phone"]') as HTMLElement;
  const badge = root.querySelector('[data-role="badge"]') as HTMLElement;
  const messages = root.querySelector('[data-role="messages"]')!;
  const verify = root.querySelector('[data-role="verify-body"]')!;
  const form = root.querySelector('[data-role="composer"]') as HTMLFormElement;
  const input = root.querySelector('[data-role="input"]') as HTMLInputElement;
  const button = form.querySelector("button") as HTMLButtonElement;

  let sendHandler: (text: string) => void = () => {};
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) { input.value = ""; sendHandler(text); }
  });

  const li = (who: string, text: string): void => {
    const el = document.createElement("li");
    el.dataset.who = who;
    el.textContent = text;
    messages.appendChild(el);
  };

  return {
    root,
    onSend: (h) => { sendHandler = h; },
    setMode: (m) => {
      badge.textContent = `mode: ${m}`;
      badge.dataset.mode = m === "on-device LLM" ? "llm" : "scripted";
    },
    setStatus: (t) => { root.querySelector('[data-role="status"]')!.textContent = t; },
    setError: (on) => { if (on) phone.dataset.state = "error"; else delete phone.dataset.state; },
    setBusy: (b) => { button.disabled = b; input.disabled = b; },
    addTurn: (turn) => {
      li("you", turn.original);
      li("assistant", turn.reply);
      verify.innerHTML =
        `<p>Sent to the assistant (redacted): <code>${escapeHtml(turn.redacted)}</code></p>` +
        `<p>Detected and kept off the wire:</p><ul>` +
        turn.mapping.map((m) => `<li>${escapeHtml(m.label)}: <b>${escapeHtml(m.value)}</b> -> <code>${escapeHtml(m.placeholder)}</code></li>`).join("") +
        `</ul>`;
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
