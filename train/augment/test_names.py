from augment.names import swap_names
from augment.rows import assert_spans_exact

BASE = {
    "uid": 5, "language": "en",
    "source_text": "Hi, I am John Smith and my email is a@b.com.",
    "privacy_mask": [
        {"label": "GIVENNAME", "start": 9, "end": 13, "value": "John"},
        {"label": "SURNAME", "start": 14, "end": 19, "value": "Smith"},
        {"label": "EMAIL", "start": 36, "end": 43, "value": "a@b.com"},
    ],
}


def test_base_fixture_is_valid():
    assert_spans_exact(BASE)

def test_swap_changes_names_keeps_spans_exact():
    row = {**BASE, "privacy_mask": [dict(s) for s in BASE["privacy_mask"]]}
    out = swap_names(row, seed=1)
    assert_spans_exact(out)                    # offsets recomputed correctly
    names = [s["value"] for s in out["privacy_mask"] if s["label"] in ("GIVENNAME", "SURNAME")]
    assert names != ["John", "Smith"]          # names actually changed
    assert "GIVENNAME" in [s["label"] for s in out["privacy_mask"]]

def test_swap_is_deterministic():
    a = swap_names({**BASE, "privacy_mask": [dict(s) for s in BASE["privacy_mask"]]}, seed=7)
    b = swap_names({**BASE, "privacy_mask": [dict(s) for s in BASE["privacy_mask"]]}, seed=7)
    assert a["source_text"] == b["source_text"]

def test_swap_leaves_rows_without_names_unchanged():
    row = {"uid": 1, "language": "en", "source_text": "no names here",
           "privacy_mask": []}
    assert swap_names(row, seed=1)["source_text"] == "no names here"
