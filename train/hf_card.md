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
---

# curtain-privacy

On-device PII redaction: a 14.2 MB token classifier plus deterministic recognizers
across 24 Latin-script languages, with a reversible-placeholder layer for chat. It
runs in the browser, in Node, and on iOS and Android from these same files. Source,
training pipeline, whitepaper, and the full model card:
https://github.com/hackshare/curtain-privacy

The model is built locally from the committed `train/` pipeline; this repo is a
distribution copy. Verify integrity by pinning a revision and checking the hash:
`onnx/model_q4.onnx` SHA-256
`24ba1f03a8c3db8a4f760d4d266faeb679ba23f8c23f7be9ba6964cbfff6f6c1`.

## Integrating

### Web and Node (transformers.js)

```js
import { createGuard } from "curtain-privacy";

const guard = await createGuard({ model: "hackshare/curtain-privacy", revision: "v1" });
const { text } = await guard.protect("My SSN is 472-81-0094");
```

`revision: "v1"` pins the audited weights. transformers.js fetches from this repo
with permissive CORS, so it works from any origin.

### iOS and Android (ONNX Runtime Mobile)

Fetch or bundle two files from a pinned revision:

- `https://huggingface.co/hackshare/curtain-privacy/resolve/v1/onnx/model_q4.onnx`
- `https://huggingface.co/hackshare/curtain-privacy/resolve/v1/tokenizer.json`

Verify `model_q4.onnx` against the SHA-256 above. Load the model with ONNX Runtime
Mobile, tokenize with the Hugging Face `tokenizers` library (Swift and Kotlin
bindings load `tokenizer.json` directly) or ONNX Runtime Extensions, then apply the
BIO decode and the default keep-set (CITY, STATE, ZIP_CODE) the library documents.
These are integration guides, not a shipped native SDK.
