"""Messy-realism augmentation: perturb only the gaps between spans (never a span's
own text), so span values stay verbatim and offsets are recomputed from lengths.
Introduces field-style separators and case/space noise like real chat input."""
from __future__ import annotations
import random
from augment.rows import assert_spans_exact

# Applied to whole non-span gap chunks. Each takes (chunk, rng) -> chunk.
def _collapse_spaces(chunk: str, rng: random.Random) -> str:
    return chunk.replace(" and ", " ") if " and " in chunk and rng.random() < 0.5 else chunk

def _fieldify(chunk: str, rng: random.Random) -> str:
    # Turn " and my email is " style connectors into a compact "field:" separator.
    stripped = chunk.strip()
    if stripped and rng.random() < 0.4:
        # `or [""]` guards a punctuation-only gap (e.g. "::") from an empty split.
        word = (stripped.rstrip(":").split() or [""])[-1]
        return " " + word[:6].lower() + ":"
    return chunk

def _lower_edges(chunk: str, rng: random.Random) -> str:
    return chunk.lower() if rng.random() < 0.3 else chunk

_GAP_TRANSFORMS = [_collapse_spaces, _fieldify, _lower_edges]


def messify(row: dict, seed: int) -> dict:
    """Perturb inter-span gaps only. Span substrings are copied verbatim."""
    rng = random.Random(seed + row["uid"])
    spans = sorted(row["privacy_mask"], key=lambda s: s["start"])
    src = row["source_text"]

    out_text = ""
    new_spans = []
    cursor = 0
    for s in spans:
        gap = src[cursor:s["start"]]
        for t in _GAP_TRANSFORMS:
            gap = t(gap, rng)
        out_text += gap
        start = len(out_text)
        out_text += s["value"]
        new_spans.append({"label": s["label"], "start": start, "end": len(out_text), "value": s["value"]})
        cursor = s["end"]
    tail = src[cursor:]
    for t in _GAP_TRANSFORMS:
        tail = t(tail, rng)
    out_text += tail

    result = {"uid": row["uid"], "language": row["language"],
              "source_text": out_text, "privacy_mask": new_spans}
    assert_spans_exact(result)
    return result
