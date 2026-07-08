"""Vocab-trim a trained token classifier: drop rare multi-character WordPieces so the
ONNX embedding table shrinks to the ~14.7 MB ship budget. All special and
single-character pieces are kept, so every input still tokenizes (worst case
char-by-char); only rare multi-character pieces are dropped, which lengthens the
tokenization of a few rare words but never produces an all-[UNK] sequence.

Usage:
  uv run python trim.py --model runs/ckpt-sp2c3/checkpoint-52656 \
      --corpus data/sp2c.jsonl --out runs/model-trim --target 19730
"""
from __future__ import annotations
import argparse
import json
from collections import Counter
from pathlib import Path
from transformers import AutoModelForTokenClassification, BertTokenizerFast


def piece_freq(tok: BertTokenizerFast, texts: list[str]) -> Counter:
    freq: Counter = Counter()
    for t in texts:
        freq.update(tok(t, add_special_tokens=False)["input_ids"])
    return freq


def choose_keep(tok: BertTokenizerFast, freq: Counter, target: int) -> list[int]:
    vocab = tok.get_vocab()  # piece -> id
    keep = set(tok.all_special_ids)
    for piece, i in vocab.items():
        core = piece[2:] if piece.startswith("##") else piece
        if len(core) == 1:  # every single-character piece
            keep.add(i)
    for i, _ in freq.most_common():  # fill the budget with the most frequent pieces
        if len(keep) >= target:
            break
        keep.add(i)
    return sorted(keep)  # preserve original id order (keeps specials early)


def trim(model_dir: str, corpus_path: str, out_dir: str, target: int) -> None:
    tok = BertTokenizerFast.from_pretrained(model_dir)
    model = AutoModelForTokenClassification.from_pretrained(model_dir)
    with open(corpus_path) as f:
        texts = [json.loads(l)["text"] for l in f if l.strip()]
    keep = choose_keep(tok, piece_freq(tok, texts), target)

    id2piece = {i: p for p, i in tok.get_vocab().items()}
    new_pieces = [id2piece[i] for i in keep]

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "vocab.txt").write_text("\n".join(new_pieces) + "\n")
    # A fresh fast tokenizer built from the trimmed vocab writes a valid tokenizer.json.
    new_tok = BertTokenizerFast(vocab_file=str(out / "vocab.txt"), do_lower_case=True)
    new_tok.save_pretrained(str(out))

    emb = model.get_input_embeddings().weight.data
    new_emb = emb[keep, :].clone()
    model.resize_token_embeddings(len(keep))
    model.get_input_embeddings().weight.data.copy_(new_emb)
    model.config.vocab_size = len(keep)
    model.save_pretrained(str(out))
    print(f"trimmed {emb.shape[0]} -> {len(keep)} pieces -> {out}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--target", type=int, default=19730)
    a = ap.parse_args()
    trim(a.model, a.corpus, a.out, a.target)
