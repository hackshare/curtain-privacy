"""Keep-negative augmentation: rows where order/reference codes and keep-set items
(city/state) appear as plain O text next to a real redactable name, so the model
learns NOT to redact them.

This counters two biases the positive-only augmentation introduced: the gov-id
synthesizer taught "prefixed LETTER-DIGIT code -> GOVERNMENT_ID" with no
counter-example, so the model over-generalized to order/reference codes; and the
messy augmentation added redactable field-style text with no matching keep text.
Each negative row pairs a redact GIVENNAME/SURNAME (so the row still carries a
learnable redact signal) with an order code and/or city/state left untagged (O).
"""
from __future__ import annotations
import random
import string
from faker import Faker
from augment.rows import build_from_parts, AUG_UID_BASE

# Diverse Latin-script locales, matching the name augmenter and the fairness eval,
# so the keep-negatives cover diverse names and cities rather than en-US only (an
# en-US-skewed negative set over-redacts diverse keeps and misses diverse names).
LOCALES = ["es_ES", "es_MX", "fr_FR", "de_DE", "it_IT", "pt_BR", "nl_NL",
           "pl_PL", "cs_CZ", "tr_TR", "hu_HU", "ro_RO", "hr_HR", "sk_SK", "en_US"]
_CODE_PREFIXES = ["ORD", "INV", "TKT", "REF", "PAY", "VEND", "SEC", "CASE", "PO", "WO", "RMA", "APPT"]
# US state abbreviations: the keep-set is US states, so states stay US even when the
# city/name are drawn from a diverse locale.
_STATES = ["CA", "TX", "FL", "NY", "OR", "CO", "NV", "OH", "AZ", "GA", "WA", "IL", "PA", "MA", "NC"]

# Each template is a callable returning a build_from_parts `parts` list. The name
# is the only redact span (GIVENNAME + SURNAME); the code, city, and state are
# left as None-label O text. '#'/'ref:' markers mirror the real order codes that
# must be kept.
_TEMPLATES = [
    lambda code, g, s, city, state: [
        (f"please ship order #{code} to ", None), (g, "GIVENNAME"), (" ", None), (s, "SURNAME")],
    lambda code, g, s, city, state: [
        (f"ref:{code} payment processed for ", None), (g, "GIVENNAME"), (" ", None), (s, "SURNAME")],
    lambda code, g, s, city, state: [
        (f"ticket #{code} opened by ", None), (g, "GIVENNAME"), (" ", None), (s, "SURNAME"),
        (f" in {city} {state}", None)],
    lambda code, g, s, city, state: [
        (f"invoice {code} billed to ", None), (g, "GIVENNAME"), (" ", None), (s, "SURNAME"),
        (f", city {city} {state}", None)],
    lambda code, g, s, city, state: [
        (f"case #{code}: follow up with ", None), (g, "GIVENNAME"), (" ", None), (s, "SURNAME")],
    lambda code, g, s, city, state: [
        (f"delivery {code} for ", None), (g, "GIVENNAME"), (" ", None), (s, "SURNAME"),
        (f" arrives in {city} {state}", None)],
]


def _code(rng: random.Random) -> str:
    prefix = rng.choice(_CODE_PREFIXES)
    digits = "".join(rng.choice(string.digits) for _ in range(rng.choice([4, 4, 5, 6])))
    return f"{prefix}-{digits}"


def synth_negative_rows(seed: int, n: int) -> list[dict]:
    faker = Faker(LOCALES)
    faker.seed_instance(seed)
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        tmpl = rng.choice(_TEMPLATES)
        g, s = faker.first_name(), faker.last_name()
        city, state = faker.city(), rng.choice(_STATES)
        parts = tmpl(_code(rng), g, s, city, state)
        rows.append(build_from_parts(AUG_UID_BASE + 700_000 + i, "en", parts))
    return rows
