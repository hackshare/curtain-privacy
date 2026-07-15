# Building the `curtain` model

The `curtain` model is built locally from this `train/` pipeline and loaded by
path. It is not fetched from a host. This runbook has two paths:

- **Quickstart** produces a working model (about 52 MB) with the shortest chain.
  Use it to confirm the pipeline runs end to end and to get a model you can load.
- **Ship** adds augmentation, a vocabulary trim, and embedding quantization to
  produce a gate-passing artifact. It builds curtain-small (the ~60 MB flagship,
  on Multilingual-MiniLM-L12 with a SentencePiece tokenizer); a note at the end
  builds curtain-tiny (the 14.2 MB smaller tier, on MiniLM-L6 with WordPiece).

Both paths share the setup below. Every step lists its command, what to expect,
and a rough time so a wrong step surfaces early.

## Prerequisites

- **uv** (Python package manager):
  ```sh
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```
- **Python deps** (torch, transformers, optimum, onnxruntime, faker; Python >=3.11):
  ```sh
  cd train && uv sync
  ```
- **bun and the TypeScript deps** (for `build-dataset.ts` and the evals), from the repo root:
  ```sh
  bun install
  ```
- **Hardware:** training auto-detects Apple-Silicon MPS or a CUDA GPU. CPU works
  but is slow. On MPS, a 3-epoch run takes roughly 1 to 3 hours depending on the
  dataset size and the machine.

Paths below assume you run each command from the directory shown in its `cd`.

## Part A: Quickstart (working model, about 52 MB)

**1. Fetch a training slice** from the OpenPII train split (disjoint from the
validation split the evals use, so no de-duplication is needed).

```sh
cd train
uv run python fetch_hf.py --split train --n 150000 --seed 7 --out data/trainsplit-raw.jsonl
```
Expected: `done: 150000 Latin rows from 'train' -> data/trainsplit-raw.jsonl`. Time: about 5 to 10 minutes.

Validate the fetch before spending compute on it:
```sh
wc -l data/trainsplit-raw.jsonl   # about 150000
head -1 data/trainsplit-raw.jsonl | python3 -c "import sys,json; print(sorted(json.loads(sys.stdin.readline()).keys()))"
# ['language', 'privacy_mask', 'source_text', 'uid']
```

**2. Build the training rows** (label-map to the taxonomy, structured-PII
premask, model-space fold), from the repo root:

```sh
cd ..
bun train/build-dataset.ts --in train/data/trainsplit-raw.jsonl --out train/data/train.jsonl
```
Expected: `Wrote 150000 examples (... with spans) -> train/data/train.jsonl`. Time: a few minutes.

**3. Tokenize** into BIO token labels:

```sh
cd train
uv run python prepare.py --in data/train.jsonl --out runs/tok-full
```
Expected: `Saved 150000 rows -> runs/tok-full`. Time: a few minutes.

**4. Train** for 3 epochs:

```sh
uv run python train.py --data runs/tok-full --out runs/ckpt-full --epochs 3
```
Expected: a decreasing train loss ending near 0.13, and the final model written
to `runs/ckpt-full/`. Time: about 1 to 3 hours on MPS.

**5. Export** to the on-device artifact shape:

```sh
uv run python export.py --ckpt runs/ckpt-full --out runs/model-quickstart
```
Expected: `runs/model-quickstart/` containing `onnx/model_q4.onnx`, `config.json`,
and the tokenizer files, about 52 MB total. Time: about 5 to 10 minutes.

This is a working model. It is larger than the shipped one because it keeps the
full vocabulary and an fp32 embedding table. To shrink it to the shipped size,
follow Part B. To load it now, jump to "Verify and load".

## Part B: Ship model (curtain-small, ~60 MB, gate-passing)

The ship model adds augmentation, a vocabulary trim, and embedding quantization.
curtain-small fine-tunes the 12-layer `Multilingual-MiniLM-L12-H384` with the
XLM-R SentencePiece tokenizer. Start from the same fetched slice as Part A step 1
(`data/trainsplit-raw.jsonl`).

**1. Generate the augmentation set** (diverse Latin names, romanized-CJK and short
names added on top, leading-subject narratives, messy formatting, synthesized
government IDs, and keep-class negatives):

```sh
cd train
uv run python -m augment.build_augmentation \
  --base data/trainsplit-raw.jsonl --out data/aug.jsonl \
  --seed 1 --name-frac 0.6 --messy-frac 0.4 \
  --n-govid 4000 --n-neg 18000 --n-narrative 10000 --n-cjk 40000
```
Expected: `wrote <about 222000> augmentation rows -> data/aug.jsonl`. Time: a few minutes.

**2. Combine** the base rows and the augmentation into one training set. The
augmentation file is in the same raw schema as the fetch, so a concatenation is
all that is needed:

```sh
cat data/trainsplit-raw.jsonl data/aug.jsonl > data/small-raw.jsonl
wc -l data/small-raw.jsonl   # about 372000
```

