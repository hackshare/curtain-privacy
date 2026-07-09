import { expect, test } from "vitest";
import { nerPipelineOptions } from "./classifier.ts";

test("omits revision when not given", () => {
  expect(nerPipelineOptions({ device: "wasm" })).toEqual({ dtype: "q4", device: "wasm" });
});

test("includes revision when given", () => {
  expect(nerPipelineOptions({ device: "cpu", revision: "v1" })).toEqual({
    dtype: "q4",
    device: "cpu",
    revision: "v1",
  });
});

test("omits revision when empty string", () => {
  expect(nerPipelineOptions({ device: "wasm", revision: "" })).toEqual({ dtype: "q4", device: "wasm" });
});
