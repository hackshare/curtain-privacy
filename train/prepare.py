"""
prepare.py — tokenize folded JSONL into BIO-labelled HuggingFace Dataset.

Usage:
    uv run python prepare.py --in <input.jsonl> --out <output_dir>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from datasets import Dataset
from transformers import PreTrainedTokenizerBase

from labels import LABEL2ID

_BASE_MODEL = "nreimers/MiniLM-L6-H384-uncased"
_MAX_LENGTH = 512


def align_labels(
    text: str,
    spans: list[dict],
    tokenizer: PreTrainedTokenizerBase,
    max_length: int = _MAX_LENGTH,
) -> list[int]:
    """Return per-token label ids aligned to the tokenizer's sub-word output.

    - First sub-token of a span  → B-<type>
    - Continuation sub-tokens    → I-<type>
    - Non-span content           → O  (id 0)
    - Special / padding tokens   → -100
    """
    encoding = tokenizer(
        text,
        return_offsets_mapping=True,
        truncation=True,
        max_length=max_length,
    )
    offset_mapping: list[tuple[int, int]] = encoding["offset_mapping"]

    # Sort spans so we can iterate predictably; track which ones have been started.
    sorted_spans = sorted(spans, key=lambda s: s["start"])
    span_started: set[int] = set()

    label_ids: list[int] = []
    for token_idx, (a, b) in enumerate(offset_mapping):
        # Special / padding tokens have zero-length offset in HF tokenizers.
        if a == b:
            label_ids.append(-100)
            continue

        assigned: str = "O"
        for span_idx, span in enumerate(sorted_spans):
            span_start: int = span["start"]
            span_end: int = span["end"]
            # Overlap check: token [a, b) overlaps span [span_start, span_end)
            if a < span_end and b > span_start:
                entity_type: str = span["label"]
                if span_idx not in span_started:
                    span_started.add(span_idx)
                    assigned = f"B-{entity_type}"
                else:
                    assigned = f"I-{entity_type}"
                break  # take the first matching span

        label_ids.append(LABEL2ID[assigned])

    return label_ids


def _process_file(in_path: Path, out_path: Path) -> None:
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(_BASE_MODEL)

    input_ids_list: list[list[int]] = []
    attention_mask_list: list[list[int]] = []
    labels_list: list[list[int]] = []

    with in_path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            text: str = row["text"]
            spans: list[dict] = row.get("spans", [])

            encoding = tokenizer(
                text,
                truncation=True,
                max_length=_MAX_LENGTH,
                return_offsets_mapping=True,
            )
            label_ids = align_labels(text, spans, tokenizer, max_length=_MAX_LENGTH)

            input_ids_list.append(encoding["input_ids"])
            attention_mask_list.append(encoding["attention_mask"])
            labels_list.append(label_ids)

    dataset = Dataset.from_dict(
        {
            "input_ids": input_ids_list,
            "attention_mask": attention_mask_list,
            "labels": labels_list,
        }
    )
    dataset.save_to_disk(str(out_path))
    print(f"Saved {len(dataset)} rows → {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Tokenize folded JSONL into BIO dataset.")
    parser.add_argument("--in", dest="input", required=True, help="Input JSONL file")
    parser.add_argument("--out", required=True, help="Output datasets directory")
    args = parser.parse_args()

    in_path = Path(args.input)
    out_path = Path(args.out)
    out_path.mkdir(parents=True, exist_ok=True)
    _process_file(in_path, out_path)


if __name__ == "__main__":
    main()
