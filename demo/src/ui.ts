import type { Phase, PhaseContext, Turn } from "./pipeline.ts";

export interface DemoUi {
  root: HTMLElement;
  onSend(handler: (text: string) => void): void;
  setMode(mode: "on-device LLM" | "scripted reply"): void;
  setStatus(text: string): void;
  setError(on: boolean): void;
  /** Post the user's message and show the pipeline stepper for a new turn. */
  beginTurn(original: string): void;
  /** Advance the stepper and the evidence panel to a phase. Awaited by the caller,
   * so returning a paced delay controls how long each phase stays on screen. */
  advancePhase(phase: Phase, ctx: PhaseContext): Promise<void>;
  /** Replace the stepper with the assistant's reply and finalize the panel. */
  completeTurn(turn: Turn): void;
  /** Remove the stepper after a turn threw, leaving the panel as it was. */
  failTurn(): void;
  setBusy(busy: boolean): void;
  /** Register the handler for the New conversation control. */
  onNewConversation(handler: () => void): void;
  /** Clear the chat transcript and the evidence panel for a fresh conversation. */
  resetChat(): void;
}

type StepDef = { id: Phase; label: string; where: "device" | "wire"; receipt: string };

/** Canonical phase order, independent of the labels shown for it. */
const PHASE_ORDER: readonly Phase[] = ["anonymizing", "sending", "generating", "restoring"];

/** With the LLM, the two middle stages are a real round-trip to Qwen: label them
 * so, and mark them as the wire. `receipt` is the short word shown once the turn
 * has collapsed to a one-line record. */
const LLM_STEPS: readonly StepDef[] = [
  { id: "anonymizing", label: "Anonymizing your message", where: "device", receipt: "anonymized" },
  { id: "sending", label: "Sending to Qwen", where: "wire", receipt: "sent" },
  { id: "generating", label: "Qwen is replying", where: "wire", receipt: "replied" },
  { id: "restoring", label: "Restoring your details", where: "device", receipt: "restored" },
];

/** Without WebGPU the reply is composed on the device from a template; nothing is
 * sent anywhere, so no stage claims Qwen and none is marked as the wire. */
const SCRIPTED_STEPS: readonly StepDef[] = [
  { id: "anonymizing", label: "Anonymizing your message", where: "device", receipt: "anonymized" },
  { id: "sending", label: "Matching placeholders", where: "device", receipt: "matched" },
  { id: "generating", label: "Composing the reply", where: "device", receipt: "composed" },
  { id: "restoring", label: "Restoring your details", where: "device", receipt: "restored" },
];

/** How long each phase stays on screen, so the round-trip is legible rather than
 * a flash. The real generating stage runs longer than this on its own. */
const PHASE_DWELL_MS = 300;

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Build the chat + verify-panel skeleton. Styling comes from the stylesheet; this
 * provides structure and behavior only. */
