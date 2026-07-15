// onnxruntime-web ships types (types.d.ts) but its package.json "exports" do not
// map them, so tsc cannot resolve them for `import ... from "onnxruntime-web"`.
// Declare the minimal surface the WASM gate uses. The runtime binary is the same
// one transformers.js (and therefore the browser) loads.
declare module "onnxruntime-web" {
  export const env: { versions?: Record<string, string> };
  export class Tensor {
    constructor(type: string, data: BigInt64Array | Float32Array, dims: number[]);
    readonly data: Float32Array | BigInt64Array;
  }
  export class InferenceSession {
    static create(path: string, options?: { executionProviders?: string[] }): Promise<InferenceSession>;
    readonly inputNames: string[];
    readonly outputNames: string[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }
}
