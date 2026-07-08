"""Shared helpers for OpenPII-shaped augmentation rows."""
from __future__ import annotations

PERSON_LABELS = ("GIVENNAME", "SURNAME")  # OpenPII labels -> GIVEN_NAME / SURNAME
GOVID_LABEL = "IDCARDNUM"                  # OpenPII label -> GOVERNMENT_ID
AUG_UID_BASE = 10_000_000                  # synthetic uids start here (disjoint from eval-30k)


def assert_spans_exact(row: dict) -> None:
    """Every span's stored value must equal the substring at its offsets."""
    text = row["source_text"]
    for s in row["privacy_mask"]:
        got = text[s["start"]:s["end"]]
        if got != s["value"]:
            raise AssertionError(
                f"span {s['label']} [{s['start']}:{s['end']}] = {got!r} != value {s['value']!r}"
            )


def build_from_parts(uid: int, language: str, parts: list[tuple[str, str | None]]) -> dict:
    """Assemble source_text + privacy_mask from (text, label) parts. A non-None
    label makes that part a span; offsets are computed from the running length."""
    text = ""
    spans = []
    for chunk, label in parts:
        start = len(text)
        text += chunk
        if label is not None:
            spans.append({"label": label, "start": start, "end": len(text), "value": chunk})
    row = {"uid": uid, "language": language, "source_text": text, "privacy_mask": spans}
    assert_spans_exact(row)
    return row
