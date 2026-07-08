---
library_name: transformers.js
pipeline_tag: token-classification
license: mit
language:
  - en
  - es
  - fr
  - de
  - it
  - pt
  - nl
  - pl
  - cs
  - sk
  - lt
  - lv
  - et
  - sv
  - da
  - fi
  - hu
  - ro
  - sl
  - hr
  - vi
  - ms
  - id
  - tl
tags:
  - pii
  - redaction
  - privacy
  - onnx
  - web
  - client-side
  - minilm
  - browser
datasets:
  - ai4privacy/pii-masking-openpii-1.5m
base_model: nreimers/MiniLM-L6-H384-uncased
metrics:
  - char-level-protected-rate
  - public-char-retention
  - span-f1
---

# curtain

`curtain` is a 14.2 MB ONNX token-classification model that detects personally identifiable information (PII) in text before it leaves the user's device.
It is the on-device model of **curtain-privacy**, a defense-in-depth client-side redaction system.
The model runs alongside a deterministic recognizer layer that handles structured identifiers; together they form the complete system.

The model is not fetched from a host. It is built locally from the committed training pipeline (`train/`) and loaded by path; see "Reproducibility" for the build.

curtain-privacy is a fork of **Rampart** by National Design Studio, inheriting its encoder architecture, training recipe, and base deterministic layer. `curtain` is trained by curtain-privacy from the public base checkpoint on OpenPII plus targeted augmentation; it is not Rampart's released weights. The numbers below are this model's own, scored end-to-end through the shipped pipeline under a character-level metric (see "Evaluation").

## Model summary

