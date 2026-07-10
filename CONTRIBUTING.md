# Contributing

## Language boundaries

The repo spans two toolchains, split by what the code does rather than by
preference. Follow the split when adding code.

- **Python (`train/`), run with `uv`.** The model pipeline: fetch, augment,
  tokenize, train, trim, export, the diagnostic probes, and the release glue
  (`publish_hf.py`, `cut_release.py`). This code lives in the PyTorch, optimum,
  onnxruntime, datasets, and huggingface_hub ecosystem, which is Python-native.
- **TypeScript (`src/`, `eval/`), run with `bun`.** The shipped library (an
  npm and browser artifact, loaded through transformers.js) and the evaluations
  that score it. The library cannot be Python: it runs in the browser.
- **Bridge code that must reproduce runtime behavior is TypeScript, even inside
  `train/`.** `train/build-dataset.ts` imports `foldForModel` and the premask from
  `src/`, so the training data is built with the exact normalization the runtime
  applies. Reimplementing that in Python would let training and serving drift, the
  kind of skew that silently degrades detection.

Rule of thumb: producing the model is Python; shipping or exercising it is
TypeScript; anything that must match runtime behavior is TypeScript and imports
from `src/`.

## Before pushing

The pre-push hook (lefthook) runs the same checks as CI: type-check, tests, build,
and a build smoke. Keep test files importing from `vitest` (not `bun:test`), since
CI runs `vitest run`. See `train/BUILD.md` for building the model and cutting a
release.
