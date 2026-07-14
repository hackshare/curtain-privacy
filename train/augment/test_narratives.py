from augment.narratives import synth_narrative_rows, _NARRATIVE_UID_BASE
from augment.rows import assert_spans_exact


def test_rows_have_exact_spans_and_repeat_the_subject():
    rows = synth_narrative_rows(seed=1, n=50)
    assert len(rows) == 50
    for r in rows:
        assert_spans_exact(r)                    # offsets valid
        assert len(r["privacy_mask"]) >= 3       # multiple name occurrences
        givens = [s["value"] for s in r["privacy_mask"] if s["label"] == "GIVENNAME"]
        assert any(givens.count(v) >= 2 for v in set(givens))  # a name repeats


def test_many_narratives_open_with_a_name():
    rows = synth_narrative_rows(seed=2, n=100)
    opens = sum(1 for r in rows if min(s["start"] for s in r["privacy_mask"]) == 0)
    assert opens >= 30                           # several templates lead with the subject


def test_deterministic():
    a = synth_narrative_rows(seed=5, n=10)
    b = synth_narrative_rows(seed=5, n=10)
    assert [r["source_text"] for r in a] == [r["source_text"] for r in b]


def test_uids_disjoint_and_above_other_synth_ranges():
    rows = synth_narrative_rows(seed=1, n=10)
    assert all(r["uid"] >= _NARRATIVE_UID_BASE for r in rows)


def test_two_people_stay_distinct():
    rows = synth_narrative_rows(seed=3, n=80)
    for r in rows:
        givens = {s["value"] for s in r["privacy_mask"] if s["label"] == "GIVENNAME"}
        assert len(givens) >= 2                  # subject and object are different names
