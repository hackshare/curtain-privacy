# Building the `curtain` model

The `curtain` model is built locally from this `train/` pipeline and loaded by
path. It is not fetched from a host. This runbook has two paths:

- **Quickstart** produces a working model (about 52 MB) with the shortest chain.
  Use it to confirm the pipeline runs end to end and to get a model you can load.
- **Ship** adds augmentation, a vocabulary trim, and embedding quantization to
  produce the 14.2 MB artifact that passes the evaluation gates.

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

## Part B: Ship model (14.2 MB, gate-passing)

The ship model adds augmentation, a vocabulary trim, and embedding quantization.
Start from the same fetched slice as Part A step 1 (`data/trainsplit-raw.jsonl`).

**1. Generate the augmentation set** (diverse names, messy formatting,
synthesized government IDs, and keep-class negatives):

```sh
cd train
uv run python -m augment.build_augmentation \
  --base data/trainsplit-raw.jsonl --out data/aug.jsonl \
  --seed 1 --name-frac 0.6 --messy-frac 0.4 --n-govid 4000 --n-neg 8000
```
Expected: `wrote <about 154000> augmentation rows -> data/aug.jsonl`. Time: a few minutes.

**2. Combine** the base rows and the augmentation into one training set. The
augmentation file is in the same raw schema as the fetch, so a concatenation is
all that is needed:

```sh
cat data/trainsplit-raw.jsonl data/aug.jsonl > data/sp2c-raw.jsonl
wc -l data/sp2c-raw.jsonl   # about 304000
```

**3. Build and tokenize** the combined set:

```sh
cd ..
bun train/build-dataset.ts --in train/data/sp2c-raw.jsonl --out train/data/sp2c.jsonl
cd train
uv run python prepare.py --in data/sp2c.jsonl --out runs/tok-sp2c
```

**4. Train** for 3 epochs (larger dataset, so longer than Part A):

```sh
uv run python train.py --data runs/tok-sp2c --out runs/ckpt-sp2c --epochs 3
```
Expected: the final model in `runs/ckpt-sp2c/`. Time: a few hours on MPS.

**5. Vocabulary-trim** the trained model to 19,730 pieces. Trim keeps every
special token and single-character piece, so every input still tokenizes; it
drops only rare multi-character pieces. In the recorded run, trim nudged
retention slightly up, so it is not a recall regression. The corpus argument is
the built dataset from step 3 (it carries the `text` field trim reads):

```sh
uv run python trim.py --model runs/ckpt-sp2c --corpus data/sp2c.jsonl --out runs/model-trim --target 19730
```
Expected: `trimmed 30522 -> 19730 pieces -> runs/model-trim`. Time: under a minute.

**6. Export with embedding quantization.** The `--quantize-embedding` flag
INT8-quantizes the word-embedding table. It is required to hit the size budget on
a trimmed model; without it the export stays around 52 MB. Export reads the
trimmed directory from step 5, not the original checkpoint:

```sh
uv run python export.py --ckpt runs/model-trim --out runs/model-ship --quantize-embedding
```
Expected: `runs/model-ship/` with `onnx/model_q4.onnx`, about 14.2 MB total. Time: about 5 to 10 minutes.

## Verify and load

**Functional smoke.** Load the built model and redact a sample. From the repo
root (point `model` at `runs/model-quickstart` or `runs/model-ship`):

```sh
bun -e 'import {createGuard} from "./index.ts"; const g = await createGuard({ model: "train/runs/model-ship", device: "cpu" }); console.log((await g.protect("My SSN is 472-81-0094")).text);'
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
built model directory, the existing harnesses score it:

```sh
CURTAIN_MODEL=train/runs/model-ship bun run eval:real:check
CURTAIN_MODEL=train/runs/model-ship bun run eval:adversarial
bun run bench --model train/runs/model-ship --data eval/bench/data/heldout.jsonl --out train/runs/bench-ship
```
Reference numbers for the ship model: bench 98.9% protected at 96.6% retention,
real-world 100% protected, held-out fairness 99.3% protected. A rebuild should
land within the confidence interval of these, not exactly on them.

**How the library loads it.** `createGuard({ model: "<exported dir>" })` takes the
exported model directory (the one containing `onnx/` and the tokenizer files). In
Node, pass `device: "cpu"`. In the browser, the model runs on `wasm` or `webgpu`
via transformers.js. See `MODEL_CARD.md` for the model details and the recorded
metrics.
