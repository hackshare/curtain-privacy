"""Verify hand-authored / generated rows: keep only spans that string-match at their
offsets, so a mislabeled span can never poison training. A row with no surviving
spans is dropped (returns None)."""
from __future__ import annotations


def verify_row(row: dict) -> dict | None:
    text = row["source_text"]
    kept = [s for s in row["privacy_mask"] if text[s["start"]:s["end"]] == s["value"]]
    if not kept:
        return None
    return {"uid": row["uid"], "language": row["language"], "source_text": text, "privacy_mask": kept}
