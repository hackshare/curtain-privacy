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
  - multilingual
  - browser
datasets:
  - ai4privacy/pii-masking-openpii-1.5m
base_model: microsoft/Multilingual-MiniLM-L12-H384
metrics:
  - char-level-protected-rate
  - public-char-retention
  - span-f1
---

# curtain

`curtain` is an on-device token-classification model that detects personally identifiable information (PII) in text before it leaves the user's device.
It is the model of **curtain-privacy**, a defense-in-depth client-side redaction system, and runs alongside a deterministic recognizer layer that handles structured identifiers; together they form the complete system.

The model is not fetched from a host. It is built locally from the committed training pipeline (`train/`) and loaded by path; see "Reproducibility" for the build.

## Model family: `curtain-small` and `curtain-tiny`

curtain ships in two sizes. They are a genuine tradeoff, not a strict upgrade: pick by footprint and by whether your text is multilingual and conversational.

| | **curtain-small** (default) | **curtain-tiny** |
| --------------------------- | --------------------------------------------- | ---------------------------------------------- |
| Shipped artifact size | 59.9 MB | 14.2 MB |
| Base checkpoint | `microsoft/Multilingual-MiniLM-L12-H384` (12-layer) | `nreimers/MiniLM-L6-H384-uncased` (6-layer) |
| Tokenizer | SentencePiece (XLM-R), cased, accents preserved | WordPiece, lowercased, accents folded (`José`→`jose`) |
| Parameters | ≈65M (21.5M encoder + 43.7M embedding) | ≈18.5M |
| Vocabulary | 113,876 SentencePieces (Latin-script sub-vocab of XLM-R's 250k) | 19,730 WordPieces (trimmed from BERT's 30.5k) |
| 24-language name recall (worst / typical) | 95.9% / 98–100% | 95.4% / 96–99% |
| Leading- and repeated-name recall | 100% | 50% (first name) / 33% (repeated subject) |
| CJK-origin short surnames | 100% | 80% |
| Best for | multilingual and conversational text (repeated and leading names) | smallest footprint; English-heavy or bandwidth-limited use |

**`curtain-small` is the default and the actively developed model.** It re-bases the encoder to a deeper multilingual checkpoint to close the recall leaks `curtain-tiny` has on leading and repeated names and on CJK-origin short surnames (see "The recall-leak fix" under Evaluation). The cost is size: 4× larger, because the encoder doubles from 6 to 12 layers and the embedding carries the full Latin-script sub-vocabulary so held-out names in every supported language tokenize into learned pieces rather than characters. 60 MB is a one-time on-device download and is small next to a client-side LLM, but the jump from 14 MB is deliberate and worth noting for mobile bundle budgets.

**`curtain-tiny` is frozen at `v1.0.0`.** It clears every formal gate (24-language recall ≥95%, the held-out bench, the fairness corpus); its only weakness is the leading/repeated/short-name recall that `curtain-small` fixes. It is kept published for the smallest-footprint tier. Pin it explicitly:

```ts
const guard = await createGuard({ model: "hackshare/curtain-privacy", revision: "v1.0.0" });
```

The runtime library loads either model from the same code path — it detects WordPiece vs SentencePiece from the tokenizer at load time — so switching tiers is only a change of `revision`/`model`, no code change.

The rest of this card documents **`curtain-small`** unless stated otherwise.

