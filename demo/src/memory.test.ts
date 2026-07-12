import { expect, test } from "vitest";
import { ConversationMemory, WINDOW_TURNS } from "./memory.ts";

const row = (value: string, placeholder: string, label = "GIVEN_NAME") => ({ value, placeholder, label });

test("window keeps only the most recent WINDOW_TURNS turns", () => {
  const m = new ConversationMemory();
  for (let i = 0; i < WINDOW_TURNS + 4; i++) m.append(i % 2 === 0 ? "user" : "assistant", `turn ${i}`);
  const w = m.window();
  expect(w.length).toBe(WINDOW_TURNS);
  expect(w[0].content).toBe(`turn 4`);
  expect(w.at(-1)!.content).toBe(`turn ${WINDOW_TURNS + 3}`);
});

test("noteMapping dedupes by value and never drops", () => {
  const m = new ConversationMemory();
  m.noteMapping([row("Sarah", "[GIVEN_NAME_1.s]")]);
  m.noteMapping([row("Sarah", "[GIVEN_NAME_1.s]"), row("Chen", "[SURNAME_1.s]", "SURNAME")]);
  const e = m.entities();
  expect(e.map((r) => r.value)).toEqual(["Sarah", "Chen"]);
});

test("seenTokens covers a token whose turn has left the window", () => {
  const m = new ConversationMemory();
  m.noteMapping([row("Sarah", "[GIVEN_NAME_1.s]")]);
  for (let i = 0; i < WINDOW_TURNS + 4; i++) m.append("user", `turn ${i}`);
  expect(m.seenTokens()).toContain("[GIVEN_NAME_1.s]");
});

test("clear forgets turns and entities", () => {
  const m = new ConversationMemory();
  m.append("user", "hi");
  m.noteMapping([row("Sarah", "[GIVEN_NAME_1.s]")]);
  m.clear();
  expect(m.window().length).toBe(0);
  expect(m.entities().length).toBe(0);
  expect(m.seenTokens()).toBe("");
});
