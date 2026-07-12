import { expect, test } from "vitest";
import { runTurn, type Phase, type PhaseContext, type ReplySource, type ReplyContext } from "./pipeline.ts";
import { ConversationMemory, WINDOW_TURNS } from "./memory.ts";
import type { Span } from "curtain-privacy";

const span = (label: string, text: string, start: number): Span =>
  ({ start, end: start + text.length, label: label as Span["label"], score: 1, source: "ner", text });

const guard = {
  detectRedactions: async () => [span("EMAIL", "b@x.com", 20), span("GIVEN_NAME", "Alex", 11)],
  protect: async () => ({ text: "My name is [GIVEN_NAME_1.s], email [EMAIL_1.s]", placeholders: ["[GIVEN_NAME_1.s]", "[EMAIL_1.s]"] }),
  reveal: (r: string) => r.replaceAll("[GIVEN_NAME_1.s]", "Alex").replaceAll("[EMAIL_1.s]", "b@x.com"),
  reset: () => {},
};

/** A reply source that always returns the same LLM text. */
const llm = (text: string): ReplySource => async () => ({ text, source: "llm" });

test("hands the reply source only redacted text, reveals, and maps correctly", async () => {
  let sawRedacted = "";
  const reply: ReplySource = async (redacted) => { sawRedacted = redacted; return { text: "Hi [GIVEN_NAME_1.s]", source: "llm" }; };
  const turn = await runTurn(guard, reply, "My name is Alex, email b@x.com");
  expect(sawRedacted).toBe("My name is [GIVEN_NAME_1.s], email [EMAIL_1.s]");
  expect(turn.reply).toBe("Hi Alex");
  expect(turn.replySource).toBe("llm");
  expect(turn.mapping).toEqual([
    { placeholder: "[GIVEN_NAME_1.s]", label: "GIVEN_NAME", value: "Alex" },
    { placeholder: "[EMAIL_1.s]", label: "EMAIL", value: "b@x.com" },
  ]);
});

test("propagates a scripted fallback onto the turn", async () => {
  const reply: ReplySource = async () => ({ text: "Hi [GIVEN_NAME_1.s]", source: "scripted" });
  const turn = await runTurn(guard, reply, "My name is Alex");
  expect(turn.replySource).toBe("scripted");
  expect(turn.reply).toBe("Hi Alex");
  expect(turn.modelRaw).toBeUndefined();
});

test("carries the raw model output onto the turn when a model ran", async () => {
  const reply: ReplySource = async () => ({ text: "Hi [GIVEN_NAME_1.s]", source: "llm", modelRaw: "Hi [GIVEN_NAME_1.s] there" });
  const turn = await runTurn(guard, reply, "My name is Alex");
  expect(turn.modelRaw).toBe("Hi [GIVEN_NAME_1.s] there");
});

test("strips placeholder-shaped tokens a weak model invents", async () => {
  // reveal restores the real token; the invented [BROOKVALLE.<hex>] is not a real
  // token, so it must be cleaned rather than shown.
  const turn = await runTurn(guard, llm("Hi [GIVEN_NAME_1.s], I noted [BROOKVALLE.f36bf60b70f1] for you."), "My name is Alex, email b@x.com");
  expect(turn.reply).toBe("Hi Alex, I noted for you.");
});

test("emits the four phases in order, with redacted text from sending on", async () => {
  const seen: Array<{ phase: Phase; hasRedacted: boolean; rows: number }> = [];
  await runTurn(guard, llm("Hi [GIVEN_NAME_1.s]"), "My name is Alex, email b@x.com", {
    onPhase: (phase: Phase, ctx: PhaseContext) =>
      void seen.push({ phase, hasRedacted: ctx.redacted !== undefined, rows: ctx.mapping?.length ?? 0 }),
  });
  expect(seen.map((s) => s.phase)).toEqual(["anonymizing", "sending", "generating", "restoring"]);
  expect(seen.map((s) => s.hasRedacted)).toEqual([false, true, true, true]);
  expect(seen.at(-1)!.rows).toBe(2);
});

test("does not run the reply source until after the generating phase begins", async () => {
  const order: string[] = [];
  const reply: ReplySource = async () => { order.push("reply-called"); return { text: "ok", source: "llm" }; };
  await runTurn(guard, reply, "My name is Alex", {
    onPhase: (phase: Phase) => void order.push(`phase:${phase}`),
  });
  expect(order.indexOf("reply-called")).toBeGreaterThan(order.indexOf("phase:generating"));
  expect(order.indexOf("reply-called")).toBeLessThan(order.indexOf("phase:restoring"));
});

