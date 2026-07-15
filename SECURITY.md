# Security

curtain-privacy redacts PII on the device before text reaches a model or a log. This
document covers its threat model, the guarantees it does and does not make, and how the
model and dependencies are pinned.

## Threat model

The library assumes untrusted user input and a downstream model that may be prompted,
poisoned, or simply wrong. It aims to hold three properties:

- **Detected PII stays on the device.** The PII the system detects is replaced before
  text leaves the device; what leaves is placeholdered text, and the mapping from
  placeholder to real value lives only in the session table and never crosses the wire.
- **The pipeline fails closed.** If detection errors, times out, or the worker crashes,
  `protect` rejects. It never returns unredacted text on failure. A caller that catches
  the rejection and forwards the raw text anyway has opted out of that guarantee.
- **Reveal is not forgeable.** Placeholder tokens carry a per-session secret, so a token
  an attacker guesses or plants cannot be turned back into someone's real value.

## Placeholder tokens carry a session salt

Each session mints a random 48-bit salt and weaves it into every token, so a placeholder
reads `[GIVEN_NAME_1.9f3a2c7b41d0]` rather than the guessable `[GIVEN_NAME_1]`. Two
defenses build on that:

- **Unguessable namespace.** `reveal` restores a value only for a token whose exact salt
  is in the live table. A token from another session, or one an attacker writes by hand,
  resolves to nothing.
- **Inbound neutralization.** `protect` rewrites any placeholder-shaped run in the user's
  text to a full-width-bracket lookalike before the model sees it, so a pasted token can
  never round-trip back into a real value.

Together these close the exfiltration path where an attacker plants `[SSN_1]` in chat or a
retrieved document, the model echoes it, and `reveal` prints the victim's SSN.

**Trust boundary for reveal.** `reveal` restores real PII into text. Run it only on output
you are about to show the same user whose data is in the table, and only on trusted model
output. Do not run `reveal` and then forward the result to another party or tool.

## Input limits

`protect` runs synchronous detection over the whole input, so it caps input length
(`maxInputChars`, default 100,000) and rejects anything larger rather than stalling the
path that gates outbound text. In worker mode, a stalled model load or detection fails
after `workerTimeoutMs` (default 30s) instead of hanging forever, and a worker crash
rejects every in-flight call.

## Input normalization

Before detection, `protect` normalizes a copy of the input: it drops zero-width and invisible characters, folds compatibility, fullwidth, and cross-script confusable forms to ASCII, and regularizes unusual spaces. Spans are projected back to the original text, so redaction removes the user's actual characters and non-PII text is left byte-for-byte unchanged. This raises the bar against casual obfuscation. It is not a defense against a determined attacker composing novel evasions, which stays out of scope.

## Model integrity

The `curtain` model is not fetched from a host. It is built locally from the committed
training pipeline (`train/`): a from-base fine-tune on OpenPII plus augmentation, then vocab
trim and quantization; see [`train/BUILD.md`](train/BUILD.md) for the step-by-step build.
Integrity comes from reproducibility rather than a pinned remote
revision. You control the weights that gate every redaction because you build them.

- **`curtain-small`** (the reference build): `onnx/model_q4.onnx`, 58,102,914 bytes
  SHA-256 `c9bfe8a0a9e3cfbb1a8995009259a5195109c8881f16905ef5be58351ad8786f`
- **`curtain-tiny`** (frozen, `v1.0.0`): `onnx/model_q4.onnx`, 14,874,677 bytes
  SHA-256 `24ba1f03a8c3db8a4f760d4d266faeb679ba23f8c23f7be9ba6964cbfff6f6c1`

To verify a build, hash its `onnx/model_q4.onnx`:

```sh
shasum -a 256 <built-model-dir>/onnx/model_q4.onnx
```

A rebuild from the same committed pipeline and seeds reproduces the model; a build you did
not produce yourself is only as trustworthy as its source, so verify the hash of any model
you load. `createGuard({ model })` takes the path you pass, and you own its provenance.

## Dependencies

The only runtime dependency is `@huggingface/transformers`, a peer dependency pinned to
`>=3.7.5 <4`: the shipped detection numbers are measured against 3.7.5, and 4.x shifts the
model's output below the eval gate. Build and dev dependencies are pinned to exact
versions and refreshed deliberately. `bun audit` runs are reviewed; a dev-only advisory
that cannot reach a library consumer at runtime is tracked but not treated as blocking.

## Reporting a vulnerability

Report suspected vulnerabilities privately to the maintainer rather than opening a public
issue. Include a reproduction and the affected version.
