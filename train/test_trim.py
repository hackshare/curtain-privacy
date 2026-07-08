from transformers import BertTokenizerFast
from collections import Counter
from trim import choose_keep

TOK = BertTokenizerFast.from_pretrained("runs/ckpt-sp2c3/checkpoint-52656")

def test_keep_includes_all_specials_and_single_chars_and_hits_target():
    freq = Counter(TOK("invoice for john smith at 123 main st", add_special_tokens=False)["input_ids"])
    keep = choose_keep(TOK, freq, target=19730)
    keep_set = set(keep)
    # all special ids kept
    assert set(TOK.all_special_ids) <= keep_set
    # all single-character pieces kept (so any text still tokenizes)
    vocab = TOK.get_vocab()
    for piece, i in vocab.items():
        core = piece[2:] if piece.startswith("##") else piece
        if len(core) == 1:
            assert i in keep_set, f"dropped single-char piece {piece!r}"
    # target respected and ids are the original ids, sorted
    assert len(keep) <= 19730
    assert keep == sorted(keep)
