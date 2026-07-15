# curtain-privacy: On-Device PII Redaction with Strict Measurement and a Hardened Placeholder Layer

## Abstract

curtain-privacy is a client-side system for removing personally identifiable information from user-typed text before it leaves the device. It forks **Rampart**, an in-browser PII redactor, inheriting Rampart's architecture, training recipe, and base deterministic layer, and contributes its own trained models plus the layers around it: a two-model family (curtain-small and curtain-tiny) trained from public base checkpoints on OpenPII with targeted augmentation, a stricter measurement methodology, a deterministic recognizer layer that closes specific classes of leak, an evaluation on hand-authored real-world text, and a security model for the reversible-placeholder layer that makes redaction usable in a chat without opening an exfiltration channel.

The system is scoped to US inputs and the 24 Latin-script languages the models are trained on (English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Czech, Slovak, Lithuanian, Latvian, Estonian, Swedish, Danish, Finnish, Hungarian, Romanian, Slovenian, Croatian, Vietnamese, Malay, Indonesian, Tagalog). curtain ships as a two-model family that shares one pipeline: **curtain-small**, the default and the actively developed model, re-bases the encoder to a 12-layer multilingual checkpoint behind a cased, accent-preserving tokenizer and ships as a 59.9 MB INT8/4-bit ONNX artifact; **curtain-tiny**, frozen at v1.0.0 for the smallest-footprint tier, is a 14.2 MB 4-bit artifact on a 6-layer lowercased encoder. The headline numbers here are curtain-small's, scored end to end through the shipped pipeline. On a frozen 30,000-row held-out slice of the OpenPII 1.5M corpus, disjoint from training, measured under a character-level, occurrence-anchored metric, curtain-small fully protects **98.37%** of private occurrences (Wilson 95% CI [98.30%, 98.43%]) at **96.71%** public-text retention, with **99.42%** significant-character recall, missing about 60% fewer private occurrences than curtain-tiny on the same slice. On a separate 157-case hand-authored en-US corpus scored under the same metric, it fully protects **99.28%** of redactable occurrences while over-redacting **2.44%** of deliberately planted keep-set landmines, under the 3% gate, and on a 300-case held-out diverse-name corpus it protects **100.00%** at **0.00%** over-redaction.

curtain-privacy is harm reduction, not perfect protection. Any privacy system that depends on a trusted server-side environment inherits that environment's risk: once unredacted text leaves the device, to a model provider, a logging pipeline, an analytics SDK, or a future breach, it is exposed to failures beyond the user's control. Redacting on the device bounds the impact of any downstream failure by what the client already removed, because a later component cannot leak what was never sent. No model this small catches every instance of PII, so the system runs at a recall-biased operating point and measures conservatively: it reports what a strict character-level metric shows rather than the higher number a looser metric would produce.

This document describes what curtain-privacy inherits from Rampart and what it adds, the architecture, the measurement methodology and why it differs from the usual one, the evaluation, the security model for the placeholder layer, related work, known limitations, and reproducibility.

## 1. Relationship to Rampart

curtain-privacy began as a fork of Rampart and reuses Rampart's design: the documented training recipe (a 35-label BIO head, a structured-PII premask, a model-space fold), the label taxonomy, the base deterministic recognizers, span repair, and the recall-biased calibration point. The encoder is inherited too, but only for the smaller of the two models curtain now ships: curtain-tiny keeps Rampart's MiniLM-L6-H384 family, while the default curtain-small re-bases the encoder to the deeper multilingual Multilingual-MiniLM-L12-H384 for the capacity to serve 24 languages (§3.2). What curtain-privacy does not reuse is Rampart's model weights. It trains its own models from public base checkpoints on OpenPII plus targeted augmentation (§3.5), so the numbers in this paper are its own models measured through its own pipeline.

The split of responsibility:

