"""Name augmentation. Two swappers over the same offset-safe machinery:

- swap_names: replaces person-name values with diverse Latin-script Faker names.
  This is v1's diet; the main pass uses it so the full multilingual name coverage
  is preserved (redirecting this budget to CJK names was what regressed diverse-
  language recall).
- swap_cjk_names: replaces with romanized-CJK / short names from the curated pool.
  Used to add CJK exposure as EXTRA rows on top of the Faker pass, not by spending
  the Faker budget.
"""
from __future__ import annotations
import random
from faker import Faker
from augment.rows import PERSON_LABELS, assert_spans_exact

# Latin-script locales spanning diverse naming traditions.
LOCALES = ["es_ES", "es_MX", "fr_FR", "de_DE", "it_IT", "pt_BR", "nl_NL",
           "pl_PL", "cs_CZ", "tr_TR", "hu_HU", "ro_RO", "hr_HR", "sk_SK", "en_US"]

# Romanized East/South/Southeast-Asian and short names the Faker Latin locales
# under-produce. Single tokens, so offsets stay simple.
_CURATED_GIVEN = [
    "Wei", "Li", "Ming", "Jun", "Hao", "Yan", "Xin", "Lei", "Feng", "Jing",
    "Mei", "Fang", "Ling", "Hui", "Bo", "Yu", "Ning", "Rong",
    "Min", "Hyun", "Ji", "Seo", "Woo", "Yeon", "Jin", "Eun", "Soo", "Hana",
    "Yuki", "Haruki", "Ren", "Aoi", "Sota", "Hina", "Yui", "Riku", "Kaito", "Sakura",
    "Priya", "Arjun", "Sanjay", "Aisha", "Rahul", "Neha", "Omar", "Fatima",
    "Anh", "Linh", "Minh", "Huy", "Thao", "Nam",
    "Joe", "Sam", "Ben", "Tom", "Ann", "Ed", "Al", "Ray", "Bob", "Meg",
    "Jo", "Kai", "Uma", "Ike", "Sue", "Gus", "Jed",
]
_CURATED_SURNAME = [
    "Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou",
    "Xu", "Sun", "Ma", "Zhu", "Hu", "Guo", "Lin", "Gao", "Luo",
    "Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Han",
    "Oh", "Shin", "Lim",
    "Tanaka", "Sato", "Suzuki", "Takahashi", "Watanabe", "Ito", "Yamamoto",
    "Nakamura", "Kobayashi", "Kato",
    "Patel", "Singh", "Kumar", "Sharma", "Rao", "Gupta",
    "Nguyen", "Tran", "Le", "Pham", "Hoang",
    "Ng", "Xu", "Ho", "Tan", "Yeo", "Ba", "Fu", "Cox", "Fox", "Day",
]


def sample_person_name(faker: Faker, rng: random.Random, label: str, curated_frac: float) -> str:
    """A given or surname, drawn from the curated CJK/short pool with probability
    `curated_frac` else from the Faker Latin locales. `rng` drives the choice
    (Faker's multi-locale proxy has no `.random`); both are seeded, so it is
    deterministic."""
    given = label == "GIVENNAME"
    if rng.random() < curated_frac:
        return rng.choice(_CURATED_GIVEN if given else _CURATED_SURNAME)
    return faker.first_name() if given else faker.last_name()


def _swap(row: dict, seed: int, pick) -> dict:
    """Replace each person-span value via pick(faker, rng, label), recomputing all
    offsets from the running length delta. Non-person spans are copied verbatim."""
    spans = sorted(row["privacy_mask"], key=lambda s: s["start"])
    if not any(s["label"] in PERSON_LABELS for s in spans):
        return row
    faker = Faker(LOCALES)
    faker.seed_instance(seed + row["uid"])
    rng = random.Random(seed + row["uid"])

    src = row["source_text"]
    out_text = ""
    cursor = 0
    new_spans = []
    for s in spans:
        out_text += src[cursor:s["start"]]
        start = len(out_text)
        value = pick(faker, rng, s["label"]) if s["label"] in PERSON_LABELS else src[s["start"]:s["end"]]
        out_text += value
        new_spans.append({"label": s["label"], "start": start, "end": len(out_text), "value": value})
        cursor = s["end"]
    out_text += src[cursor:]

    result = {"uid": row["uid"], "language": row["language"],
              "source_text": out_text, "privacy_mask": new_spans}
    assert_spans_exact(result)
    return result


def swap_names(row: dict, seed: int) -> dict:
    """Diverse Latin-script Faker swap (v1 diet): preserves full multilingual name
    coverage."""
    return _swap(row, seed, lambda faker, rng, label: faker.first_name() if label == "GIVENNAME" else faker.last_name())


def swap_cjk_names(row: dict, seed: int) -> dict:
    """Swap person names to romanized-CJK / short names. For EXTRA rows added on top
    of the Faker pass, so CJK exposure does not spend the diverse-Latin budget."""
    return _swap(row, seed, lambda faker, rng, label: sample_person_name(faker, rng, label, curated_frac=1.0))