export function buildUi(root: HTMLElement): DemoUi {
  root.innerHTML = `
    <div data-role="phone">
      <div data-role="phone-head">
        <div data-role="badge"></div>
        <button data-role="new-chat" type="button"><span aria-hidden="true">&#8635;</span> New conversation</button>
      </div>
      <div data-role="status"></div>
      <ul data-role="messages"></ul>
      <div data-role="examples">
        <span class="ex-label">Try one</span>
        <button type="button">Write a quick thank-you to Sarah Chen at sarah@acme.com</button>
        <button type="button">Mail the invoice to Chris Okafor at 88 Maple Ave</button>
        <button type="button">Write a birthday message for Marcus Lee</button>
      </div>
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
  const messages = root.querySelector('[data-role="messages"]') as HTMLUListElement;
  const verify = root.querySelector('[data-role="verify-body"]') as HTMLElement;
  const form = root.querySelector('[data-role="composer"]') as HTMLFormElement;
  const input = root.querySelector('[data-role="input"]') as HTMLInputElement;
  const button = form.querySelector("button") as HTMLButtonElement;
  const chips = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-role="examples"] button'));
  const newChat = root.querySelector('[data-role="new-chat"]') as HTMLButtonElement;

  let mode: "on-device LLM" | "scripted reply" = "on-device LLM";

  let sendHandler: (text: string) => void = () => {};
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) { input.value = ""; sendHandler(text); }
  });
  // Example chips send their own text through the same path, so a visitor can see
  // the round-trip on an input the model handles well without typing.
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      if (!chip.disabled) sendHandler(chip.textContent!.trim());
    });
  }
  let newConversationHandler: () => void = () => {};
  newChat.addEventListener("click", () => newConversationHandler());

  const scrollToEnd = () => { messages.scrollTop = messages.scrollHeight; };

  const bubble = (who: string, text: string): void => {
    const el = document.createElement("li");
    el.dataset.who = who;
    el.textContent = text;
    messages.appendChild(el);
    scrollToEnd();
  };

  // The pipeline stepper lives as a transient row in the chat while a turn runs.
  let stepper: HTMLLIElement | null = null;

  const buildStepper = (): HTMLLIElement => {
    const li = document.createElement("li");
    li.dataset.who = "pipeline";
    const ol = document.createElement("ol");
    ol.dataset.role = "pipeline";
    const steps = mode === "on-device LLM" ? LLM_STEPS : SCRIPTED_STEPS;
    for (const p of steps) {
      const step = document.createElement("li");
      step.dataset.step = p.id;
      step.dataset.where = p.where;
      step.dataset.state = "pending";
      step.textContent = p.label;
      ol.appendChild(step);
    }
    li.appendChild(ol);
    return li;
  };

  const markPhase = (phase: Phase): void => {
    if (!stepper) return;
    const reached = PHASE_ORDER.indexOf(phase);
    stepper.querySelectorAll<HTMLLIElement>("[data-step]").forEach((step, i) => {
      step.dataset.state = i < reached ? "done" : i === reached ? "active" : "pending";
    });
    scrollToEnd();
  };

  // Once a turn finishes, the full rail collapses to a one-line record that stays
  // in the transcript, so it does not grow a rail per turn. The two wire words keep
  // the accent so the record still shows what left the device.
  const collapseToReceipt = (el: HTMLLIElement): void => {
    const steps = mode === "on-device LLM" ? LLM_STEPS : SCRIPTED_STEPS;
    el.dataset.who = "receipt";
    el.innerHTML = steps
      .map((s, i) => `${i > 0 ? '<span class="rc-sep">›</span>' : ""}<span class="rc-word${s.where === "wire" ? " rc-wire" : ""}">${s.receipt}</span>`)
      .join("");
  };

  // Evidence panel, built up phase by phase so it tells the same story as the
  // stepper. Reuses the exact structure the stylesheet already targets.
  const showRedacted = (redacted: string, sending: boolean): void => {
    const state = sending ? ' data-state="sending"' : "";
    verify.innerHTML = `<p${state}>Sent to the assistant (redacted): <code>${escapeHtml(redacted)}</code></p>`;
  };

  // Evidence panel after a turn, in the order the design review settled: a verdict
  // line lands the proof first, then the durable ledger (values kept off the wire
  // for the whole conversation), then the working context the model saw this turn,
  // then the model-return drawer. Accent marks only protected values and the wire.
  const showContext = (turn: Turn): void => {
    const verdict =
      `<div class="verdict">` +
      `<div class="verdict-stat"><span class="verdict-n">${turn.mapping.length}</span><span class="verdict-lab">replaced this turn</span></div>` +
      `<div class="verdict-div"></div>` +
      `<div class="verdict-stat"><span class="verdict-n verdict-wire">0</span><span class="verdict-lab">reached the model</span></div>` +
      `</div>`;

    const ledger = turn.entities
      .map((m) => `<div class="led-row">${escapeHtml(m.label)}: <b>${escapeHtml(m.value)}</b> <span class="led-arrow">&rarr;</span> <span class="tok">${escapeHtml(m.placeholder)}</span></div>`)
      .join("");
    const durable =
      `<div class="tier-head"><span class="tier-title">Kept off the wire</span><span class="pill">whole chat &middot; ${turn.entities.length}</span></div>` +
      `<div class="ledger">${ledger}</div>`;

    const ctxLines = turn.context
      .map((t) => `<div class="ctx-line"><span class="ctx-who">${t.role === "user" ? "you" : "asst"}</span><span class="ctx-text">${withChips(t.content)}</span></div>`)
      .join("");
    const working =
      `<div class="tier-head"><span class="tier-title">What the model saw</span><span class="pill pill-wire">this turn</span></div>` +
      `<div class="working">${ctxLines}</div>`;

    verify.innerHTML = verdict + durable + working + modelReturnBlock(turn);
  };

  return {
    root,
    onSend: (h) => { sendHandler = h; },
    setMode: (m) => {
      mode = m;
      badge.textContent = `mode: ${m}`;
      badge.dataset.mode = m === "on-device LLM" ? "llm" : "scripted";
    },
    setStatus: (t) => { (root.querySelector('[data-role="status"]') as HTMLElement).textContent = t; },
    setError: (on) => { if (on) phone.dataset.state = "error"; else delete phone.dataset.state; },
    setBusy: (b) => {
      button.disabled = b;
      input.disabled = b;
      newChat.disabled = b;
      for (const chip of chips) chip.disabled = b;
    },

    beginTurn: (original) => {
      bubble("you", original);
      stepper = buildStepper();
      messages.appendChild(stepper);
      markPhase("anonymizing");
      verify.dataset.turn = "active";
      verify.innerHTML = `<p data-state="reading">Reading your message on this device…</p>`;
    },

    advancePhase: async (phase, ctx) => {
      markPhase(phase);
      // The "crossing the wire" highlight only makes sense when a real request
      // leaves the device; in scripted mode the redacted text just appears.
      const crossingWire = mode === "on-device LLM";
      if (phase === "sending" && ctx.redacted !== undefined) showRedacted(ctx.redacted, crossingWire);
      if (phase === "generating" && ctx.redacted !== undefined) showRedacted(ctx.redacted, false);
      if (!prefersReducedMotion()) await sleep(PHASE_DWELL_MS);
    },

    completeTurn: (turn) => {
      if (stepper) collapseToReceipt(stepper);
      stepper = null;
      bubble("assistant", turn.reply);
      // In LLM mode a turn can still fall back to the scripted reply when the
      // model's output fails vetting. Say so on that turn rather than let the
      // badge imply the LLM answered.
      if (mode === "on-device LLM" && turn.replySource === "scripted") {
        const note = document.createElement("li");
        note.dataset.who = "note";
        note.textContent = "the on-device model's reply couldn't be restored, so this was composed from a template";
        messages.appendChild(note);
        scrollToEnd();
      }
      delete verify.dataset.turn;
      showContext(turn);
    },

    failTurn: () => {
      stepper?.remove();
      stepper = null;
      delete verify.dataset.turn;
    },

    onNewConversation: (h) => { newConversationHandler = h; },
    resetChat: () => {
      stepper = null;
      messages.replaceChildren();
      verify.innerHTML = "";
      delete verify.dataset.turn;
      delete phone.dataset.state;
    },
  };
}

/** A collapsible showing the model's raw output, when a model ran. Shown for both
 * accepted and rejected replies: for an accepted one it is the placeholdered text
 * that reveal then restored; for a rejected one it shows why (often the model
 * rewrote the tokens, e.g. GIVEN_NAME_1 as "Given Name 1", so they no longer
 * matched and could not be restored). */
function modelReturnBlock(turn: Turn): string {
  if (turn.modelRaw === undefined) return "";
  const rejected = turn.replySource === "scripted";
  const note = rejected
    ? `<p class="mr-note">This did not keep the placeholders intact, so it could not be restored, and a template reply was used instead.</p>`
    : "";
  return (
    `<details data-role="model-return">` +
    `<summary>What the model wrote back${rejected ? " (not used)" : ""}</summary>` +
    `<code>${escapeHtml(turn.modelRaw)}</code>${note}` +
    `</details>`
  );
}

const TOKEN_CHIP_RE = /\[[A-Z][A-Z_]*_\d+\.[0-9a-f]+\]/g;
/** Escape text, then wrap each placeholder token in a chip. Tokens contain no HTML
 * metacharacters, so they survive escaping and can be matched afterward. */
function withChips(redacted: string): string {
  return escapeHtml(redacted).replace(TOKEN_CHIP_RE, (t) => `<span class="tok">${t}</span>`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
