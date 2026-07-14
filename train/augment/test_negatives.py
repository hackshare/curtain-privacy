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


def test_codes_when_present_are_left_untagged():
    # A reference code, when a row carries one, must be O (never a redact span).
    # Not every template has a code now: the geo keep-templates do not.
    import re
    rows = synth_negative_rows(seed=5, n=120)
    code_rows = 0
    for r in rows:
        text = r["source_text"]
        spans = [(s["start"], s["end"]) for s in r["privacy_mask"]]
        for m in re.finditer(r"[A-Z]{2,4}-\d{4,6}", text):
            code_rows += 1
            assert not any(a <= m.start() < b for a, b in spans), f"code tagged redact in: {text}"
    assert code_rows >= 30  # codes still appear across many rows


def test_deterministic_and_varied():
    a = synth_negative_rows(seed=5, n=20)
    b = synth_negative_rows(seed=5, n=20)
    assert [r["source_text"] for r in a] == [r["source_text"] for r in b]
    assert len({r["source_text"] for r in a}) >= 10


def test_full_state_names_and_months_appear_only_as_keep_text():
    from augment.negatives import _STATE_NAMES, _MONTHS
    rows = synth_negative_rows(seed=7, n=300)
    texts = " ".join(r["source_text"] for r in rows)
    assert any(sn in texts for sn in _STATE_NAMES)   # full state names now shown
    assert any(m in texts for m in _MONTHS)          # months now shown
    for r in rows:                                   # and never redacted
        redacted = {r["source_text"][s["start"]:s["end"]] for s in r["privacy_mask"]}
        assert not (redacted & set(_STATE_NAMES)), "a full state name was tagged redact"
        assert not (redacted & set(_MONTHS)), "a month was tagged redact"
