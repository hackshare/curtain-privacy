import random
from faker import Faker
from augment.names import swap_names, swap_cjk_names, sample_person_name, LOCALES, _CURATED_GIVEN, _CURATED_SURNAME
from augment.rows import assert_spans_exact

BASE = {
    "uid": 5, "language": "en",
    "source_text": "Hi, I am John Smith and my email is a@b.com.",
    "privacy_mask": [
        {"label": "GIVENNAME", "start": 9, "end": 13, "value": "John"},
        {"label": "SURNAME", "start": 14, "end": 19, "value": "Smith"},
        {"label": "EMAIL", "start": 36, "end": 43, "value": "a@b.com"},
    ],
}


def test_base_fixture_is_valid():
    assert_spans_exact(BASE)

def test_swap_changes_names_keeps_spans_exact():
    row = {**BASE, "privacy_mask": [dict(s) for s in BASE["privacy_mask"]]}
    out = swap_names(row, seed=1)
    assert_spans_exact(out)                    # offsets recomputed correctly
    names = [s["value"] for s in out["privacy_mask"] if s["label"] in ("GIVENNAME", "SURNAME")]
    assert names != ["John", "Smith"]          # names actually changed
    assert "GIVENNAME" in [s["label"] for s in out["privacy_mask"]]

def test_swap_is_deterministic():
    a = swap_names({**BASE, "privacy_mask": [dict(s) for s in BASE["privacy_mask"]]}, seed=7)
    b = swap_names({**BASE, "privacy_mask": [dict(s) for s in BASE["privacy_mask"]]}, seed=7)
    assert a["source_text"] == b["source_text"]

def test_swap_leaves_rows_without_names_unchanged():
    row = {"uid": 1, "language": "en", "source_text": "no names here",
           "privacy_mask": []}
    assert swap_names(row, seed=1)["source_text"] == "no names here"

def test_curated_pool_is_reachable_and_still_diverse():
    faker = Faker(LOCALES); faker.seed_instance(3)
    rng = random.Random(3)
    given = [sample_person_name(faker, rng, "GIVENNAME", 0.4) for _ in range(300)]
    surname = [sample_person_name(faker, rng, "SURNAME", 0.4) for _ in range(300)]
    assert any(g in _CURATED_GIVEN for g in given)      # curated names appear
    assert any(s in _CURATED_SURNAME for s in surname)
    assert len(set(given)) > 20                          # Faker still adds variety
    assert all(" " not in n for n in _CURATED_GIVEN + _CURATED_SURNAME)  # curated are single tokens

def test_sample_is_deterministic():
    fa = Faker(LOCALES); fa.seed_instance(11)
    fb = Faker(LOCALES); fb.seed_instance(11)
    a = [sample_person_name(fa, random.Random(11), "GIVENNAME", 0.5) for _ in range(50)]
    b = [sample_person_name(fb, random.Random(11), "GIVENNAME", 0.5) for _ in range(50)]
    assert a == b

def test_swap_names_is_faker_only_diverse():
    # The main swap must NOT pull from the curated pool (that displaces diverse-Latin).
    rows_given = set()
    for uid in range(60):
        row = {**BASE, "uid": uid, "privacy_mask": [dict(s) for s in BASE["privacy_mask"]]}
        out = swap_names(row, seed=1)
        for s in out["privacy_mask"]:
            if s["label"] == "GIVENNAME":
                rows_given.add(s["value"])
    assert rows_given, "no names produced"
    assert not (rows_given & set(_CURATED_GIVEN)), "swap_names leaked curated CJK names"

def test_swap_cjk_produces_curated_names():
    row = {**BASE, "privacy_mask": [dict(s) for s in BASE["privacy_mask"]]}
    out = swap_cjk_names(row, seed=1)
    assert_spans_exact(out)
    names = {s["value"] for s in out["privacy_mask"] if s["label"] in ("GIVENNAME", "SURNAME")}
    assert names <= set(_CURATED_GIVEN) | set(_CURATED_SURNAME), f"non-curated name: {names}"
