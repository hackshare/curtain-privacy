import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Import the in-repo library by name; Vite bundles its TypeScript source.
  resolve: {
    alias: {
      "curtain-privacy": fileURLToPath(new URL("../index.ts", import.meta.url)),
    },
  },
  // transformers.js loads its wasm/onnx runtime; do not pre-bundle it.
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  // Top-level await in main.ts requires a modern target; WebGPU already implies this.
  build: { target: "esnext" },
});
