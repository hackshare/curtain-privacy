"""Derive a small per-language-balanced slice from a cached raw JSONL slice.
Used for the quick M1 proxy retrain, which needs a fast, balanced subset of the
full fetched slice rather than a second network fetch."""
from __future__ import annotations
import argparse
import json
import sys
from typing import Iterable, Iterator


def subsample(rows: Iterable[dict], per_lang: int, languages: set) -> Iterator[dict]:
    """Yield at most `per_lang` rows per language. An empty `languages` keeps
    every language (still capped at `per_lang` each)."""
    counts: dict = {}
    for r in rows:
        lang = r.get("language")
        if languages and lang not in languages:
            continue
        if counts.get(lang, 0) >= per_lang:
            continue
        counts[lang] = counts.get(lang, 0) + 1
        yield r


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-lang", type=int, required=True)
    ap.add_argument("--languages", default="", help="comma-separated; empty = all present")
    args = ap.parse_args()

    langs = set(filter(None, args.languages.split(","))) if args.languages else set()
    counts: dict = {}
    with open(args.inp) as fin, open(args.out, "w") as fout:
        rows = (json.loads(line) for line in fin if line.strip())
        for r in subsample(rows, args.per_lang, langs):
            fout.write(json.dumps(r, ensure_ascii=False) + "\n")
            counts[r["language"]] = counts.get(r["language"], 0) + 1
    sys.stderr.write("by language: " + json.dumps({k: counts[k] for k in sorted(counts)}) + "\n")
    print(f"done: {sum(counts.values())} rows -> {args.out}")


if __name__ == "__main__":
    main()