test("strips an invented token whose salt is too short to look real", async () => {
  const turn = await runTurn(guard, llm("Hi [GIVEN_NAME_1.a1b2], good to meet you."), "My name is Alex");
  expect(turn.reply).toBe("Hi, good to meet you.");
});

test("strips a token the model was cut off midway through", async () => {
  const turn = await runTurn(guard, llm("Let me try again: Hi [GIVEN_NAME_"), "My name is Alex");
  expect(turn.reply).toBe("Let me try again: Hi");
});

test("strips bracketed gibberish from a collapsed decoder", async () => {
  const turn = await runTurn(guard, llm("[EF62] [C] [D] [EF62] [EF62]"), "My name is Alex");
  expect(turn.reply).toBe("");
});

test("with memory, the reply source is given the window and seen tokens, and no real value", async () => {
  const memory = new ConversationMemory();
  let seen: { redacted: string; ctx?: ReplyContext } | null = null;
  const reply: ReplySource = async (redacted, ctx) => { seen = { redacted, ctx }; return { text: "Hi [GIVEN_NAME_1.s]", source: "llm" }; };

  const turn = await runTurn(guard, reply, "My name is Alex, email b@x.com", { memory });

  // Nothing the reply source received contains a real value.
  const blob = seen!.redacted + JSON.stringify(seen!.ctx);
  expect(blob).not.toContain("Alex");
  expect(blob).not.toContain("b@x.com");
  // The seen-token string carries this turn's tokens.
  expect(seen!.ctx!.seenTokens).toContain("[GIVEN_NAME_1.s]");
  // The turn carries the context the model saw and the durable entity list.
  expect(turn.context.at(-1)).toEqual({ role: "user", content: "My name is [GIVEN_NAME_1.s], email [EMAIL_1.s]" });
  expect(turn.entities.map((e) => e.value).sort()).toEqual(["Alex", "b@x.com"]);
});

test("with memory, a completed turn is appended as redacted user + assistant", async () => {
  const memory = new ConversationMemory();
  await runTurn(guard, async () => ({ text: "Hi [GIVEN_NAME_1.s]", source: "llm" }), "My name is Alex, email b@x.com", { memory });
  const w = memory.window();
  expect(w.map((t) => t.role)).toEqual(["user", "assistant"]);
  expect(w[0].content).toBe("My name is [GIVEN_NAME_1.s], email [EMAIL_1.s]");
  expect(w[1].content).toBe("Hi [GIVEN_NAME_1.s]");
});

test("seen tokens still include a token whose turn has left the window", async () => {
  const memory = new ConversationMemory();
  // First turn mints the tokens and records them in the durable memory.
  await runTurn(guard, async () => ({ text: "ok", source: "llm" }), "My name is Alex, email b@x.com", { memory });
  // Push enough turns to evict the first from the window.
  let lastCtx: ReplyContext | undefined;
  const capture: ReplySource = async (_r, ctx) => { lastCtx = ctx; return { text: "ok", source: "llm" }; };
  for (let i = 0; i < WINDOW_TURNS; i++) await runTurn(guard, capture, "nothing here", { memory });
  expect(lastCtx!.seenTokens).toContain("[GIVEN_NAME_1.s]");
});

test("with memory, the window handed to the reply source excludes the current turn", async () => {
  const echoGuard = {
    detectRedactions: async () => [],
    protect: async (t: string) => ({ text: `[R] ${t}`, placeholders: [] as string[] }),
    reveal: (r: string) => r,
    reset: () => {},
  };
  const memory = new ConversationMemory();
  await runTurn(echoGuard, async () => ({ text: "reply one", source: "llm" }), "first message", { memory });
  let windowContents: string[] = [];
  let currentRedacted = "";
  const capture: ReplySource = async (redacted, ctx) => {
    currentRedacted = redacted;
    windowContents = ctx!.window.map((t) => t.content);
    return { text: "reply two", source: "llm" };
  };
  await runTurn(echoGuard, capture, "second message", { memory });
  expect(currentRedacted).toBe("[R] second message");
  expect(windowContents).toEqual(["[R] first message", "reply one"]);
  expect(windowContents).not.toContain("[R] second message");
});
