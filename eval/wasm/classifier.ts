// A TokenClassifier backed by onnxruntime-web (the WASM backend, same binary the
// browser runs) so the library's detectNer/ChatGuard decode runs unchanged over
// deterministic WASM inference, in Bun, with no browser. Native onnxruntime-node
// over-redaction is platform-specific (Linux differs from macOS); this is not.
import { readFileSync } from "node:fs";
import { AutoTokenizer } from "@huggingface/transformers";
import * as ort from "onnxruntime-web";
import type { TokenClassifier } from "../../src/ner/classifier.ts";

function toBigInt64(arr: ArrayLike<number> | BigInt64Array): BigInt64Array {
  if (arr instanceof BigInt64Array) return arr;
  return BigInt64Array.from(Array.from(arr as ArrayLike<number>, (v) => BigInt(v)));
}

export async function loadWasmClassifier(modelDir: string): Promise<TokenClassifier> {
  const tokenizer = await AutoTokenizer.from_pretrained(modelDir);
  const config = JSON.parse(readFileSync(`${modelDir}/config.json`, "utf8"));
  const id2label: Record<string, string> = config.id2label;
  const numLabels = Object.keys(id2label).length;
  const session = await ort.InferenceSession.create(`${modelDir}/onnx/model_q4.onnx`, {
    executionProviders: ["wasm"],
  });
  const needsTypeIds = session.inputNames.includes("token_type_ids");

  const classifier = (async (text: string) => {
    const enc = await tokenizer(text);
    const ids = toBigInt64(enc.input_ids.data);
    const mask = toBigInt64(enc.attention_mask.data);
    const seq = ids.length;
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor("int64", ids, [1, seq]),
      attention_mask: new ort.Tensor("int64", mask, [1, seq]),
    };
    if (needsTypeIds) feeds.token_type_ids = new ort.Tensor("int64", new BigInt64Array(seq), [1, seq]);

    const out = await session.run(feeds);
    const data = out.logits.data as Float32Array; // [1, seq, numLabels]
    const tokens = tokenizer.tokenize(text); // content tokens, no specials

    const entities: { entity: string; index: number; word: string; score: number; start: number; end: number }[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const pos = i + 1; // logits row: 0 is the leading special, content token i at i+1
      const base = pos * numLabels;
      let maxId = 0;
      let maxV = -Infinity;
      for (let l = 0; l < numLabels; l++) {
        const v = data[base + l];
        if (v > maxV) { maxV = v; maxId = l; }
      }
      const label = id2label[String(maxId)];
      if (label === "O") continue;
      let sum = 0;
      for (let l = 0; l < numLabels; l++) sum += Math.exp(data[base + l] - maxV);
      // index is the position into [CLS] + content + [SEP] (see buildTokenIndexOffsets).
      entities.push({ entity: label, index: pos, word: tokens[i], score: 1 / sum, start: 0, end: 0 });
    }
    return entities;
  }) as TokenClassifier;

  classifier.tokenize = (text: string) => tokenizer.tokenize(text);
  classifier.countTokens = (text: string) => tokenizer.tokenize(text).length;
  return classifier;
}
