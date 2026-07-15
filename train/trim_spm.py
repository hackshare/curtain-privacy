"""Vocab-trim a SentencePiece (XLM-R / Unigram) token classifier.

Keep XLM-R's entire Latin-script sub-vocabulary plus the specials and the pieces
our corpus uses; drop the non-Latin scripts (CJK / Arabic / Cyrillic / Indic —
about 55% of the 250k vocab) that this Latin-only model never serves. Because
every entirely-Latin piece is kept, tokenization of any Latin text is
byte-identical to the full tokenizer, so the trim costs zero recall — only the
embedding table shrinks (~250k -> ~114k pieces).

A frequency-only prune (keep the top-N corpus-frequent pieces) does NOT work
here: held-out non-English Latin name pieces ("▁Phước", "▁Nurul") are absent
from a PII corpus, so they get dropped and those names shatter into single
characters at inference, collapsing per-language recall. The Latin-script rule
avoids that by keeping the whole sub-vocabulary the languages draw from.

The XLM-R tokenizer is Unigram: tokenizer.json holds a flat model.vocab of
[piece, score] pairs whose position IS the id. Pruning the vocab therefore has
to remap every id reference — unk_id, added_tokens ids, and the post_processor
special-token ids — and the embedding rows must be sliced in the same order.

Usage:
  uv run python trim_spm.py --model runs/ckpt-ml/checkpoint-N \
      --corpus data/recall4.jsonl --out runs/model-ml-trim --hub xlm-roberta-base
"""

from __future__ import annotations

import argparse
import json
import shutil
import unicodedata
from collections import Counter
from pathlib import Path

from huggingface_hub import hf_hub_download
from transformers import AutoModelForTokenClassification, AutoTokenizer

SPM = "▁"  # XLM-R word-start marker (U+2581)

# XLM-R has no separate special_tokens_map.json on the hub; this is its standard map.
_SPECIAL_TOKENS_MAP = {
    "bos_token": "<s>",
    "cls_token": "<s>",
    "eos_token": "</s>",
    "mask_token": "<mask>",
    "pad_token": "<pad>",
    "sep_token": "</s>",
    "unk_token": "<unk>",
}


def _latin_char(c: str) -> bool:
    """A Latin letter (any Unicode range, incl. U+1Exx precomposed diacritics),
    a combining mark, or any ASCII glyph."""
    return (
        c.isascii()
        or unicodedata.category(c) in ("Mn", "Mc", "Me")
        or unicodedata.name(c, "").startswith("LATIN")
    )


def latin_piece(piece: str) -> bool:
    """True if every character of the piece (ignoring the ▁ marker) is Latin-ok."""
    core = piece.replace(SPM, "")
    return bool(core) and all(_latin_char(c) for c in core)


def choose_keep(vocab: list, added_ids, unk_id: int, corpus_ids) -> list[int]:
    """Kept ids in ascending order: specials, the unk piece, every corpus-used
    piece, and the full Latin-script sub-vocabulary."""
    keep = set(added_ids)
    keep.add(unk_id)
    keep.update(corpus_ids)
    for i, (piece, _score) in enumerate(vocab):
        if latin_piece(piece):
            keep.add(i)
    return sorted(keep)


def prune_tokenizer(tj: dict, keep: list[int]) -> dict:
    """Prune model.vocab to `keep` (mutating `tj`) and remap every id reference —
    unk_id, added_tokens ids, and post_processor special-token ids — to the new
    contiguous positions."""
    old2new = {o: n for n, o in enumerate(keep)}
    vocab = tj["model"]["vocab"]
    tj["model"]["vocab"] = [vocab[o] for o in keep]
    tj["model"]["unk_id"] = old2new[tj["model"]["unk_id"]]
    for at in tj.get("added_tokens", []):
        at["id"] = old2new[at["id"]]
    for _tok, spec in (
        (tj.get("post_processor") or {}).get("special_tokens", {}).items()
    ):
        spec["ids"] = [old2new[i] for i in spec["ids"]]
    return tj


def _corpus_freq(tok, corpus_path: str, rows: int) -> Counter:
    freq: Counter = Counter()
    n = 0
    with open(corpus_path) as f:
        for line in f:
            if n >= rows:
                break
            if line.strip():
                freq.update(
                    tok(json.loads(line)["text"], add_special_tokens=False)["input_ids"]
                )
                n += 1
    return freq


def trim(model_dir: str, corpus_path: str, out_dir: str, hub: str, rows: int) -> None:
    tok = AutoTokenizer.from_pretrained(hub)
    tj = json.load(open(hf_hub_download(hub, "tokenizer.json")))
    keep = choose_keep(
        tj["model"]["vocab"],
        [at["id"] for at in tj.get("added_tokens", [])],
        tj["model"]["unk_id"],
        _corpus_freq(tok, corpus_path, rows).keys(),
    )
    prune_tokenizer(tj, keep)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    json.dump(tj, open(out / "tokenizer.json", "w"))
    shutil.copy(
        hf_hub_download(hub, "tokenizer_config.json"), out / "tokenizer_config.json"
    )
    json.dump(_SPECIAL_TOKENS_MAP, open(out / "special_tokens_map.json", "w"))

    model = AutoModelForTokenClassification.from_pretrained(model_dir)
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
    ap.add_argument("--hub", default="xlm-roberta-base")
    ap.add_argument("--rows", type=int, default=120000)
    a = ap.parse_args()
    trim(a.model, a.corpus, a.out, a.hub, a.rows)