**3. Build and tokenize** the combined set. Tokenize against the XLM-R
SentencePiece vocabulary (the multilingual base's tokenizer), not the default
WordPiece one:

```sh
cd ..
bun train/build-dataset.ts --in train/data/small-raw.jsonl --out train/data/small.jsonl
cd train
uv run python prepare.py --in data/small.jsonl --out runs/tok-small --tokenizer xlm-roberta-base
```

**4. Train** for 3 epochs on the multilingual base. `--no-eval` saves a step
checkpoint every 5,000 steps so an idle-sleep cannot lose the run; `caffeinate`
keeps the Mac awake:

```sh
caffeinate -dis uv run python train.py --data runs/tok-small --out runs/ckpt-small \
  --epochs 3 --no-eval --base microsoft/Multilingual-MiniLM-L12-H384 --tokenizer xlm-roberta-base
```
Expected: checkpoints in `runs/ckpt-small/`, the last being `checkpoint-<final>`.
Time: a few hours on MPS.

**5. Vocabulary-trim** the trained model with the SentencePiece trimmer. It keeps
XLM-R's entire Latin-script sub-vocabulary and drops the non-Latin scripts the
model does not serve, so tokenization of Latin text stays byte-identical to the
full tokenizer and the trim costs no recall. The corpus argument is the built
dataset from step 3:

```sh
uv run python trim_spm.py --model runs/ckpt-small/checkpoint-<final> \
  --corpus data/small.jsonl --out runs/model-small-trim
```
Expected: `trimmed 250037 -> 113876 pieces -> runs/model-small-trim`. Time: about a minute.

**6. Export with embedding quantization.** The `--quantize-embedding` flag
INT8-quantizes the word-embedding table. Export reads the trimmed directory from
step 5, not the original checkpoint:

```sh
uv run python export.py --ckpt runs/model-small-trim --out runs/model-small --quantize-embedding
```
Expected: `runs/model-small/` with `onnx/model_q4.onnx` (about 55 MB) and
`tokenizer.json` (about 4.5 MB), about 60 MB total. Time: about 5 to 10 minutes.

### curtain-tiny (the 14.2 MB smaller tier)

curtain-tiny is the earlier, smaller model on the 6-layer `MiniLM-L6-H384-uncased`
(WordPiece), frozen at `v1.0.0`. The pipeline defaults target that base and
tokenizer, so building a model of its shape from the same augmented data is the
default path plus the WordPiece trim:

```sh
uv run python prepare.py --in data/small.jsonl --out runs/tok-tiny
uv run python train.py --data runs/tok-tiny --out runs/ckpt-tiny --epochs 3
uv run python trim.py --model runs/ckpt-tiny --corpus data/small.jsonl --out runs/model-tiny-trim --target 19730
uv run python export.py --ckpt runs/model-tiny-trim --out runs/model-tiny --quantize-embedding
```
Expected: `runs/model-tiny/onnx/model_q4.onnx`, about 14.2 MB total.

## Verify and load

**Functional smoke.** Load the built model and redact a sample. From the repo
root (point `model` at `runs/model-quickstart` or `runs/model-small`):

```sh
bun -e 'import {createGuard} from "./index.ts"; const g = await createGuard({ model: "train/runs/model-small", device: "cpu" }); console.log((await g.protect("My SSN is 472-81-0094")).text);'
```
Expected: the SSN is replaced with a salted placeholder, for example
`My SSN is [SSN_1.<hex>]`. If you see the raw digits, the model did not load or
the path is wrong.

**On integrity.** A rebuild will not byte-match the reference SHA-256 recorded in
`SECURITY.md`. Training is nondeterministic across machines and library versions,
so the artifact hash differs run to run. The recorded hash lets you re-verify a
build you produced yourself; it is not a cross-machine reproduction check. The
functional smoke and the optional gates below are the real validation.

**Optional: reproduce the evaluation gates.** With `CURTAIN_MODEL` set to your
built model directory, the harnesses score it. The precision gates run through
onnxruntime-web (`eval:wasm`), the deterministic browser backend consumers use;
native onnxruntime over-redaction is platform-specific:

```sh
CURTAIN_MODEL=train/runs/model-small bun run eval:wasm
CURTAIN_MODEL=train/runs/model-small bun run eval:adversarial
bun run bench --model train/runs/model-small --data eval/bench/data/heldout.jsonl --out train/runs/bench-small
```
Reference numbers for curtain-small: bench 99.4% char-recall at 96.7% retention
(98.4% protected), real-world 99.3% protected at 2.4% keep-violation, held-out
fairness 100% protected. A rebuild should land within the confidence interval of
these, not exactly on them.

**How the library loads it.** `createGuard({ model: "<exported dir>" })` takes the
exported model directory (the one containing `onnx/` and the tokenizer files). In
Node, pass `device: "cpu"`. In the browser, the model runs on `wasm` or `webgpu`
via transformers.js. See `MODEL_CARD.md` for the model details and the recorded
metrics.

## Cut a release

This section documents how to publish the ship model to Hugging Face as a versioned release.

**Prerequisites.** The `HF_TOKEN` secret must be set in GitHub Actions
(Settings > Secrets and variables > Actions) before the publish step will succeed.

**1. Build the ship model** (Part B above), producing `runs/model-small`.

**2. Tag and create the GitHub release.**

```sh
cd train
uv run python cut_release.py --model runs/model-small --version 2.0.0
```

This script creates the timestamped tag `v2.0.0-<ts>` and publishes a live
prerelease immediately. No draft state is used. The `release: published` event
fires as soon as the script finishes, which triggers
`.github/workflows/release-publish.yml` automatically. That workflow:

1. Downloads the release asset and verifies the model SHA-256 recorded in the
   release notes matches the artifact.
2. Re-runs the real-157 and fairness gates through onnxruntime-web (`eval:wasm`,
   the deterministic browser backend) plus the native adversarial gate.
3. Pauses for manual approval in the `hf-release` environment. You will receive
   a notification and must approve the deployment in GitHub Actions before
   publishing proceeds.
4. On approval, publishes the artifact to `hackshare/curtain-privacy` on Hugging
   Face at the timestamped tag `v2.0.0-<ts>` and advances the moving pointer `v2.0.0`.

The moving `v2.0.0` pointer always points to the most recently published
curtain-small build, and `v1.0.0` stays pinned to curtain-tiny. Callers who need
an immutable pin should use the timestamped `v2.0.0-<ts>` (or `v1.0.0-<ts>`) tag.