| Property              | Value                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Base checkpoint       | [`nreimers/MiniLM-L6-H384-uncased`](https://huggingface.co/nreimers/MiniLM-L6-H384-uncased), fine-tuned with a 35-label BIO head (17 entity types) |
| Parameters            | ≈18.5M (MiniLM-L6-H384 with the trimmed 19,730-piece vocabulary; the 22.7M base figure is for the full 30,522-piece BERT vocab) |
| Quantization          | 4-bit MatMul + INT8 embedding (`onnx/model_q4.onnx`)                                                                            |
| Shipped artifact size | 14.2 MB (14,874,677 bytes) |
| Vocabulary            | 19,730 WordPieces (trimmed from BERT-uncased's 30,522, retaining all special and single-character pieces plus frequent multi-character pieces) |
| Max sequence          | 512 tokens                                                                                                                      |
| Languages             | English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Czech, Slovak, Lithuanian, Latvian, Estonian, Swedish, Danish, Finnish, Hungarian, Romanian, Slovenian, Croatian, Vietnamese, Malay, Indonesian, Tagalog (all Latin-script) |
| Runtime               | ONNX Runtime Web (WASM/WebGPU) via `transformers.js`                                                                            |
| Training data         | OpenPII train split (~150k rows) plus curtain-privacy augmentation; see "Training data"                                         |
| License               | MIT (weights and code); trained on CC BY 4.0 data, see "Training data" and NOTICE                                                |
| Built on              | Rampart (architecture, recipe, base deterministic layer) by National Design Studio                                             |

## Intended use

The model is designed for **client-side redaction of user-typed text in AI assistants and intake flows**, replacing identifying values with stable placeholders before any data is transmitted to a model provider, a server, or a logging system.

### Direct uses

- Redact user content before passing it to a hosted LLM.
- Maintain stable placeholders (`[GIVEN_NAME_1]`, `[SSN_1]`, ...) across a multi-turn conversation, with rehydration on the client.
- Preempt accidental collection of personal data in analytics, traces, and crash reports.
- Validate domain-specific redaction policies before deploying chat systems in regulated contexts.

### Out of scope

- **Stand-alone government-ID detection.**
  The model is one layer of a defense-in-depth system; it is not a replacement for the deterministic recognizer layer that ships alongside it.
  SSNs and payment cards are caught by the deterministic layer with checksum validation (structural rules and Luhn), at higher recall than the model alone.
  Phone, routing, government-ID, passport, and license numbers carry no checksum, so they are caught by the model; the deterministic layer does not attempt them.
- **Indirect / inferential identifiers.**
  A "rare disease + 5-digit ZIP" combination can re-identify someone even though neither token is in the redact-set.
  The model does not detect inferential leaks.
- **Adversarial robustness as a security guarantee.**
  Detection normalizes input before matching, closing single-vector obfuscation such as zero-width character injection and cross-script homoglyphs. We publish numbers on hostile inputs and document the failure surface; the system is harm reduction for users entering their own information in good faith, not a security boundary against motivated adversaries composing novel or layered evasions.
- **Non-Latin scripts.**
  This release is scoped to the 24 Latin-script languages listed above.
  Korean, Han Chinese, Japanese, Arabic, Cyrillic, and Devanagari names are out of scope because the training data is Latin-script only (see "Fairness and limitations" below).
  Do not deploy this release for populations who routinely type non-Latin-script names without compensating controls; monitor accordingly.

### Usage

The runtime ships as `curtain-privacy`. `createGuard()` returns a `ChatGuard` that loads this classifier and runs the full deterministic + model pipeline:

```ts
import { createGuard } from "curtain-privacy";

const guard = await createGuard();
const { text } = await guard.protect("My name is Alex Rivera and my SSN is 472-81-0094.");
// → "My name is [GIVEN_NAME_1] [SURNAME_1] and my SSN is [SSN_1]."
```

## Training data

| Source                                                                                                       | Rows used                        | License    | Role                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`ai4privacy/pii-masking-openpii-1.5m`](https://huggingface.co/datasets/ai4privacy/pii-masking-openpii-1.5m) | ~150,000 train split             | CC BY 4.0  | Realistic chat-style PII; 24 Latin-script languages (en, es, fr, de, it, pt, nl, pl, cs, sk, lt, lv, et, sv, da, fi, hu, ro, sl, hr, vi, ms, id, tl); the OpenPII schema mapped to our 35-label BIO schema (17 entity types). Disjoint from the 30,000-row held-out eval slice. |
| curtain-privacy augmentation                                                                                 | ~160,000 train                   | CC BY 4.0  | The distribution the public corpus lacks, generated from the OpenPII rows and committed seeds: diverse Latin-script names across many locales, messy real-world formatting (field-style separators, case and spacing noise), GOVERNMENT_ID variety (custom-prefixed identifiers next to identity cues), and keep-negatives (order/reference codes and city/state left untagged, so the model learns the keep boundary). |

Training rows total about 310,000 (the OpenPII base plus the augmentation). The augmentation is
deterministic from a seed and reproducible from the committed generators.

The keep-negatives were the decisive component. Augmentation that only added redactable variety
closed the real-world detection gap but pushed the model toward over-redaction; adding the
keep-negatives is what let a model clear both the recall and the retention gates.

### Pre-processing

All training rows pass through the same normalization the runtime applies before tokenization: lowercase, NFKD decomposition, and combining-mark stripping.
The combining-mark step folds accents, `José` becomes `jose`, `Müller` becomes `muller`, so the model sees a single canonical form regardless of how the user typed the name.
This matches what BERT's BasicTokenizer does implicitly at inference time under `do_lower_case=True`, so the train-time and runtime distributions are identical by construction.
A guard in the training pipeline fails the run if a future tokenizer change breaks this assumption.

A re-trainer who omits this normalization step will produce a model with mismatched distributions, and recall numbers will not reproduce.

The structured classes the deterministic layer owns (`SSN`, `CREDIT_CARD`, `IP_ADDRESS`) are also masked to sentinel tokens before tokenization, both at inference (`src/premask.ts`) and during dataset construction, so the model never learns to classify raw card/SSN/IP digits and the train-time and inference-time inputs match by construction.

### Vocabulary

The full BERT-uncased vocabulary contains 30,522 WordPieces.
The shipped vocabulary retains:

1. All special tokens (`[PAD]`, `[UNK]`, `[CLS]`, `[SEP]`, `[MASK]`).
2. All single-character pieces and their `##` continuations, which preserve WordPiece's character-level fallback for rare names.
3. All multi-character pieces appearing in the training corpus above a frequency threshold.

The shipped vocabulary is **19,730 pieces**.

### Training procedure

| Hyperparameter      | Value                            |
| ------------------- | -------------------------------- |
| Base                | nreimers/MiniLM-L6-H384-uncased  |
| Epochs              | 3                                |
| Batch size          | 32                               |
| Learning rate       | 5e-5                             |
| Weight decay        | 0.01                             |
| Max sequence length | 512                              |
| Optimizer           | AdamW                            |
| Eval strategy       | per-epoch on held-out validation |
| Save strategy       | per-epoch                        |
| Hardware            | Apple M-series MPS               |
| Total wall time     | ~3.5 hours                       |

The final epoch was selected by held-out eval loss.

## Label taxonomy

The model emits 35 BIO labels (17 entity types × {B-, I-} + O); the deterministic
recognizer layer contributes three more structured classes that are masked before
the model runs. The runtime applies a default-deny policy: every detected span is
redacted unless its label is explicitly in the keep-set.

### Redacted by default

Owned by the deterministic recognizer layer (regex + validator, masked before the model):

| Label         | Description                                                       |
| ------------- | ----------------------------------------------------------------- |
| `SSN`         | Social Security Numbers (US), structural validation              |
| `CREDIT_CARD` | Payment card numbers, Luhn-validated                             |
| `EMAIL`       | Email addresses                                                   |
| `URL`         | URLs in user content                                              |
| `IP_ADDRESS`  | IPv4 / IPv6 / MAC addresses                                       |

Emitted by the token-classification model:

| Label               | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `GIVEN_NAME`        | Given / first names                                  |
| `SURNAME`           | Family / last names                                  |
| `PHONE`             | Phone numbers                                        |
| `TAX_ID`            | Tax identifiers                                      |
| `BANK_ACCOUNT`      | Bank account / IBAN numbers                          |
| `ROUTING_NUMBER`    | Bank routing numbers                                 |
| `GOVERNMENT_ID`     | Government-issued ID / case numbers                  |
| `PASSPORT`          | Passport numbers                                     |
| `DRIVERS_LICENSE`   | Driver's license numbers                             |
| `BUILDING_NUMBER`   | Street-line building number                          |
| `STREET_NAME`       | Street name                                          |
| `SECONDARY_ADDRESS` | Secondary-address line (apt / unit / suite)          |

`BUILDING_NUMBER` + `STREET_NAME` together form the precise street line; both are
redacted while city/state/ZIP are kept.

### Kept by default

| Label      | Description                                                  |
| ---------- | ------------------------------------------------------------ |
| `CITY`     | City, coarse geography for eligibility checks               |
| `STATE`    | State / region                                               |
| `ZIP_CODE` | Postal code                                                  |

The keep-set keeps coarse geography (city/state/ZIP) while redacting the precise
street line. To change it, edit `KEEP_LABELS` in `src/types.ts`, it is a
compile-time set, not a runtime flag.

The taxonomy is deliberately **atomic**: there is no coarse `PERSON`,
`STREET_ADDRESS`, `ADDRESS`, `ORGANIZATION`, or `LOCATION` label, and no catch-all
`SECRET`. Names split into `GIVEN_NAME` / `SURNAME`, the street line into
`BUILDING_NUMBER` / `STREET_NAME`, and document identifiers into their specific
classes, so the model learns to catch PII fragments in disordered text rather than
expecting one tidy blob. Dates, ages, and income are intentionally **not** modeled
as PII (they map to `O`): a bare date is rarely identifying, and assistants need age
and income as context, so redacting them was over-redaction without a privacy gain.

## Evaluation

We score the **full system** (model + deterministic layer) because that is what consumers experience end-to-end.
Model-only numbers are reported separately for researchers who want to evaluate the encoder in isolation.

### Primary metric

Scoring is **character-level and occurrence-anchored**: each significant (alphanumeric)
character of a gold occurrence is scored as covered by a redaction span or not, and an
occurrence counts as fully protected only when every significant character is covered. This is
strictly harder than the usual term-presence metric, which credits a partially redacted value as
protected if the exact gold string is gone. Two numbers follow; the protected-rate is reported
with a Wilson 95% confidence interval:

- **protected-rate**: fraction of private occurrences fully protected (the privacy headline).
- **public char-retention**: fraction of significant public characters left untouched (over-redaction).

These character-level numbers are not comparable to term-presence figures from other PII cards.

### Held-out OpenPII test set: seven Latin-script languages (30,000 rows, 129,258 private occurrences)

Measured by the committed `eval/bench` harness running the shipped Q4 pipeline end to end over a
pinned held-out slice of `pii-masking-openpii-1.5m`, disjoint from training.

- **protected-rate 98.24%** (Wilson 95% CI [98.16%, 98.31%])
- **char-recall 98.50%**
- **public char-retention 96.43%**
- span-F1 strict (IoU=1.0) 0.746
- latency: cold ~330 ms, p50 4.6 ms, p95 13.5 ms on CPU (Node ONNX)

The protected-rate is 0.64 percentage points below the previous seven-language model on this same
benchmark. This is the honest, documented cost of spreading a 14.2 MB model across 24 languages:
a diagnostic run of the full-precision fp32 export of the same weights reaches only 98.47%, so
approximately 0.41 pp of the gap is model capacity (24 languages competing for the same
parameters), not quantization. No larger export recovers it.

Per-language char-recall (seven-language held-out slice):

| Language | char-recall | Language | char-recall |
| --- | --- | --- | --- |
| Italian (`it`)    | 96.85% | German (`de`)     | 98.65% |
| Dutch (`nl`)      | 97.52% | French (`fr`)     | 99.36% |
| English (`en`)    | 98.29% | Portuguese (`pt`) | 99.32% |
| Spanish (`es`)    | 99.18% | | |

Italian is the weakest at 96.85%, driven by residual SSN and credit-card format variants that
escape the deterministic checksums and the model does not detect. Public retention is lowest in
English (95.26%) and highest in Portuguese (97.48%).

**Person-name recall across all 24 languages.** A separate eval measures person-name recall
(significant-character coverage) on a pinned per-language validation sample across all 24
supported languages. Every language reaches at least 95.4%. The weakest is Lithuanian (95.4%);
English reaches 100%; Vietnamese reaches 97.3%, up from a 70.0% baseline before the language
expansion; Latvian reaches 96.5% and Swedish 96.2%.

### Real-world corpus: 157 hand-authored en-US cases

A hand-authored corpus with format-valid fake PII, a normal and a messy tier, and 205 planted
keep-set landmines that must not be redacted:

- **protected-rate 99.76%** (416 of 417 redactable terms)
- **keep-violation-rate 1.95%** (4 of 205 landmines over-redacted)

The four over-redactions are one state name (Oregon) and three order codes (#INV-20260512,
#CAL-2290, #PLT-4492), precision costs on a recall-first system, under the 3% over-redaction gate.

### Fairness across naming traditions: 300 held-out cases

Diverse Latin-script names drawn from a seed disjoint from the training augmentation, so the model
is scored on names it did not train on:

- **protected-rate 99.41%**
- **keep-violation-rate 1.00%**

The diverse-name augmentation (see "Training data") is what lifts this above a retrain that trains
on the public corpus alone.

## Calibration

The runtime applies a single recall-biased confidence floor (`minScore` = 0.4) uniformly
across the model's labels, chosen against the 10,000-row OpenPII Latin calibration split
(disjoint from test) so misses, which leak data, are traded against the cheaper failure
of over-redaction. There is no per-label threshold table in the shipped runtime; the
deterministic recognizer layer, not a tuned model threshold, is the system of record for
the structured classes the model alone is weakest on:

- **SSN**, structural validation (reserved-area rules).
- **CREDIT_CARD**, Luhn checksum over the digit projection.
- **EMAIL / URL / IP_ADDRESS**, pattern-anchored regex at near-100% recall.

Phone, routing, government-ID, passport, and license numbers carry no checksum and are
left to the model under the same recall-biased floor.

## Fairness and limitations

We document failures because consumers need this to deploy the redactor responsibly.

### Diverse names within Latin scripts

The held-out 300-case fairness corpus (see "Evaluation") scores diverse Latin-script names the
model did not train on at 99.41% protected-rate. The diverse-name augmentation is what closes the
gap a public-corpus-only retrain leaves on non-Anglo Latin names.

### Non-Latin scripts (out of scope)

The training data is Latin-script only, so recall on non-Latin scripts (Han, Japanese, Korean,
Arabic, Cyrillic, Devanagari) is low and those scripts are unsupported. The deterministic layer
does not catch names (there is no checksum to validate against), so this surfaces at the system
level. Do not deploy this release for populations who routinely type non-Latin-script names
without compensating controls.

### Government-style identifiers

Custom-prefixed government and agency identifiers (case numbers, employee and agency IDs, and the
like) carry no checksum, so the deterministic layer does not validate them. This model trains on
GOVERNMENT_ID augmentation and the context-cued recognizer backs it up; on the real-world corpus
every such identifier is caught. The recognizer still leans on an identity cue near the code, so a
genuine identifier stated with no cue and in a format the model also misses could slip through.

### Adversarial robustness

Detection runs on a normalized view of the input: zero-width and invisible characters are removed, compatibility and fullwidth forms and cross-script homoglyphs are folded to their ASCII skeleton, and unusual spaces are regularized. This closes single-vector obfuscation such as zero-width characters injected between digits of an SSN or a Cyrillic lookalike inside an email address. Redaction then removes the user's actual characters, so non-PII text is preserved byte-for-byte.

The system does not reliably catch:

- Prompt-injection text inside the PII span (e.g. `"ignore previous instructions"`).
- Combined attacks composing multiple evasion vectors simultaneously.

curtain-privacy is designed to protect users entering their own information in good faith from incidental disclosure to downstream services, not to defeat a motivated user actively trying to smuggle their own PII past the filter.

### WordPiece fragmentation on long names

Names like `Thanh-Nghiem Quoc-Bao` or `Chukwuemeka Okonkwo-Adeyemi` produce many subwords; the runtime performs span-merging across same-label adjacencies plus particle-rescue, which closes most of the gap.
Some five-or-more-subword names still fragment in a way that loses recall on the trailing subword.

## Reproducibility

The code, model weights, deterministic layer, and the training and evaluation harnesses are released under the MIT License. The training data (ai4privacy/OpenPII) is CC BY 4.0 and the MiniLM base checkpoint is MIT; see NOTICE for attributions.

Both the model and the numbers are reproducible from committed code. Evaluation runs the shipped
TypeScript pipeline over a frozen OpenPII held-out slice and writes `summary.json` /
`by_language.json` alongside the output, so every number in this card traces to committed
evidence. The held-out row `uid`s are pinned in a committed manifest (`bun run bench:fetch` to
regenerate, `bun run bench` to reproduce). The model itself rebuilds from the public base
checkpoint: the from-base fine-tune, the augmentation generators (seeded and deterministic), and
the vocab-trim and quantization export are all committed under `train/`. See
[`train/BUILD.md`](train/BUILD.md) for the step-by-step build.

## Citation

If you use this model in research, please cite:

```bibtex
@misc{curtain-privacy-2026,
  title  = {curtain-privacy: On-device PII redaction with a strictly measured, augmented model},
  year   = {2026},
  note   = {Built on Rampart by National Design Studio},
}
```

Please also cite the upstream training corpus:

```bibtex
@misc{ai4privacy-openpii-1.5m,
  title  = {ai4privacy/pii-masking-openpii-1.5m},
  author = {AI4Privacy},
  year   = {2025},
  url    = {https://huggingface.co/datasets/ai4privacy/pii-masking-openpii-1.5m},
}
```