The model is distributed at [`hackshare/curtain-privacy`](https://huggingface.co/hackshare/curtain-privacy) on Hugging Face; pin revision `v2.0.0` for `curtain-small` or `v1.0.0` for `curtain-tiny`. Serving files and integration recipes are in [`train/hf_card.md`](train/hf_card.md).

curtain-privacy is a fork of **Rampart** by National Design Studio, inheriting its training recipe, label taxonomy, and base deterministic layer. `curtain-tiny` also inherits Rampart's encoder family (MiniLM-L6); `curtain-small` re-bases the encoder to Multilingual-MiniLM-L12 for multilingual capacity. Neither is Rampart's released weights: curtain trains from public base checkpoints on OpenPII plus targeted augmentation. The numbers below are this model's own, scored end-to-end through the shipped pipeline under a character-level metric (see "Evaluation").

## Model summary (`curtain-small`)

| Property              | Value                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Base checkpoint       | [`microsoft/Multilingual-MiniLM-L12-H384`](https://huggingface.co/microsoft/Multilingual-MiniLM-L12-H384), fine-tuned with a 35-label BIO head (17 entity types) |
| Parameters            | ≈65M (21.5M transformer encoder + 43.7M embedding over the 113,876-piece vocabulary; the embedding is INT8-quantized in the shipped artifact) |
| Quantization          | 4-bit MatMul + INT8 embedding (`onnx/model_q4.onnx`)                                                                            |
| Shipped artifact size | 59.9 MB (`model_q4.onnx` 58,102,914 bytes + `tokenizer.json` 4,722,050 bytes)                                                    |
| Tokenizer             | SentencePiece (Unigram), cased, NFKC; XLM-R's tokenizer trimmed to its Latin-script sub-vocabulary                              |
| Vocabulary            | 113,876 SentencePieces (kept from XLM-R's 250,002 by retaining every Latin-script piece and dropping the non-Latin scripts this model does not serve) |
| Max sequence          | 512 tokens                                                                                                                      |
| Languages             | English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Czech, Slovak, Lithuanian, Latvian, Estonian, Swedish, Danish, Finnish, Hungarian, Romanian, Slovenian, Croatian, Vietnamese, Malay, Indonesian, Tagalog (all Latin-script) |
| Runtime               | ONNX Runtime Web (WASM/WebGPU) via `transformers.js`                                                                            |
| Training data         | OpenPII train split plus curtain-privacy augmentation; see "Training data"                                                       |
| License               | MIT (weights and code); trained on CC BY 4.0 data, see "Training data" and NOTICE                                                |
| Built on              | Rampart (recipe, taxonomy, deterministic layer) by National Design Studio                                                       |

## Intended use

The model is designed for **client-side redaction of user-typed text in AI assistants and intake flows**, replacing identifying values with stable placeholders before any data is transmitted to a model provider, a server, or a logging system.

Try the full redaction round-trip in your browser at [curtain.hackshare.com](https://curtain.hackshare.com), which runs this model client-side alongside a panel showing exactly what a model would receive.

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
| [`ai4privacy/pii-masking-openpii-1.5m`](https://huggingface.co/datasets/ai4privacy/pii-masking-openpii-1.5m) | OpenPII train split              | CC BY 4.0  | Realistic chat-style PII; 24 Latin-script languages (en, es, fr, de, it, pt, nl, pl, cs, sk, lt, lv, et, sv, da, fi, hu, ro, sl, hr, vi, ms, id, tl); the OpenPII schema mapped to our 35-label BIO schema (17 entity types). Disjoint from the 30,000-row held-out eval slice. |
| curtain-privacy augmentation                                                                                 | added on top of the base rows    | CC BY 4.0  | The distribution the public corpus lacks, generated from the OpenPII rows and committed seeds: diverse Latin-script names across many locales, CJK-origin and short-surname coverage, leading- and repeated-subject narratives (a named subject reintroduced across a passage), messy real-world formatting (field-style separators, case and spacing noise), GOVERNMENT_ID variety, and keep-negatives (order/reference codes and city/state left untagged, so the model learns the keep boundary). |

The augmentation is deterministic from a seed and reproducible from the committed generators.

Two components were decisive. The **keep-negatives** stop the added redactable variety from pushing the model into over-redaction: adding them is what lets a model clear both the recall and the retention gates. The **leading/repeated-subject and CJK/short-name augmentation** is what closes the recall leaks that a public-corpus-only fine-tune leaves (see "The recall-leak fix").

### Pre-processing

`curtain-small` uses the XLM-R SentencePiece tokenizer, which is **cased and NFKC-normalized**: it preserves letter case and accents, so `José` stays `José` and `Müller` stays `Müller`. The model sees names as written. The runtime applies the identical NFKC fold before tokenization, so the train-time and inference-time distributions match by construction, and a guard in the pipeline fails the run if a tokenizer change breaks this assumption.

(This is a change from `curtain-tiny`, whose WordPiece tokenizer lowercased and stripped accents — `José`→`jose` — to match BERT's `do_lower_case=True`. The runtime detects which convention a loaded model uses and applies the matching fold.)

The structured classes the deterministic layer owns (`SSN`, `CREDIT_CARD`, `IP_ADDRESS`) are masked to sentinel tokens before tokenization, both at inference (`src/premask.ts`) and during dataset construction, so the model never learns to classify raw card/SSN/IP digits and the train-time and inference-time inputs match by construction.

### Vocabulary

XLM-R's SentencePiece vocabulary contains 250,002 pieces spanning 100 languages. `curtain-small` serves only Latin-script languages, so the shipped vocabulary keeps **every entirely-Latin-script piece** (letters in any Latin range including precomposed diacritics, combining marks, and ASCII) plus the specials and the pieces the training corpus uses, and drops the non-Latin scripts (CJK, Arabic, Cyrillic, Devanagari, and the rest — about 55% of the vocabulary).

Because every Latin piece is kept, tokenization of any Latin text is byte-identical to the full XLM-R tokenizer, so the trim costs no recall; only the embedding table shrinks. The shipped vocabulary is **113,876 pieces**. A frequency-only trim (keeping only corpus-frequent pieces) was rejected: it drops the whole-word pieces for held-out non-English Latin names, which then shatter into single characters at inference and collapse per-language recall (Vietnamese fell to 39% under that approach).

### Training procedure

| Hyperparameter      | Value                                     |
| ------------------- | ----------------------------------------- |
| Base                | microsoft/Multilingual-MiniLM-L12-H384    |
| Tokenizer           | xlm-roberta-base (SentencePiece)          |
| Epochs              | 3                                         |
| Batch size          | 16                                        |
| Learning rate       | 5e-5                                      |
| Weight decay        | 0.01                                      |
| Max sequence length | 512                                       |
| Optimizer           | AdamW                                     |
| Checkpointing       | every 5,000 steps                         |
| Hardware            | Apple M-series MPS                        |

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
All numbers below are `curtain-small` unless a comparison to `curtain-tiny` is shown; both are scored through the same committed harness on the same slices.

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

### The recall-leak fix

`curtain-small` exists to close three recall leaks in `curtain-tiny`, measured on a categorized probe run through the full library at an aggressive operating point. The leaks are on the patterns real chat produces — a first name alone, a subject named once and referred back to, and CJK-origin short surnames:

| Probe category                          | curtain-tiny | curtain-small |
| --------------------------------------- | ------------ | ------------- |
| Leading / first name alone              | 50.0%        | **100%**      |
| Repeated subject across a passage       | 33.3%        | **100%**      |
| CJK-origin short surnames               | 80.0%        | **100%**      |
| Latin full names (control)              | 100%         | 100%          |

The fix holds on names and templates the model never trained on: on an unseen-name generation of the same probe, leading-name and repeated-subject recall are both 100%.

### Held-out OpenPII test set: seven Latin-script languages (30,000 rows, 129,258 private occurrences)

Measured by the committed `eval/bench` harness running the full shipped pipeline end to end
(deterministic layer + model + reconcile layer) over a pinned held-out slice of
`pii-masking-openpii-1.5m`, disjoint from training.

|                                | curtain-small | curtain-tiny |
| ------------------------------ | ------------- | ------------ |
| protected-rate                 | 98.37% (Wilson 95% CI [98.30, 98.43]) | 98.40% |
| char-recall                    | **99.42%**    | 98.78% |
| public char-retention          | 96.71%        | 97.28% |
| undetected private occurrences | **527**       | 1,317  |

`curtain-small` misses about 60% fewer private occurrences (527 vs 1,317) for roughly 0.6 pp more
over-redaction — the recall-first trade this system is tuned for. Keep-misroutes (a kept class
wrongly redacted) are zero for both.

Per-language char-recall on the seven-language slice:

| Language | curtain-small | curtain-tiny |
| --- | --- | --- |
| English (`en`)    | 99.19% | 98.42% |
| German (`de`)     | 99.51% | 98.87% |
| Spanish (`es`)    | 99.35% | 99.53% |
| French (`fr`)     | 99.65% | 99.37% |
| Italian (`it`)    | 99.63% | 97.34% |
| Dutch (`nl`)      | 99.20% | 98.91% |
| Portuguese (`pt`) | 99.57% | 99.60% |

Italian gains the most (97.34% → 99.63%), closing the residual format variants `curtain-tiny` missed.
Public retention is lowest in Dutch (95.57%) and highest in Portuguese (98.15%).

### Person-name recall across all 24 languages

A separate eval measures person-name recall (significant-character coverage) on a pinned
per-language validation sample across all 24 supported languages, through the full library.
Every language reaches at least 95.9%:

| Lang | recall | Lang | recall | Lang | recall | Lang | recall |
| --- | --- | --- | --- | --- | --- | --- | --- |
| en | 100.0% | fr | 100.0% | hr | 100.0% | es | 100.0% |
| sv | 100.0% | da | 99.7% | nl | 99.7% | hu | 99.4% |
| pl | 99.4% | lv | 99.4% | ms | 99.2% | id | 99.1% |
| sl | 99.1% | fi | 99.0% | it | 99.0% | cs | 98.9% |
| et | 98.9% | lt | 98.9% | ro | 98.9% | sk | 98.7% |
| de | 98.6% | pt | 98.5% | tl | 97.3% | vi | 95.9% |

The worst two are Tagalog (97.3%) and Vietnamese (95.9%). Both are down slightly from `curtain-tiny`
(tl 99.2%, vi 96.2%) while 21 of 24 languages improve and the worst-language floor rises from 95.4%
(tiny) to 95.9%. Lithuanian, tiny's weakest at 95.4%, rises to 98.9%.

### Real-world corpus: 157 hand-authored en-US cases

A hand-authored corpus with format-valid fake PII, a normal and a messy tier, and planted keep-set
landmines that must not be redacted:

- **protected-rate 99.28%**
- **keep-violation-rate 2.44%** (under the 3% over-redaction gate)

The over-redactions are precision costs on a recall-first system (state names and order codes read as
identifiers), under the gate.

### Fairness across naming traditions: 300 held-out cases

Diverse Latin-script names drawn from a seed disjoint from the training augmentation, so the model
is scored on names it did not train on:

- **protected-rate 100.00%**
- **keep-violation-rate 0.00%**

The diverse-name augmentation (see "Training data") is what lifts this above a fine-tune that trains
on the public corpus alone.

### Adversarial: 157 obfuscated cases

Every real-world case re-run with single-vector obfuscation (zero-width injection, homoglyph
substitution, spacing noise) applied to the PII:

- **157 of 157 (100%) still fully covered.**

## Calibration

The runtime applies a single recall-biased confidence floor (`minScore` = 0.4) uniformly
across the model's labels, chosen against a held-out OpenPII Latin calibration split
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
model did not train on at 100% protected-rate. The diverse-name augmentation is what closes the
gap a public-corpus-only fine-tune leaves on non-Anglo Latin names.

### Non-Latin scripts (out of scope)

The training data is Latin-script only, so recall on non-Latin scripts (Han, Japanese, Korean,
Arabic, Cyrillic, Devanagari) is low and those scripts are unsupported. The shipped vocabulary also
drops the non-Latin pieces (see "Vocabulary"). The deterministic layer does not catch names (there
is no checksum to validate against), so this surfaces at the system level. Do not deploy this
release for populations who routinely type non-Latin-script names without compensating controls.

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

### Subword fragmentation on long names

Names that tokenize into many subwords (long hyphenated or multi-part names) can lose recall on a
trailing subword. The runtime performs span-merging across same-label adjacencies plus
particle-rescue, and post-detection reconciliation snaps partial spans to word boundaries and
propagates a detected name to its within-message repeats, which closes most of the gap.

## Reproducibility

The code, model weights, deterministic layer, and the training and evaluation harnesses are released under the MIT License. The training data (ai4privacy/OpenPII) is CC BY 4.0 and the Multilingual-MiniLM base checkpoint is MIT; see NOTICE for attributions.

Both the model and the numbers are reproducible from committed code. Evaluation runs the shipped
TypeScript pipeline over a frozen OpenPII held-out slice and writes `summary.json` /
`by_language.json` alongside the output, so every number in this card traces to committed
evidence. The held-out row `uid`s are pinned in a committed manifest (`bun run bench:fetch` to
regenerate, `bun run bench` to reproduce). The model itself rebuilds from the public base
checkpoint: the from-base fine-tune, the augmentation generators (seeded and deterministic), and
the SentencePiece vocab-trim (`train/trim_spm.py`) and quantization export are all committed under
`train/`. See [`train/BUILD.md`](train/BUILD.md) for the step-by-step build.

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
