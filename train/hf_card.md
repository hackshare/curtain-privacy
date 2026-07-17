---
license: mit
library_name: transformers.js
pipeline_tag: token-classification
tags:
  - pii
  - pii-redaction
  - privacy
  - named-entity-recognition
  - on-device
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
---

# curtain-privacy

On-device PII redaction: a token classifier plus deterministic recognizers across
24 Latin-script languages, with a reversible-placeholder layer for chat. It runs in
the browser, in Node, and on iOS and Android from these same files. Source, training
pipeline, whitepaper, and the full model card:
https://github.com/hackshare/curtain-privacy

This repo ships in two sizes, selected by revision:

- **`curtain-small`** — `v2.1.0`, 59.9 MB, 12-layer Multilingual-MiniLM with a
  SentencePiece tokenizer. The default: best multilingual and repeated/leading-name
  recall. `onnx/model_q4.onnx` SHA-256
  `7b44776ee72b34163a26a5fffe717612d805554a6f92302255f7bac874756c2a`.
- **`curtain-tiny`** — `v1.0.0`, 14.2 MB, 6-layer MiniLM with a WordPiece tokenizer.
  The smallest-footprint tier, frozen. `onnx/model_q4.onnx` SHA-256
  `24ba1f03a8c3db8a4f760d4d266faeb679ba23f8c23f7be9ba6964cbfff6f6c1`.

The models are built locally from the committed `train/` pipeline; this repo is a
distribution copy. Verify integrity by pinning a revision and checking the hash above.

## Integrating

### Web and Node (transformers.js)

```js
import { createGuard } from "curtain-privacy";

const guard = await createGuard({ model: "hackshare/curtain-privacy", revision: "v2.1.0" });
const { text } = await guard.protect("My SSN is 472-81-0094");
```

`revision: "v2.1.0"` pins the audited `curtain-small` weights (use `v1.0.0` for
`curtain-tiny`). transformers.js fetches from this repo with permissive CORS, so it
works from any origin. `v2.1.0` is a moving pointer to the latest `curtain-small`
build; to pin an immutable artifact, use the timestamped tag `v2.1.0-<timestamp>`
published alongside each release.

### iOS and Android (ONNX Runtime Mobile)

Fetch or bundle two files from a pinned revision (`curtain-small` shown; use `v1.0.0`
for `curtain-tiny`):

- `https://huggingface.co/hackshare/curtain-privacy/resolve/v2.1.0/onnx/model_q4.onnx`
- `https://huggingface.co/hackshare/curtain-privacy/resolve/v2.1.0/tokenizer.json`

Verify `model_q4.onnx` against the SHA-256 above. Load the model with ONNX Runtime
Mobile, tokenize with the Hugging Face `tokenizers` library (Swift and Kotlin
bindings load `tokenizer.json` directly) or ONNX Runtime Extensions, then apply the
BIO decode and the default keep-set (CITY, STATE, ZIP_CODE) the library documents.
These are integration guides, not a shipped native SDK.
