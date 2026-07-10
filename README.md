# curtain-privacy

curtain-privacy is a client-side PII filter for LLM chat. It removes the names, SSNs, card numbers, and other PII it detects before text leaves the device, keeping only city, state, and ZIP, so most raw PII is stripped on the client instead of reaching a server or log. Each redacted value gets a stable, typed placeholder (`[GIVEN_NAME_1]`, `[SSN_1]`) that persists across the full conversation. When the model replies, one call restores the real values before the user sees anything.

## Install

The package is not on npm yet. Install it from the Git repo; it builds itself on
install through its `prepare` script.

```sh
bun add github:hackshare/curtain-privacy "@huggingface/transformers@^3.7.5"
# or: npm i github:hackshare/curtain-privacy "@huggingface/transformers@^3.7.5"
```

To pin an exact published build, append a release tag, for example
`github:hackshare/curtain-privacy#v1.0.0-<timestamp>`. If your package manager
skips install scripts, run `bun run build` (or `npx tsup`) in the installed package
once to produce `dist/`.

`@huggingface/transformers` is a peer dependency and must be installed alongside the library. Pin it to the 3.x line: the shipped numbers are measured against transformers 3.7.5, and 4.x shifts the model's detection output.

## Quickstart

Build the `curtain` model first (see "The model"), then point `createGuard` at it:

```ts
import { createGuard } from "curtain-privacy";

// createGuard is async: it loads and initializes the classifier from the path you pass
const guard = await createGuard({ model: "./path/to/built/curtain" });

// Redact PII before sending to the model
const { text, placeholders } = await guard.protect(userInput);
const reply = await yourLlm(text);

// Restore real values in the model's response
const restored = guard.reveal(reply);
```

`text` carries placeholders in place of the PII the system detected, so it can be sent to a model endpoint with downstream exposure bounded by what the client removed. `guard.reveal` puts the actual names and numbers back into the model's reply so the user sees their real data, not tokens. For a deterministic-only run without the model, pass `{ heuristicsOnly: true }`.

## The model

The `curtain` model is a 14.2 MB 4-bit ONNX token classifier (MiniLM-L6-H384, 19,730-piece vocab, INT8 embedding) that runs on CPU via transformers.js, in the browser or Node. It is not fetched from a host: you build it from the committed training pipeline in `train/` (a from-base fine-tune on OpenPII plus augmentation, then vocab trim and quantization) and load it by path. See `MODEL_CARD.md` for the numbers and [`train/BUILD.md`](train/BUILD.md) for the step-by-step build.

### Hosted model

The model is also published at [`hackshare/curtain-privacy`](https://huggingface.co/hackshare/curtain-privacy) on Hugging Face. For web and Node, pass the Hugging Face repo id and pin a revision:

```ts
const guard = await createGuard({ model: "hackshare/curtain-privacy", revision: "v1.0.0" });
```

For iOS and Android, fetch these two files from the pinned resolve URL:

- `https://huggingface.co/hackshare/curtain-privacy/resolve/v1.0.0/onnx/model_q4.onnx`
- `https://huggingface.co/hackshare/curtain-privacy/resolve/v1.0.0/tokenizer.json`

The local-build path (above) remains the maximum-integrity option: you control the artifact end to end and can verify its SHA-256 directly. For the hosted path, integrity comes from pinning revision `v1.0.0` and checking the published SHA-256; on web, transformers.js fetches the files internally so the guarantee is revision-pinning plus transport security, not a local hash check. See [`train/hf_card.md`](train/hf_card.md) for the full integration recipes.

## Policy

The default keep-set is city, state, and ZIP. Everything else the classifier or the deterministic recognizers identify as PII is redacted: given names, surnames, phone numbers, email addresses, SSNs, credit card numbers, tax IDs, passport and license numbers, IP addresses, bank account numbers, street names, and building numbers.

Placeholders are stable within a session. If a user's name appears five times in a conversation, it maps to the same token each time and restores correctly from every reply. Each token carries a per-session salt (`[GIVEN_NAME_1.9f3a2c7b41d0]`) so an attacker cannot forge one that `reveal` would turn back into real PII. To customize the keep-set, pass `keepLabels` to `createGuard`.

## Scope and limits

curtain-privacy covers US inputs and 24 Latin-script languages: English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Czech, Slovak, Lithuanian, Latvian, Estonian, Swedish, Danish, Finnish, Hungarian, Romanian, Slovenian, Croatian, Vietnamese, Malay, Indonesian, and Tagalog.

On a frozen 30,000-row slice of OpenPII (the primary benchmark): 98.2% of private occurrences are fully protected and 96.4% of public text is preserved. On a hand-curated real-world eval of 157 cases, the protected rate is 99.8%, and on a 300-case held-out fairness corpus it is 99.4%.

Adversarial caveat: detection normalizes input first, so single-vector obfuscation such as zero-width characters or cross-script homoglyphs is handled, but a motivated user composing novel or layered evasions can still get through. The system is designed to protect users who are entering their own information in good faith from incidental disclosure to downstream services. It's not designed to stop someone actively trying to smuggle PII past the filter.

## Security

Redaction fails closed: if detection errors or the worker crashes, `protect` rejects rather than returning unredacted text. Placeholder tokens carry a per-session salt so `reveal` can't be tricked into restoring PII for a forged or pasted token. The model is built from the committed training pipeline rather than fetched, so integrity comes from a reproducible build with a recorded SHA-256. Run `reveal` only on trusted model output you're about to show the same user. See [SECURITY.md](SECURITY.md) for the full threat model and the reference model hash.

## Further reading

- [SECURITY.md](SECURITY.md)
- [WHITEPAPER.md](WHITEPAPER.md)
- [MODEL_CARD.md](MODEL_CARD.md)
- [License: MIT](LICENSE) (see [NOTICE](NOTICE) for third-party attributions)
