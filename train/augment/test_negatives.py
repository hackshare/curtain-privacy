from augment.negatives import synth_negative_rows
from augment.rows import assert_spans_exact, AUG_UID_BASE

REDACT = {"GIVENNAME", "SURNAME"}


def test_negatives_are_label_safe_with_only_name_redacted():
    rows = synth_negative_rows(seed=5, n=40)
    assert len(rows) == 40
    for r in rows:
        assert_spans_exact(r)
        labels = {s["label"] for s in r["privacy_mask"]}
        # Only the name is a redact span; the code/city/state are O (not in the mask).
        assert labels <= REDACT, f"unexpected redact label in negative row: {labels}"
        assert "GIVENNAME" in labels and "SURNAME" in labels
        assert r["uid"] >= AUG_UID_BASE


def test_negatives_contain_a_code_left_untagged():
    # The order/reference code must appear in the text but NOT be a redact span,
    # so the model learns it is O.
    rows = synth_negative_rows(seed=5, n=40)
    for r in rows:
        text = r["source_text"]
        spans = [(s["start"], s["end"]) for s in r["privacy_mask"]]
        # There is a hyphenated code (LETTERS-DIGITS) somewhere, and no span covers it.
        import re
        m = re.search(r"[A-Z]{2,4}-\d{4,6}", text)
        assert m is not None, f"no code in: {text}"
        assert not any(a <= m.start() < b for a, b in spans), "code was tagged as redact"


def test_deterministic_and_varied():
    a = synth_negative_rows(seed=5, n=20)
    b = synth_negative_rows(seed=5, n=20)
    assert [r["source_text"] for r in a] == [r["source_text"] for r in b]
    assert len({r["source_text"] for r in a}) >= 10