| Component | Source |
| --- | --- |
| Training recipe (35-label BIO, structured-PII premask, model-space fold) and label taxonomy, inherited by both models | Rampart |
| Encoder architecture MiniLM-L6-H384 in curtain-tiny | Rampart |
| Encoder re-based to Multilingual-MiniLM-L12-H384 in curtain-small | curtain-privacy |
| Base deterministic recognizers (SSN and credit-card checksums, email/URL/IP patterns) | Rampart |
| Span repair (adjacency merge, bridge-and-merge, capitalized-particle rescue) | Rampart |
| The recall-biased 0.4 confidence-floor calibration point | Rampart |
| The trained model: from-base fine-tune on OpenPII plus diverse-name / messy / GOVERNMENT_ID / keep-negative augmentation, vocab-trimmed and quantized | curtain-privacy |
| Character-level, occurrence-anchored leak metric and three-cause taxonomy | curtain-privacy |
| Fiscal-ID span extension, monotonic byte-union merge, Unicode-complete email/URL, NANP phone recognizer, driver's-license pattern, context-cued government-ID recognizer | curtain-privacy |
| Per-label thresholds and the aggressive/balanced/conservative operating-point knob | curtain-privacy |
| Real-world 157-case and held-out fairness evaluations | curtain-privacy |
| Security model for the placeholder layer (salted tokens, inbound neutralization, fail-closed, pinned model) | curtain-privacy |
| Library packaging and the CI regression gate | curtain-privacy |

Rampart's own methodology and results are documented in its model card and whitepaper. Where this paper refers to a Rampart number it labels it as Rampart's measurement rather than restating it as a result of this work.

## 2. Design goals

The system inherits Rampart's constraints and adds one.

1. **Local-first privacy as harm reduction.** Personal information is removed before it reaches application infrastructure. Data a server never receives cannot be leaked by a model provider, a logging system, an analytics pipeline, a third-party SDK, or a future compromise of the application's own backend.
2. **Browser-deployable.** The shipped model must fit on a low-end phone, so the family offers two footprints. curtain-tiny is a 14.2 MB artifact on the wire, under most modern PII NER models, including GLiNER (around 50 MB) and DistilBERT-based detectors (around 64 MB). curtain-small trades footprint for multilingual recall at 59.9 MB, comparable to GLiNER in size but delivering the full 24-language system; it is a one-time on-device download, small next to a client-side LLM, and the jump from 14 MB is a deliberate cost worth noting for mobile bundle budgets.
3. **Recall-biased.** A miss leaks data, so the default policy redacts whenever a detector fires above its threshold. Over-redaction has a real cost too: an assistant that cannot see context is less helpful. That cost is smaller than a leak, so the system pays it.
4. **Domain-aware retention.** Useful assistants often need rough context such as coarse geography. The keep-set (`{CITY, STATE, ZIP_CODE}`) is policy-driven, so applications can move the privacy/utility boundary without retraining. The precise street line is redacted.
5. **A placeholder layer that cannot be turned against the user.** Redaction replaces each value with a stable placeholder so the assistant can still reason about the conversation, and reveal puts the real value back before display. That reversibility is a security surface: if placeholders are predictable, an attacker can plant one and have the model echo it back into real PII. curtain-privacy treats the placeholder layer as an attack surface and hardens it (§7).

## 3. Architecture

curtain-privacy ships as two cooperating layers that run in parallel and merge their spans, then a policy and a session-table stage. The training recipe and the span-repair layer follow Rampart; the encoder follows Rampart's MiniLM-L6 in curtain-tiny and re-bases to Multilingual-MiniLM-L12 in curtain-small; the trained models, the recognizer additions, the merge, the premask, and the salted session table are this work's.

### 3.1 The deterministic recognizer layer

Structured PII is faster and more reliable to validate than to learn. The deterministic layer is a set of regular expressions paired with checksum and structural validators, and it is the system of record for the classes it owns. Rampart's layer owns SSN and credit-card numbers (checksum-validated) and email, URL, and IP addresses (pattern-matched).

