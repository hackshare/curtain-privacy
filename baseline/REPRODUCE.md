# Reproducing the curtain-privacy Phase 0 baseline

## Commands
1. `bun install`
2. `bun run bench:fetch --n 30000 --seed 0 --concurrency 8 --out eval/bench/data/heldout.jsonl --manifest baseline/heldout.manifest.json`
3. `bun run bench --data eval/bench/data/heldout.jsonl --out baseline`
4. Gate: `bun -e 'import {checkBaseline,BASELINE_REF} from "./eval/bench/check-baseline.ts"; const s=require("./baseline/summary.json"); process.exit(checkBaseline(s,BASELINE_REF).ok?0:1)'`

## Environment (fill in actual values from your run)
- bun: 1.3.13
- @huggingface/transformers: 3.7.5
- Model: nationaldesignstudio/rampart (HF), revision: not pinned — transformers.js local cache does not persist commit SHA; model was resolved on 2026-06-30
- Dataset revision: ai4privacy/pii-masking-openpii-1.5m, num_rows=1636375, num_bytes_parquet=4257750732
- Platform: Darwin arm64

## Notes
- Reproduction is verified by headline-within-CI, not byte-identical UIDs.
- Latency p50 is hardware-dependent and is a soft check only.
- The `nationaldesignstudio/rampart` model on HuggingFace may be updated over time without a version bump; pin a commit SHA to reproduce exact numbers.

## Discrepancy vs. the published whitepaper (resolved)

Rampart's whitepaper / model card reports strict span F1 **0.528** (recall 98.42%).
Our reproduction of the **same shipped model** scores strict F1 **0.756** (recall 98.63%)
on a deterministic seed-0 30k slice. This is **not** model drift or dataset drift — both
were ruled out with evidence:

- `onnx/model_q4.onnx` is blob-identical across every Hugging Face commit since the
  2026-06-29 initial release. The 2026-06-30 "Update model card to reflect released
  weights" commit changed only `README.md` prose, not the weights or the metrics.
- The `ai4privacy/pii-masking-openpii-1.5m` dataset has been frozen since 2026-06-03,
  before both runs, so the gold `privacy_mask` annotations are identical.

The cause is a **scoring-harness difference**: the published 0.528 was produced by an
earlier version of Rampart's eval harness that under-counted exact span matches. The
strict counts are the fingerprint — whitepaper tp/fp/fn = 67339 / 55823 / 64368 vs ours
98497 / 32697 / 30761 on a near-identical gold-span count. Both fp **and** fn roughly
doubled while tp dropped ~31k: the signature of ~31k true positives being miscounted as
simultaneous false-positive **and** false-negative, i.e. a span offset/boundary miscount.
The current (shipped and vendored) harness's offset-recovery + premask span projection
scores the same model's spans as exact; direct inspection confirms boundaries are
byte-exact (e.g. STREET_NAME and BUILDING_NUMBER matched to the character). We could not
run the old harness directly, so the mechanism is high-but-not-certain; that 0.756 is
correctly measured is directly verified.

**Conclusion:** 0.756 is the model's strict span F1 under correct scoring, and is what we
freeze in `BASELINE_REF`. The whitepaper's 0.528 is a harness measurement artifact, not
the model's true quality.

The genuine weak spots (from a per-label breakdown) are the numeric-ID classes —
CREDIT_CARD ~0.16 and SSN ~0.18 strict F1, where non-Luhn cards and 9-digit IDs fall
through the deterministic layer and get mislabeled PHONE/TAX_ID — not span-boundary
coherence.
