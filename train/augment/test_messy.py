from augment.messy import messify
from augment.rows import assert_spans_exact

BASE = {
    "uid": 3, "language": "en",
    "source_text": "My name is Dana Lopez and I live at 42 Oak Street.",
    "privacy_mask": [
        {"label": "GIVENNAME", "start": 11, "end": 15, "value": "Dana"},
        {"label": "SURNAME", "start": 16, "end": 21, "value": "Lopez"},
        {"label": "BUILDINGNUM", "start": 36, "end": 38, "value": "42"},
        {"label": "STREET", "start": 39, "end": 49, "value": "Oak Street"},
    ],
}

def test_messify_keeps_spans_exact_and_changes_text():
    # seed=0 fires _fieldify on "My name is " and _lower_edges on " and I live at "
    row = {**BASE, "privacy_mask": [dict(s) for s in BASE["privacy_mask"]]}
    out = messify(row, seed=0)
    assert_spans_exact(out)
    assert out["source_text"] != BASE["source_text"]      # something changed
    # Every span value is still present verbatim.
    for s in out["privacy_mask"]:
        assert s["value"] in out["source_text"]

def test_messify_is_deterministic():
    a = messify({**BASE, "privacy_mask": [dict(s) for s in BASE["privacy_mask"]]}, seed=9)
    b = messify({**BASE, "privacy_mask": [dict(s) for s in BASE["privacy_mask"]]}, seed=9)
    assert a["source_text"] == b["source_text"]
    assert a["privacy_mask"] == b["privacy_mask"]      # span offsets are deterministic too

def test_messify_survives_punctuation_only_gaps():
    # A gap of only ":" must not crash _fieldify (empty split). Sweep seeds so the
    # probabilistic _fieldify branch is exercised; messify asserts spans internally.
    row = {"uid": 1, "language": "en", "source_text": "Dana::Lopez",
           "privacy_mask": [
               {"label": "GIVENNAME", "start": 0, "end": 4, "value": "Dana"},
               {"label": "SURNAME", "start": 6, "end": 11, "value": "Lopez"},
           ]}
    for seed in range(50):
        out = messify({**row, "privacy_mask": [dict(s) for s in row["privacy_mask"]]}, seed=seed)
        assert_spans_exact(out)
