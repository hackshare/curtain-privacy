import numpy as np
from decode_probe import legal_transitions, viterbi, gold_spans, bucket_spans
from labels import LABEL2ID, ID2LABEL

O = LABEL2ID["O"]
BG = LABEL2ID["B-GIVEN_NAME"]; IG = LABEL2ID["I-GIVEN_NAME"]
BS = LABEL2ID["B-SURNAME"]; IS = LABEL2ID["I-SURNAME"]


def _is_inside(tag_id):
    return ID2LABEL[tag_id].startswith("I-")


def test_legality_table():
    legal = legal_transitions()
    assert legal[BG, IG]            # B-GIVEN -> I-GIVEN legal
    assert legal[IG, IG]            # I-GIVEN -> I-GIVEN legal
    assert not legal[O, IG]         # O -> I-GIVEN illegal
    assert not legal[BG, IS]        # B-GIVEN -> I-SURNAME illegal (cross-entity)
    assert legal[IG, BS]            # I-GIVEN -> B-SURNAME legal
    assert legal[O, BG] and legal[BG, O]


def test_viterbi_forbids_illegal_and_recovers_span():
    # Emissions favor the ILLEGAL "O I-GIVEN"; a legal path exists.
    L = legal_transitions().shape[0]
    E = np.full((2, L), -5.0)
    E[0, O] = 2.0; E[0, BG] = 1.0        # token0: argmax O (illegal precursor for I)
    E[1, IG] = 3.0; E[1, O] = 0.0        # token1: argmax I-GIVEN
    path = viterbi(E, legal_transitions())
    assert list(path) == [BG, IG]        # legal decode cannot emit O then I-GIVEN


def test_viterbi_start_cannot_be_inside():
    L = legal_transitions().shape[0]
    E = np.full((1, L), -5.0); E[0, IG] = 5.0
    assert not _is_inside(viterbi(E, legal_transitions())[0])


def test_continuation_bias_recovers_truncated_span():
    # Gold is B-GIVEN I-GIVEN, but the emission slightly prefers O at the second
    # token, so hard-Viterbi truncates. A continuation bias should extend the span.
    L = legal_transitions().shape[0]
    E = np.full((2, L), -5.0)
    E[0, BG] = 3.0
    E[1, O] = 1.0; E[1, IG] = 0.5        # emission favors O by 0.5; continuation legal
    assert list(viterbi(E, legal_transitions(), 0.0)) == [BG, O]     # hard truncates
    assert list(viterbi(E, legal_transitions(), 2.0)) == [BG, IG]    # bias recovers


def test_gold_spans_extracts_bio_runs():
    gold = np.array([O, BG, IG, O, BS])
    assert gold_spans(gold) == [(1, 2), (4, 4)]


def test_bucketing_precedence():
    gold = np.array([BG, IG])
    good = np.array([BG, IG])
    # argmax already correct -> argmax_ok
    c = bucket_spans(gold, good, good, [good])
    assert c == {"argmax_ok": 1, "legal_recovers": 0, "tuned_recoverable": 0, "emission_limited": 0}
    # argmax wrong (illegal O I-), hard-Viterbi recovers -> legal_recovers
    c = bucket_spans(gold, np.array([O, IG]), good, [good])
    assert c["legal_recovers"] == 1
    # only a biased path recovers -> tuned_recoverable
    c = bucket_spans(gold, np.array([BG, O]), np.array([BG, O]), [good])
    assert c["tuned_recoverable"] == 1
    # nothing recovers -> emission_limited
    bad = np.array([BG, O])
    c = bucket_spans(gold, bad, bad, [bad, bad])
    assert c["emission_limited"] == 1
