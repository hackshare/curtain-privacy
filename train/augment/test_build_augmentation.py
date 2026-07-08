from augment.build_augmentation import build_augmentation
from augment.rows import assert_spans_exact, AUG_UID_BASE, GOVID_LABEL

BASE = [
    {"uid": 1, "language": "en", "source_text": "I am John Smith",
     "privacy_mask": [{"label": "GIVENNAME", "start": 5, "end": 9, "value": "John"},
                      {"label": "SURNAME", "start": 10, "end": 15, "value": "Smith"}]},
    {"uid": 2, "language": "en", "source_text": "call 800-555-0100",
     "privacy_mask": [{"label": "TELEPHONENUM", "start": 5, "end": 17, "value": "800-555-0100"}]},
]

def test_output_is_label_safe_and_uids_reserved():
    out = build_augmentation(BASE, seed=1, name_frac=1.0, messy_frac=0.5, n_govid=10)
    assert len(out) >= len(BASE) + 10               # base (transformed) + govid rows
    govid = [r for r in out if any(s["label"] == GOVID_LABEL for s in r["privacy_mask"])]
    assert len(govid) >= 10
    for r in out:
        assert_spans_exact(r)
    assert all(r["uid"] >= AUG_UID_BASE for r in out)   # every emitted uid is synthetic

def test_deterministic():
    a = build_augmentation(BASE, seed=3, name_frac=1.0, messy_frac=1.0, n_govid=5)
    b = build_augmentation(BASE, seed=3, name_frac=1.0, messy_frac=1.0, n_govid=5)
    assert [r["source_text"] for r in a] == [r["source_text"] for r in b]
