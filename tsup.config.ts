import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // transformers.js is a peer dependency: never bundle it into dist.
  external: ["@huggingface/transformers"],
});
