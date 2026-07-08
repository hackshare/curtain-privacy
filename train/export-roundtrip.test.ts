import { existsSync } from "node:fs";
import { expect, test } from "vitest";
import { loadNerClassifier } from "../src/ner/classifier.ts";

const dir = process.env.CP_MODEL_DIR ?? "train/runs/model-smoke";

// Needs a locally-built model; skipped when the model dir is absent (CI builds no
// model, so it loads none). Run locally with a built model to exercise the export.
test.skipIf(!existsSync(dir))("exported Q4 model loads and classifies a fixture", async () => {
  const clf = await loadNerClassifier({ model: dir, device: "cpu" });
  const ents = await clf("contact jose reyes today");
  expect(Array.isArray(ents)).toBe(true);
});
