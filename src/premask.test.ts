import { expect, test } from "vitest";
import { NO_PREMASK_LABELS } from "./premask";

test("SECONDARY_ADDRESS is excluded from premasking", () => {
  expect(NO_PREMASK_LABELS.has("SECONDARY_ADDRESS")).toBe(true);
});

test("PASSPORT is excluded from premasking", () => {
  expect(NO_PREMASK_LABELS.has("PASSPORT")).toBe(true);
});