curtain-privacy extends this layer to close leaks the character-level metric (§5) surfaced, and adds a driver's-license pattern the base layer left to the model:

- **Fiscal-ID span extension.** Formatted national fiscal codes often left significant characters exposed at a span boundary even after the model or a validator fired. `extendSpans` grows a detected structured-ID span (SSN, tax ID, credit card, government ID, passport, driver's license, bank account, routing number) across adjacent connector characters and trims trailing punctuation, never shrinking. It only grows spans that already overlap a detected ID and stops at whitespace, so the privacy gain comes at negligible retention cost.
- **Monotonic byte-union merge.** When a redact-class and a keep-class span overlap, `mergeSpans` takes the byte-union under the redact label, so a keep-class span can never carve a hole in a redacted one. This default-deny merge restores the invariant that the union of redact spans only grows, which removed the fiscal-ID boundary leaks that survived span extension: SSN boundary leaks fell from 317 to 205 occurrences and credit-card boundary leaks from 33 to 10 on the frozen slice.
- **Unicode-complete email and URL.** The email and URL patterns match `\p{L}` and `\p{N}` under the `u` flag, so accented local parts and hostnames (for example `mémoichon@…`, `www.café.fr`) are captured whole and masked before the model sees them. The earlier ASCII-only class clipped the address at the first non-ASCII byte and left the tail exposed; this cut email boundary leaks from 245 to 52 occurrences.
- **NANP phone recognizer.** A conservative North American Numbering Plan recognizer matches a formatted 10-digit phone number with an area and exchange first digit in `[2-9]` and a required separator. Because it matches only the NANP core of a longer international or extension number, masking it would blind the model to the remainder, so it is not premasked: it is an additive redaction span merged with the model's view. Its measured effect on the frozen slice is negligible (the model already catches phones), but it gives the system deterministic ownership of a class and a backstop for phones the model misses.
- **Context-cued government-ID recognizer.** Custom-prefixed agency and employee identifiers (`EMP-334455`, `NIN-998877`, `GV9876543`) carry no checksum and no standard structure, so the model, trained on no fixed prefix vocabulary, misses many of them. They also share their shape with order and reference codes that must not be redacted (`#ORD-8821045`, `ref:WIRE-20260502`), so a shape-only recognizer would trade a leak for over-redaction. The recognizer discriminates on two signals that separate the two in practice: order codes carry a leading `#`, and a genuine identifier sits next to an identity cue ("government ID", "emp id", "staff badge"). A candidate is redacted only when it is not `#`-prefixed and a cue appears in the short window just before it, and the window never reaches past a prior candidate so one code's cue cannot bleed onto the next. Like the phone recognizer, it is additive rather than premasked, because the model was never trained behind a `[GOVERNMENT_ID]` sentinel for these prefixes.

### 3.2 The token-classification model

The contextual layer is a transformer encoder with a token-classification head, trained by this work (§3.5), that catches the unstructured, context-dependent classes the deterministic layer cannot: given names, surnames, street names, building numbers, cities, states, and the other free-text entities. It ships in two sizes:

| | curtain-small (default) | curtain-tiny |
| --- | --- | --- |
| Base checkpoint | Multilingual-MiniLM-L12-H384 (12-layer) | MiniLM-L6-H384-uncased (6-layer) |
| Parameters | ≈65M (21.5M encoder + 43.7M embedding) | ≈18.5M |
| Tokenizer | SentencePiece (XLM-R), cased, NFKC | WordPiece, lowercased, accent-stripped |
| Vocabulary | 113,876 SentencePieces | 19,730 WordPieces |
| Shipped artifact | 59.9 MB | 14.2 MB |

Both export to 4-bit MatMul plus an INT8-quantized embedding table and run on the device through transformers.js, on WebGPU or WASM in the browser and on CPU under Node. curtain-tiny cold-loads in about 330 ms with median inference about 4.6 ms per turn on CPU; curtain-small, with twice the encoder depth and the larger embedding, is correspondingly heavier on the same code path. The runtime detects WordPiece versus SentencePiece from the tokenizer at load time, so switching tiers changes only the loaded model, not the calling code.

### 3.3 Premask, merge, and policy

Before the model runs, the deterministic layer's structured detections are replaced with neutral sentinels (`[SSN]`, `[CREDIT_CARD]`, and so on) so the model classifies text distributed the way its training data was, and never sees raw card or SSN digits. A per-character offset map projects any span the model reports in masked coordinates back to exact raw offsets. The phone recognizer is excluded from premasking for the reason given above.

The two layers' spans are merged by the monotonic byte-union rule (§3.1), then filtered by a default-deny policy: everything a detector labels as PII is redacted except the keep-set `{CITY, STATE, ZIP_CODE}`. The operating-point knob (§6.3) scales the model's per-label thresholds without retraining.

### 3.4 The session table

Blanket `[REDACTED]` makes an assistant's replies useless, so each redacted value is replaced with a stable, typed placeholder that survives across turns: the same value always maps to the same token, so the model can reason about "the given name" and curtain-privacy restores the real value in the reply before display. The map lives only on the device; what leaves is placeholdered text. The placeholder scheme is a security surface, described in §7.

### 3.5 Training the model

Each model is fine-tuned from a public base checkpoint with a 35-label BIO head, following Rampart's documented recipe: the structured classes (SSN, credit card, IP address) are premasked to sentinels during dataset construction so training and inference see the same distribution; text is folded to the model's own model space; dates, ages, and income map to non-PII; and the keep-set is `{CITY, STATE, ZIP_CODE}`. The model-space fold differs between the two models: curtain-tiny fine-tunes `nreimers/MiniLM-L6-H384-uncased` behind a WordPiece tokenizer that lowercases and strips accents (`José` becomes `jose`), matching BERT's `do_lower_case=True`; curtain-small fine-tunes `microsoft/Multilingual-MiniLM-L12-H384` behind XLM-R's SentencePiece tokenizer, which is cased and NFKC-normalized, so `José` stays `José` and `Müller` stays `Müller` and the model sees names as written. The runtime applies the matching fold at inference from the tokenizer it loads, so the train-time and inference-time distributions match by construction for either model, and a guard in the pipeline fails the run if a tokenizer change breaks that assumption.

The training data is about 150,000 rows drawn from the OpenPII train split, disjoint by construction from the frozen 30,000-row eval slice, plus targeted augmentation that reproduces the distribution the public corpus lacks. The augmentation adds diverse Latin-script names (drawn across many locales), CJK-origin and short-surname coverage, leading- and repeated-subject narratives (a named subject introduced once and referred back to across a passage), messy real-world formatting (field-style separators, case and spacing noise), GOVERNMENT_ID variety (custom-prefixed identifiers next to identity cues), and keep-negatives: order and reference codes and city/state values left untagged, so the model learns the keep boundary rather than over-generalizing. Two components are decisive. The keep-negatives hold retention: recall-focused augmentation alone closed the real-world detection gap but shifted the model toward over-redaction, and only after the keep-negatives were added did a model clear both the recall and the retention gates. The leading/repeated-subject and CJK/short-name augmentation holds recall: it is what closes the leaks curtain-small was built to fix (§5.1).

Every candidate is scored end to end through the shipped TypeScript pipeline on all three evals, never trusted from a training loss curve. The winning checkpoint is vocab-trimmed and exported to 4-bit MatMul plus INT8 embedding (§3.2). curtain-tiny trims BERT's roughly 30,500-piece WordPiece vocabulary to 19,730 pieces; curtain-small keeps every entirely-Latin-script piece of XLM-R's 250,002-piece SentencePiece vocabulary, 113,876 in all, so held-out non-English names tokenize into learned whole-word pieces rather than shattering into characters (a frequency-only trim collapsed Vietnamese recall and was rejected). The quantization is near lossless: on every gate the quantized artifact tracks its full-precision export closely.

## 4. A strict metric

Rampart reports **term presence**: a private term counts as protected if the gold string no longer appears in the output. That is the standard PII-benchmark metric, and Rampart's 98.42% term-presence recall on the 30,000-row test is measured under it. Term presence has a blind spot: a span that covers most of a value but leaves a few characters exposed still counts as fully protected, because the exact gold string is gone. A partially redacted credit card can leak its last four digits and still score as a success.

curtain-privacy scores at the **character level, anchored per occurrence**. Each significant (alphanumeric) character of a gold occurrence is scored as covered by a redaction span or not, and an occurrence counts as fully protected only when every significant character falls under a span. Two numbers follow:

- **char-recall**: the weighted fraction of significant private characters covered by any redaction span.
- **protected-rate**: the fraction of private occurrences that are fully protected, reported with a Wilson 95% confidence interval.

This is strictly harder than term presence, and it is the number curtain-privacy headlines because it does not credit a boundary leak as a save. The metric change is why the recognizer work in §3.1 exists: the character-level view made under-covered spans visible as a distinct, fixable failure.

Leaks are attributed to one of three causes, which is how the recognizer work was prioritized:

- **undetected**: no detection overlapped the occurrence at all.
- **keep_misroute**: the occurrence was detected but routed to the keep-set by policy.
- **under_cover**: the occurrence was detected and redacted, but the span left significant characters exposed.

Because the two metrics are defined differently, the character-level numbers here are not comparable to Rampart's term-presence numbers or to the usual PII-benchmark figures.

## 5. Evaluation

### 5.1 Frozen OpenPII slice

The primary benchmark runs the shipped pipeline end to end over a frozen 30,000-row held-out slice of OpenPII (129,258 private occurrences), disjoint from the training data, across the seven Latin-script languages in the held-out slice, and writes the per-run manifest the numbers cite. Both models are scored through the same harness on the same slice. Under the character-level metric, curtain-small (the default) reaches:

- **protected-rate 98.37%**, Wilson 95% CI [98.30%, 98.43%]
- **char-recall 99.42%**
- **public char-retention 96.71%**

Against curtain-tiny on the same slice:

| | curtain-small | curtain-tiny |
| --- | --- | --- |
| protected-rate | 98.37% | 98.40% |
| char-recall | 99.42% | 98.78% |
| public char-retention | 96.71% | 97.28% |
| undetected private occurrences | 527 | 1,317 |

curtain-small holds curtain-tiny's protected-rate while missing about 60% fewer private occurrences (527 versus 1,317) and lifting char-recall by 0.64 percentage points, for roughly 0.6 percentage points more over-redaction. That is the recall-first trade this system is tuned for: the extra encoder depth and the full Latin-script vocabulary buy recall on the hard cases at a small retention cost. Keep-misroutes (a kept class wrongly redacted) are zero for both.

**The recall leaks curtain-small closes.** The aggregate protected-rate is flat between the two models, so the case for curtain-small is in the categories curtain-tiny leaks on, measured on a categorized probe run through the full library at an aggressive operating point. These are the patterns real chat produces: a first name alone, a subject named once and referred back to, and CJK-origin short surnames.

| probe category | curtain-tiny | curtain-small |
| --- | --- | --- |
| leading / first name alone | 50.0% | 100% |
| repeated subject across a passage | 33.3% | 100% |
| CJK-origin short surnames | 80.0% | 100% |
| Latin full names (control) | 100% | 100% |

The fix holds on names and templates the model never trained on: on an unseen-name generation of the same probe, leading-name and repeated-subject recall are both 100%. The leading/repeated-subject and CJK/short-name augmentation (§3.5) is what closes these, the recall counterpart to the keep-negatives that hold retention.

Per-language char-recall on the seven-language slice shows where the residual risk sits:

| language | curtain-small | curtain-tiny |
| --- | --- | --- |
| English | 99.19% | 98.42% |
| German | 99.51% | 98.87% |
| Spanish | 99.35% | 99.53% |
| French | 99.65% | 99.37% |
| Italian | 99.63% | 97.34% |
| Dutch | 99.20% | 98.91% |
| Portuguese | 99.57% | 99.60% |

Italian gains the most (97.34% to 99.63%), closing the residual SSN and credit-card format variants curtain-tiny missed. Public retention is lowest in Dutch (95.57%) and highest in Portuguese (98.15%).

**Person-name recall across all 24 languages.** A separate eval measures person-name recall (significant-character coverage) on a pinned per-language validation sample across all 24 supported languages, through the full library. Every language reaches at least 95.9%. The worst two are Tagalog (97.3%) and Vietnamese (95.9%); English, French, Spanish, Croatian, and Swedish reach 100%. Both Tagalog and Vietnamese are down slightly from curtain-tiny (99.2% and 96.2%) while 21 of 24 languages improve and the worst-language floor rises from 95.4% (curtain-tiny, Lithuanian) to 95.9%; Lithuanian itself rises to 98.9%.

The over-redaction gate on this slice is a 0.2-percentage-point budget: a change to the pipeline that lifts recall must not cost more than that in retention. The leak-closing deterministic-layer work (the fiscal-ID extension and the monotonic merge) was developed against this budget and stayed inside it.

### 5.2 Real-world corpus

OpenPII conversations are clean and well-formed, which flatters any redactor. curtain-privacy adds a 157-case hand-authored en-US corpus with format-valid but fake PII, split into a normal tier and a messy tier (typos, unusual spacing, mixed formatting), and deliberately planted keep-set landmines (geographic terms and numeric-looking order codes that should not be redacted). It is scored under the same character-level metric. curtain-small:

- **protected-rate 99.28%**
- **keep-violation-rate 2.44%** (under the 3% over-redaction gate)

The custom-prefixed government identifiers the base public corpus never taught are caught: the GOVERNMENT_ID augmentation (§3.5) and the context-cued recognizer (§3.1) cover them from two directions. The remaining exposure is over-redaction: a handful of keep-set landmines that the model or the recognizers grabbed, where state names and order codes read as identifiers on a recall-first system. They sit under the 3% over-redaction gate.

Re-running all 157 cases with single-vector obfuscation (zero-width injection, homoglyph substitution, spacing noise) applied to the PII leaves 157 of 157 still fully covered.

A third, held-out corpus measures fairness across naming traditions: 300 cases built from diverse Latin-script names drawn from a seed disjoint from the training augmentation, so the model is scored on names it did not train on. On it curtain-small protects **100.00%** of names at **0.00%** over-redaction, above the base public-corpus retrain that lacks diverse-name augmentation.

### 5.3 Operating point

The runtime applies a recall-biased confidence floor (0.4), the calibration point inherited from Rampart's recipe. curtain-privacy adds a per-label threshold resolver and an operating-point knob with `aggressive`, `balanced`, and `conservative` settings (scaling factors 0.6, 1.0, 1.6). `balanced` is the shipped default and the operating point for every number above. The knob is a recall/retention dial applied without retraining: raising the threshold trades recall for retention. Its dominant effect is on recall; on this model, moving from balanced toward conservative dropped recall by more than it recovered in retention, which is why the retention gate was cleared by the model itself (through keep-negative augmentation and vocabulary trimming) rather than by the knob.

## 6. Security model

Reversible placeholders are a convenience and an attack surface. `protect` replaces each detected value with a typed token and records the mapping in a per-conversation table; `reveal` scans the model's reply for those tokens and restores the real values before the user sees them. If the tokens are predictable, that restore step becomes an exfiltration primitive: an attacker who writes `[SSN_1]` into a chat, or plants it in a document the model later quotes, can have `reveal` turn it into the victim's real SSN, which an agentic pipeline might then forward off the device.

curtain-privacy closes this and hardens the surrounding pipeline.

- **Unforgeable tokens.** Each session mints a random 48-bit salt woven into every token, so a placeholder reads `[GIVEN_NAME_1.9f3a2c7b41d0]` rather than the guessable `[GIVEN_NAME_1]`. `reveal` restores a value only for a token whose exact salt is in the live table, so a token from another session, or one an attacker writes by hand, resolves to nothing. `reset` re-mints the salt at a conversation boundary, so a stale token from a prior conversation goes inert.
- **Inbound neutralization.** `protect` rewrites any placeholder-shaped run in the user's own text to a full-width-bracket lookalike before the model sees it, length-preserving so detection offsets are unchanged, so a token a user pastes cannot round-trip back into a real value.
- **Fail-closed.** If detection errors, times out, or the inference worker crashes, `protect` rejects rather than returning unredacted text. A worker crash rejects every in-flight call.
- **Bounded work.** Input over a configurable cap (default 100,000 characters) is rejected before any pass touches it, and in worker mode a stalled load or detection fails after a timeout instead of hanging. The streaming reveal caps its held buffer so an unclosed-token flood stays linear rather than quadratic.
- **Reproducible model with recorded integrity.** The model is not fetched from a host; it is built from the committed training pipeline, and its ONNX SHA-256 is recorded, so integrity comes from a reproducible build a deployer can verify rather than trust in a remote artifact that could be swapped.

The trust boundary is explicit: `reveal` restores real PII, so it is run only on trusted model output about to be shown to the same user whose data is in the table, never on text forwarded to another party. This surface is not covered by Rampart's paper.

## 7. Related work

**Rampart** is the direct antecedent, the project this one forks, and the source of the architecture, recipe, and base layers. Its whitepaper compares Rampart against a community BERT-small detector, Microsoft Presidio with spaCy, GLiNER small v2.1, and AWS Bedrock Guardrails on an English and Spanish slice, where the open baselines trailed on retention (GLiNER and BERT-small kept around 33.5% of public context) and are Python- or cloud-only, so they cannot run in the shipped TypeScript form factor. curtain-privacy inherits that comparison and adds its own trained model, a stricter metric, and a security model.

**OpenAI Privacy Filter** is the closest peer in design intent: an open-weight token classifier under Apache 2.0 with BIOES span decoding, eight detection categories, and a reported F1 of 97.4% on the corrected `pii-masking-300k` benchmark. It is a strong choice for an application with a server it trusts and documents that justify a round-trip. It is a 1.5B-parameter model (50M active, MoE-style), two orders of magnitude beyond a browser-deployment budget, and its inference shape is built for server-side throughput on long documents rather than sub-10 ms client-side redaction during a chat turn. The two systems solve an overlapping problem under different deployment constraints.

**Generative anonymizers** such as `ai4privacy/llama-ai4privacy-english-anonymiser-openpii` are high quality on their native distribution but multiple gigabytes in size and hundreds of milliseconds to seconds per turn, so they are not client-deployable, and running them on a server reintroduces the threat-model problem. A generative model also rewrites text rather than emitting spans, which makes calibration, span F1, and policy-driven keep-sets harder to define and audit than a token classifier with a deterministic post-processing layer.

The **ai4privacy / OpenPII** corpus is the dataset lineage shared across most of this space, and the corpus curtain-privacy trains on.

## 8. Limitations

1. **Cross-locale name fairness.** The training data is Latin-script only, so recall on non-Latin scripts (Han, Arabic, Cyrillic, and others) is low and those scripts are out of scope. The system is scoped to US inputs and the 24 Latin-script languages it trains on. Extending coverage is a matter of adding non-Latin training data and a matching eval, which this release does not include.
2. **Adversarial robustness.** Detection runs on a normalized view of the input: zero-width and invisible characters are removed, compatibility and fullwidth forms and cross-script homoglyphs are folded to their ASCII skeleton, and unusual spaces are regularized. This closes single-vector obfuscation such as zero-width characters between the digits of an SSN or a Cyrillic lookalike inside an email. It does not make the system attacker-proof: a motivated user composing novel or layered evasions can still get through, and the normalization is a detection lens only, so the user's non-PII text is preserved unchanged. The system remains designed for good-faith users, not for stopping someone who is actively trying to smuggle PII past the filter.
3. **Government-style identifiers.** Custom-prefixed identifiers with no checksum and no standard structure are covered from two directions: the model now trains on GOVERNMENT_ID augmentation, and the context-cued recognizer (§3.1) backs it up. Together they reach every such identifier on the real-world corpus. The recognizer still leans on an identity cue near the code, so a genuine identifier stated with no cue and in a format the model also misses could slip through; the training augmentation reduces that surface but does not prove it closed.
4. **Indirect identifiers.** Inferential leaks, such as a rare condition combined with a ZIP code, are out of scope. The system redacts terms, not statistical fingerprints.
5. **The reveal trust boundary.** The salted placeholder layer stops a forged or pasted token from being revealed, but reveal still restores real PII by design, so an integrator who runs it on untrusted output or forwards the result defeats the guarantee. §6 states the boundary.

## 9. Reproducibility

Every quantitative claim traces to committed evidence produced by the artifact itself. The frozen OpenPII benchmark runs the shipped TypeScript pipeline over a pinned held-out slice and writes the per-run manifest the §5.1 numbers cite. The 157-case real-world corpus, the 300-case fairness corpus, and their scorers are committed, and the CI regression gate runs the real-world eval on every change and fails the build if protected-rate drops below 0.97 or keep-violation rises above 0.03, so the headline real-world numbers cannot silently regress. The training pipeline is committed as well: the from-base fine-tune, the augmentation generators, and the vocab-trim and quantization export, so each model is rebuilt from its public base checkpoint and OpenPII rather than taken on trust. Neither model is hosted; a deployer builds it locally and loads it by path, and each model's ONNX SHA-256 is recorded so any build can be verified against the reference. The library, deterministic layer, training and eval harnesses, model weights, and this document are released under the MIT License. The training data it uses (ai4privacy/OpenPII) is CC BY 4.0 and both MiniLM base checkpoints are MIT; see NOTICE for attributions.

## 10. Conclusion

curtain-privacy trains browser-deployable models, a 59.9 MB flagship and a 14.2 MB smallest-footprint tier, and builds a more strictly measured and more defensible system around them. The measurement change is the core of the contribution: a character-level, occurrence-anchored metric does not credit a boundary leak as a save, and scoring against it made a class of under-covered spans visible and fixable, which the recognizer and training work then closed. The security model treats the reversible-placeholder layer as the attack surface it is, so redaction stays usable in a chat without becoming an exfiltration channel.

The worst case for a downstream leak is bounded by what the client failed to redact, not by the entire raw conversation. The constraints adopted here, browser-deployable size, recall-biased calibration, defense in depth, and no network dependency at inference, are specific to the threat model in which the user's unredacted text must never leave the device. Under that threat model, this is a deployable system with an auditable floor. The next round of work is coverage the training data does not yet reach, non-Latin scripts first.

## Acknowledgments

This work is a fork of **Rampart** by National Design Studio, whose encoder architecture, training recipe, base deterministic layer, span repair, and calibration it inherits. It uses the **ai4privacy / OpenPII** corpus for training and evaluation. The **OpenAI Privacy Filter** and the other systems in §7 informed the design comparison. Released under the MIT License; see NOTICE for third-party attributions.
