import numpy as np
from longname_probe import is_person, person_spans, length_bucket, classify_span
from labels import LABEL2ID

O = LABEL2ID["O"]
BG = LABEL2ID["B-GIVEN_NAME"]; IG = LABEL2ID["I-GIVEN_NAME"]
BS = LABEL2ID["B-SURNAME"]; IS = LABEL2ID["I-SURNAME"]
BC = LABEL2ID["B-CITY"]


def test_is_person():
    assert is_person(BG) and is_person(IS)
    assert not is_person(O) and not is_person(BC)


def test_person_spans_filters_non_person():
    gold = np.array([BG, IG, O, BC, O, BS])
    assert person_spans(gold) == [(0, 1), (5, 5)]


def test_length_bucket():
    assert length_bucket(1) == "1-4" and length_bucket(4) == "1-4"
    assert length_bucket(5) == "5" and length_bucket(6) == "6" and length_bucket(9) == "7+"


def test_classify_span_trailing():
    gold = np.array([BG, IG, IG])            # 3-token GIVEN_NAME
    c = classify_span(gold, np.array([BG, IG, O]), 0, 2)
    assert c == {"bucket": "1-4", "trailing_person": False, "trailing_exact": False, "full_ok": False}
    c = classify_span(gold, np.array([BG, IG, IS]), 0, 2)
    assert c["trailing_person"] and not c["trailing_exact"]
    c = classify_span(gold, np.array([BG, IG, IG]), 0, 2)
    assert c["trailing_person"] and c["trailing_exact"] and c["full_ok"]
