import json, pathlib
from augment.verify import verify_row
from augment.rows import assert_spans_exact

def test_drops_mismatched_spans():
    row = {"uid": 1, "language": "en", "source_text": "hi Dana",
           "privacy_mask": [
               {"label": "GIVENNAME", "start": 3, "end": 7, "value": "Dana"},   # ok
               {"label": "SURNAME", "start": 3, "end": 7, "value": "Ng"},        # wrong
           ]}
    out = verify_row(row)
    assert_spans_exact(out)
    assert [s["label"] for s in out["privacy_mask"]] == ["GIVENNAME"]

def test_drops_row_with_no_surviving_spans():
    row = {"uid": 2, "language": "en", "source_text": "nothing",
           "privacy_mask": [{"label": "GIVENNAME", "start": 0, "end": 4, "value": "Zoe"}]}
    assert verify_row(row) is None

def test_seed_file_is_all_label_safe():
    path = pathlib.Path(__file__).with_name("realism_seed.jsonl")
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    assert len(rows) >= 20
    for r in rows:
        out = verify_row(r)
        assert out is not None                # every authored row survives verification
        # Span-count preservation: no authored span was silently dropped for a bad
        # offset (verify_row drops mismatches before assert_spans_exact would see them).
        assert len(out["privacy_mask"]) == len(r["privacy_mask"]), \
            f"uid {r['uid']}: {len(r['privacy_mask'])} authored, {len(out['privacy_mask'])} survived"
        assert_spans_exact(out)
