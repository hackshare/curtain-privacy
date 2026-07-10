import { expect, test } from "vitest";
import { hasWebGpu } from "./capability.ts";

test("true when navigator.gpu exists", () => {
  expect(hasWebGpu({ gpu: {} } as Navigator)).toBe(true);
});
test("false when it does not", () => {
  expect(hasWebGpu({} as Navigator)).toBe(false);
});
