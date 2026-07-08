import { createGuard } from "../../src/guard";
import { loadCases } from "../real/load";
import { obfuscate } from "./obfuscate";

const model = process.env.CURTAIN_MODEL;
if (!model) {
  console.error("set CURTAIN_MODEL to a built curtain model path (see train/)");
  process.exit(1);
}

const cases = loadCases("eval/real/cases.jsonl");
const guard = await createGuard({ model, device: "cpu" });

let clean = 0;
let obfuscated = 0;
for (const [i, c] of cases.entries()) {
  guard.reset();
  const cleanHits = (await guard.protect(c.text)).placeholders.length;
  guard.reset();
  const obfHits = (await guard.protect(obfuscate(c.text, i + 1))).placeholders.length;
  if (cleanHits > 0) clean += 1;
  if (obfHits >= cleanHits && cleanHits > 0) obfuscated += 1;
}

if (clean === 0) {
  console.error("no PII-containing cases found in the corpus; nothing to measure");
  process.exit(1);
}
const rate = obfuscated / clean;
console.log(`cases with PII: ${clean}`);
console.log(`obfuscated cases still fully covered: ${obfuscated} (${(rate * 100).toFixed(1)}%)`);
if (rate < 1) {
  console.error("REGRESSION: obfuscation reduced coverage on at least one case");
  process.exit(1);
}
