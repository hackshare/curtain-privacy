from augment.govid import synth_govid_rows
from augment.rows import assert_spans_exact, GOVID_LABEL

def test_synth_rows_are_label_safe_and_cued():
    rows = synth_govid_rows(seed=4, n=25)
    assert len(rows) == 25
    cues = ("id", "government", "agency", "employee", "staff", "badge", "resident")
    for r in rows:
        assert_spans_exact(r)
        gov = [s for s in r["privacy_mask"] if s["label"] == GOVID_LABEL]
        assert len(gov) == 1
        assert any(c in r["source_text"].lower() for c in cues)   # an identity cue is present

def test_synth_is_deterministic_and_varied():
    a = synth_govid_rows(seed=4, n=10)
    b = synth_govid_rows(seed=4, n=10)
    assert [r["source_text"] for r in a] == [r["source_text"] for r in b]
    assert len({r["privacy_mask"][0]["value"] for r in a}) > 1   # varied IDs
