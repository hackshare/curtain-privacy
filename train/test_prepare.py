from transformers import AutoTokenizer
from prepare import align_labels
from labels import LABEL2ID

TOK = AutoTokenizer.from_pretrained("nreimers/MiniLM-L6-H384-uncased")


def test_bio_alignment_first_subtoken_is_B():
    text = "contact jose reyes today"
    spans = [{"label": "GIVEN_NAME", "start": 8, "end": 12},
             {"label": "SURNAME", "start": 13, "end": 18}]
    ids = align_labels(text, spans, TOK)
    labels = [None if i == -100 else list(LABEL2ID)[i] for i in ids]  # id -> label str
    # specials are -100; the first content token of "jose" is B-GIVEN_NAME
    assert labels[0] is None                      # [CLS]
    assert "B-GIVEN_NAME" in labels
    assert "B-SURNAME" in labels
    assert labels[-1] is None                     # [SEP]
