"""Fast dataset fetch via the HF parquet CDN (bypasses the rate-limited datasets-server /rows API).

Streams the requested split's parquet shards from the hub, shuffles with a buffer for
representativeness, filters to the 24 supported Latin-script languages, and writes N rows
as JSONL in the schema train/build-dataset.ts expects: {uid, language, source_text, privacy_mask}.

Anonymous (public CC-BY dataset); no HF_TOKEN needed. Much higher throughput than the /rows API.

    uv run python fetch_hf.py --split train --n 150000 --seed 7 --out data/trainsplit-raw.jsonl

Balanced mode (per-language floor/cap):
    uv run python fetch_hf.py --split train --floor 5000 --cap 6000 --n 0 --seed 7 --out data/trainsplit-raw.jsonl
"""

import argparse
import json
import sys

from datasets import load_dataset

DATASET = "ai4privacy/pii-masking-openpii-1.5m"
# All 24 Latin-script OpenPII languages. The first seven were the original
# trained set; the rest are added for all-Latin coverage.
LATIN = {
    "en", "es", "fr", "de", "it", "pt", "nl",
    "pl", "cs", "sk", "lt", "lv", "et", "sv", "da", "fi",
    "hu", "ro", "sl", "hr", "vi", "ms", "id", "tl",
}


def keep_row(lang: str, counts: dict, languages: set, cap: int) -> bool:
    """True if this row's language is wanted and still under the per-language cap
    (cap <= 0 means no cap)."""
    if lang not in languages:
        return False
    return cap <= 0 or counts.get(lang, 0) < cap


def floors_met(counts: dict, languages: set, floor: int) -> bool:
    """True once every wanted language has reached the per-language floor
    (floor <= 0 disables the balanced stop, so the flat --n fetch runs)."""
    if floor <= 0:
        return False
    return all(counts.get(lang, 0) >= floor for lang in languages)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="train")
    ap.add_argument("--n", type=int, default=150000, help="flat overall cap (0 = unbounded)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", required=True)
    ap.add_argument("--buffer", type=int, default=20000, help="shuffle buffer size")
    ap.add_argument("--floor", type=int, default=0,
                    help="per-language minimum; >0 enables balanced mode and stops when every language reaches it")
    ap.add_argument("--cap", type=int, default=0, help="per-language maximum (0 = unbounded)")
    args = ap.parse_args()

    if args.cap and args.floor and args.cap < args.floor:
        sys.exit(f"--cap ({args.cap}) must be >= --floor ({args.floor})")

    ds = load_dataset(DATASET, split=args.split, streaming=True)
    ds = ds.shuffle(seed=args.seed, buffer_size=args.buffer)

    counts: dict = {}
    written = 0
    scanned = 0
    with open(args.out, "w") as f:
        for r in ds:
            scanned += 1
            lang = r["language"]
            if not keep_row(lang, counts, LATIN, args.cap):
                continue
            pm = [
                {"label": m["label"], "start": m["start"], "end": m["end"], "value": m["value"]}
                for m in (r.get("privacy_mask") or [])
            ]
            f.write(json.dumps({
                "uid": r["uid"],
                "language": lang,
                "source_text": r["source_text"],
                "privacy_mask": pm,
            }, ensure_ascii=False) + "\n")
            counts[lang] = counts.get(lang, 0) + 1
            written += 1
            if written % 5000 == 0:
                sys.stderr.write(f"\rwrote {written} (scanned {scanned})")
            if floors_met(counts, LATIN, args.floor):
                break
            if args.n > 0 and written >= args.n:
                break
    sys.stderr.write(f"\rwrote {written} (scanned {scanned})\n")
    missing = sorted(lang for lang in LATIN if counts.get(lang, 0) < args.floor) if args.floor else []
    if missing:
        sys.stderr.write(f"WARNING: below --floor {args.floor}: {missing}\n")
    print(f"done: {written} rows from '{args.split}' -> {args.out}")
    print("by language: " + json.dumps({k: counts[k] for k in sorted(counts)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
