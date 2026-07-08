# SP1 training-slice provenance

```bash
# 1. Fetch a 50k slice from the OpenPII validation split (seed 7, disjoint seed from the eval-30k seed 0)
bun run bench:fetch --n 50000 --seed 7 --concurrency 8 \
  --out train/data/train-raw-all.jsonl --manifest train/data/train.manifest.json

# 2. Drop rows whose uid is in the eval-30k manifest -> disjoint training set
#    (result: 40,004 disjoint rows; 9,996 eval-overlap dropped)
python3 - <<'PY'
import json
evalu = set(json.load(open('baseline/heldout.manifest.json')).get('uids', []))
with open('train/data/train-raw-all.jsonl') as f, open('train/data/train-raw.jsonl','w') as out:
    for line in f:
        if line.strip() and json.loads(line).get('uid') not in evalu:
            out.write(line)
PY

# 3. Build -> tokenize -> train -> export -> eval
bun train/build-dataset.ts --in train/data/train-raw.jsonl --out train/data/train.jsonl
cd train && uv run python prepare.py --in data/train.jsonl --out runs/tok-full
uv run python train.py --data runs/tok-full --out runs/ckpt-full --epochs 3
uv run python export.py --ckpt runs/ckpt-full --out runs/model-full
cd .. && bun run bench --data eval/bench/data/heldout.jsonl --out train/runs/bench-full --model train/runs/model-full
mkdir -p train/runs/real-full && bun eval/real/run.ts --model train/runs/model-full --out train/runs/real-full
```
