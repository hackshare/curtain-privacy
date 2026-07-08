"""Diverse-name augmentation: replace person-name span values with Faker names
across diverse Latin-script locales, recomputing all offsets."""
from __future__ import annotations
from faker import Faker
from augment.rows import PERSON_LABELS, assert_spans_exact

# Latin-script locales spanning diverse naming traditions.
LOCALES = ["es_ES", "es_MX", "fr_FR", "de_DE", "it_IT", "pt_BR", "nl_NL",
           "pl_PL", "cs_CZ", "tr_TR", "hu_HU", "ro_RO", "hr_HR", "sk_SK", "en_US"]


def _new_value(faker: Faker, label: str) -> str:
    return faker.first_name() if label == "GIVENNAME" else faker.last_name()


def swap_names(row: dict, seed: int) -> dict:
    """Return a new row with GIVENNAME/SURNAME values replaced by Faker names.
    Offsets for all spans are recomputed from the running length delta."""
    spans = sorted(row["privacy_mask"], key=lambda s: s["start"])
    if not any(s["label"] in PERSON_LABELS for s in spans):
        return row
    faker = Faker(LOCALES)
    faker.seed_instance(seed + row["uid"])

    src = row["source_text"]
    out_text = ""
    cursor = 0
    new_spans = []
    for s in spans:
        out_text += src[cursor:s["start"]]
        start = len(out_text)
        if s["label"] in PERSON_LABELS:
            value = _new_value(faker, s["label"])
        else:
            value = src[s["start"]:s["end"]]
        out_text += value
        new_spans.append({"label": s["label"], "start": start, "end": len(out_text), "value": value})
        cursor = s["end"]
    out_text += src[cursor:]

    result = {"uid": row["uid"], "language": row["language"],
              "source_text": out_text, "privacy_mask": new_spans}
    assert_spans_exact(result)
    return result
