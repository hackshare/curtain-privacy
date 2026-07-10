import { expect, test } from "vitest";
import { scriptedReply } from "./scripted-reply.ts";

test("echoes the placeholders it was given", () => {
  const r = scriptedReply(["[GIVEN_NAME_1.a]", "[EMAIL_1.b]"]);
  expect(r).toContain("[GIVEN_NAME_1.a]");
  expect(r).toContain("[EMAIL_1.b]");
});
test("handles no placeholders", () => {
  expect(scriptedReply([])).toMatch(/nothing to redact/i);
});
