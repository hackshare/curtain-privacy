import copy
import json

from huggingface_hub import hf_hub_download
from transformers import AutoTokenizer, PreTrainedTokenizerFast

from trim_spm import choose_keep, latin_piece, prune_tokenizer


def test_latin_piece_classifies_scripts():
    assert latin_piece("▁Phước")  # Vietnamese precomposed diacritics (U+1Exx)
    assert latin_piece("▁José")
    assert latin_piece("▁Đurić")
    assert latin_piece("a")
    assert not latin_piece("中")  # CJK
    assert not latin_piece("▁Москва")  # Cyrillic
    assert not latin_piece("▁القاهرة")  # Arabic
    assert not latin_piece("▁")  # empty core (bare marker)


# id:            0            1              2            3            4        5              6            7
_VOCAB = [
    ["<s>", 0.0],
    ["▁the", -1.0],
    ["</s>", 0.0],
    ["<unk>", 0.0],
    ["中", -5.0],
    ["<mask>", 0.0],
    ["▁Phước", -8.0],
    ["国", -9.0],
]


def _fake_tj():
    return {
        "added_tokens": [
            {"id": 0, "content": "<s>"},
            {"id": 3, "content": "<unk>"},
            {"id": 5, "content": "<mask>"},
        ],
        "post_processor": {
            "type": "TemplateProcessing",
            "special_tokens": {
                "<s>": {"ids": [0]},
                "</s>": {"ids": [2]},
            },
        },
        "model": {"unk_id": 3, "vocab": copy.deepcopy(_VOCAB)},
    }


def test_choose_keep_keeps_latin_specials_and_corpus_drops_nonlatin():
    # 中 (id 4) is non-Latin but used in the corpus -> kept; 国 (id 7) is neither -> dropped.
    keep = choose_keep(_VOCAB, added_ids=[0, 3, 5], unk_id=3, corpus_ids=[4])
    assert keep == [0, 1, 2, 3, 4, 5, 6]
    assert 7 not in keep


def test_prune_tokenizer_remaps_every_id_reference():
    tj = _fake_tj()
    # Drop a MIDDLE id (中, 4) and the last (国, 7) so remapping is non-trivial.
    keep = [0, 1, 2, 3, 5, 6]
    prune_tokenizer(tj, keep)

    assert tj["model"]["vocab"] == [_VOCAB[i] for i in keep]
    assert "中" not in [p for p, _ in tj["model"]["vocab"]]
    assert tj["model"]["unk_id"] == 3
    # <mask> moved from id 5 -> new position 4.
    assert [at for at in tj["added_tokens"] if at["content"] == "<mask>"][0]["id"] == 4
    sp = tj["post_processor"]["special_tokens"]
    assert sp["<s>"]["ids"] == [0]
    assert sp["</s>"]["ids"] == [2]


def test_pruned_tokenizer_is_lossless_on_latin(tmp_path):
    """The whole point: keeping every Latin piece makes tokenization of Latin
    text byte-identical to the full tokenizer. Prune a real XLM-R tokenizer to
    its Latin sub-vocabulary and confirm identical output on multilingual names."""
    tj = json.load(open(hf_hub_download("xlm-roberta-base", "tokenizer.json")))
    keep = choose_keep(
        tj["model"]["vocab"],
        [at["id"] for at in tj.get("added_tokens", [])],
        tj["model"]["unk_id"],
        [],  # no corpus: Latin-only keep must be sufficient on its own
    )
    prune_tokenizer(tj, keep)
    json.dump(tj, open(tmp_path / "tokenizer.json", "w"))

    full = AutoTokenizer.from_pretrained("xlm-roberta-base")
    pruned = PreTrainedTokenizerFast(tokenizer_file=str(tmp_path / "tokenizer.json"))
    for text in [
        "Phước Tuấn Quảng",
        "José García",
        "Nurul binti Ahmad",
        "Ludwig Schmidt from Berlin",
        "Nikola Đurić in Zagreb",
        "Contact me today",
    ]:
        assert pruned.tokenize(text) == full.tokenize(text), text
