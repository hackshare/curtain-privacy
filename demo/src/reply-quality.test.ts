import { expect, test } from "vitest";
import { repairModelTokens, trimToLastSentence, vetModelReply } from "./reply-quality.ts";

const SALT = "e64d0672c960";
const SENT = `[GIVEN_NAME_1.${SALT}] is dead`;

const INTRO = `Hi, my name is [GIVEN_NAME_1.${SALT}] [SURNAME_1.${SALT}], [EMAIL_1.${SALT}]`;

test("repair leaves verbatim tokens unchanged", () => {
  const raw = `Hi [GIVEN_NAME_1.${SALT}], good to meet you.`;
  expect(repairModelTokens(raw, INTRO)).toBe(raw);
});

test("repair fixes a token the model down-cased and spaced", () => {
  const raw = `Hello, [Given Name 1.${SALT}]!`;
  expect(repairModelTokens(raw, INTRO)).toBe(`Hello, [GIVEN_NAME_1.${SALT}]!`);
});

test("repair fixes an expanded label by its leading word", () => {
  // EMAIL_1 comes back as "Email Address 1"; matched by the salt and the word EMAIL.
  const raw = `Reach me at [Email Address 1.${SALT}].`;
  expect(repairModelTokens(raw, INTRO)).toBe(`Reach me at [EMAIL_1.${SALT}].`);
});

test("repair fixes several mangled tokens in one reply", () => {
  const raw = `[Given Name 1.${SALT}] [Surname 1.${SALT}] at [Email Address 1.${SALT}]`;
  expect(repairModelTokens(raw, INTRO)).toBe(`[GIVEN_NAME_1.${SALT}] [SURNAME_1.${SALT}] at [EMAIL_1.${SALT}]`);
});

test("repair matches even when the number is dropped", () => {
  const raw = `Email is [Email Address.${SALT}].`;
  expect(repairModelTokens(raw, INTRO)).toBe(`Email is [EMAIL_1.${SALT}].`);
});

test("repair tolerates a space the model inserts after the dot", () => {
  const raw = `Hello! My name is [Given Name 1. ${SALT}].`;
  expect(repairModelTokens(raw, INTRO)).toBe(`Hello! My name is [GIVEN_NAME_1.${SALT}].`);
});

test("repair does not merge an invented salt-less token", () => {
  // [YOUR_NAME] has no salt, so it is not ours and must be left for vetting.
  const raw = `Hello! I'm [YOUR_NAME] at [YOUR_EMAIL].`;
  expect(repairModelTokens(raw, INTRO)).toBe(raw);
});

test("repair refuses a token whose salt is not ours", () => {
  const raw = `Hi [Given Name 1.deadbeefcafe]!`;
  expect(repairModelTokens(raw, INTRO)).toBe(raw);
});

test("repair leaves an ambiguous label alone", () => {
  // Two GIVEN_NAMEs sent, model drops the number: cannot tell which one.
  const sent = `[GIVEN_NAME_1.${SALT}] met [GIVEN_NAME_2.${SALT}]`;
  const raw = `Hello [Given Name.${SALT}].`;
  expect(repairModelTokens(raw, sent)).toBe(raw);
});

test("a repaired reply then passes vetting and can be revealed", () => {
  const raw = `Hi [Given Name 1.${SALT}], nice to meet you.`;
  const repaired = repairModelTokens(raw, INTRO);
  expect(vetModelReply(repaired, INTRO)).toBe(`Hi [GIVEN_NAME_1.${SALT}], nice to meet you.`);
});

test("accepts a reply that copies a token we actually sent", () => {
  const raw = `I'm sorry to hear about [GIVEN_NAME_1.${SALT}].`;
  expect(vetModelReply(raw, SENT)).toBe(raw);
});

test("accepts a reply that echoes no token at all", () => {
  expect(vetModelReply("I'm sorry to hear that.", SENT)).toBe("I'm sorry to hear that.");
});

test("rejects the example token copied out of the system prompt", () => {
  // Observed in the browser: the model reproduced the prompt's own illustration
  // rather than the token in the message. Its salt is not one we minted, so
  // reveal cannot restore it and the user sees a raw token.
  const raw = "Hello Mr. [GIVEN_NAME_1.a1b2], I'm sorry to hear about your accident.";
  expect(vetModelReply(raw, SENT)).toBeNull();
});

test("rejects a bare fragment when the tail was cut off mid-token", () => {
  expect(vetModelReply("Let me try again: Hi [GIVEN_NAME_", SENT)).toBeNull();
});

test("recovers whole sentences when the last token is cut off at the cap", () => {
  // The model copied the tokens correctly but ran out of budget mid-salt on the
  // last one. Drop the partial token, keep the complete sentences before it.
  const raw = `Hello [GIVEN_NAME_1.${SALT}]. Glad to help. Reach me at [EMAIL_1.3895`;
  expect(vetModelReply(raw, SENT)).toBe(`Hello [GIVEN_NAME_1.${SALT}]. Glad to help.`);
});

test("rejects bracketed gibberish", () => {
  // Observed in the browser on a WebGPU backend: decoding collapsed into a loop
  // of bracketed fragments.
  const raw = "[EF62] [C] [D] [EF62] [EF62] [EF62] [EF62] [EF62]";
  expect(vetModelReply(raw, SENT)).toBeNull();
});

test("rejects an invented bare token", () => {
  expect(vetModelReply("Hello [NAME_OF_THE_USER], how can I help?", SENT)).toBeNull();
});

test("rejects a repetition loop that contains no brackets", () => {
  const raw = Array(20).fill("My name contains GLOWED value").join(" ");
  expect(vetModelReply(raw, SENT)).toBeNull();
});

test("rejects an empty reply", () => {
  expect(vetModelReply("   \n ", SENT)).toBeNull();
});

test("a token we did send is not mistaken for residue", () => {
  const sent = `[GIVEN_NAME_1.${SALT}] and [PHONE_1.${SALT}]`;
  const raw = `Hi [GIVEN_NAME_1.${SALT}], I have [PHONE_1.${SALT}] on file.`;
  expect(vetModelReply(raw, sent)).toBe(raw);
});

test("trimToLastSentence drops a dangling partial sentence", () => {
  expect(trimToLastSentence("All good. I was about to say")).toBe("All good.");
});

test("trimToLastSentence leaves a complete reply alone", () => {
  expect(trimToLastSentence("All good. Anything else?")).toBe("All good. Anything else?");
});

test("trimToLastSentence never cuts inside a token's salt", () => {
  // The dot inside a placeholder must not read as a sentence boundary.
  const raw = `Hi [GIVEN_NAME_1.${SALT}]`;
  expect(trimToLastSentence(raw)).toBe(raw);
});
