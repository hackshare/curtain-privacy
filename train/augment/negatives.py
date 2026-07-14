"""Keep-negative augmentation: rows where order/reference codes and keep-set items
(city/state, incl. full state names and months) appear as plain O text next to a
real redactable name, so the model learns NOT to redact them.

This counters biases the positive-only augmentation introduces: the gov-id
synthesizer teaches "prefixed LETTER-DIGIT code -> GOVERNMENT_ID" with no
counter-example; the messy augmentation adds redactable field text with no matching
keep text; and the name augmentation (diverse + CJK/short pool) makes the model
name-aggressive, so capitalized geo/month words (Florida, Baltimore, April) tip into
"name" unless shown as keep-context. Each row pairs a redact GIVENNAME/SURNAME with a
code and geo/month left untagged (O)."""
from __future__ import annotations
import random
import string
from faker import Faker
from augment.rows import build_from_parts, AUG_UID_BASE

# Diverse Latin-script locales, matching the name augmenter and the fairness eval,
# so the keep-negatives cover diverse names and cities rather than en-US only.
LOCALES = ["es_ES", "es_MX", "fr_FR", "de_DE", "it_IT", "pt_BR", "nl_NL",
           "pl_PL", "cs_CZ", "tr_TR", "hu_HU", "ro_RO", "hr_HR", "sk_SK", "en_US"]
# Real reference-code prefixes seen in the wild, incl. the ones the eval keeps
# (WAF/PLT/INC/CAL) so the model learns them as O rather than GOVERNMENT_ID.
_CODE_PREFIXES = ["ORD", "INV", "TKT", "REF", "PAY", "VEND", "SEC", "CASE", "PO",
                  "WO", "RMA", "APPT", "WAF", "PLT", "INC", "CAL", "AUD", "REQ"]
# State abbreviations AND full names: the keep-set is US states, and the model was
# only ever shown abbreviations, so full state names had no keep-signal.
_STATES = ["CA", "TX", "FL", "NY", "OR", "CO", "NV", "OH", "AZ", "GA", "WA", "IL", "PA", "MA", "NC"]
_STATE_NAMES = ["Florida", "Oregon", "Texas", "California", "Ohio", "Nevada",
                "Colorado", "Arizona", "Maryland", "Michigan", "Illinois",
                "Montana", "Kansas", "Nebraska", "Utah", "Idaho", "Missouri",
                "Kentucky", "Tennessee", "Oklahoma", "Minnesota", "Wisconsin"]
# Common US cities the model must keep, incl. name-like ones (Baltimore, Richmond).
_US_CITIES = ["Baltimore", "Portland", "Austin", "Denver", "Phoenix", "Seattle",
              "Boston", "Atlanta", "Miami", "Dallas", "Columbus", "Nashville",
              "Sacramento", "Cleveland", "Detroit", "Memphis", "Milwaukee",
              "Tucson", "Omaha", "Raleigh", "Richmond", "Buffalo"]
_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December"]

# Each template takes a fillers dict `f` and returns a build_from_parts `parts` list.
# GIVENNAME + SURNAME are the only redact spans; code, city, state, month are O.
# Every template carries a code so the "code stays O" signal is on every row.
_TEMPLATES = [
    lambda f: [(f"please ship order #{f['code']} to ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME")],
    lambda f: [(f"ref:{f['code']} payment processed for ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME")],
    lambda f: [(f"ticket #{f['code']} opened by ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME"), (f" in {f['city']} {f['state']}", None)],
    lambda f: [(f"invoice {f['code']} billed to ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME"), (f", city {f['city']} {f['state']}", None)],
    lambda f: [(f"case #{f['code']}: follow up with ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME")],
    lambda f: [(f"delivery {f['code']} for ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME"), (f" arrives in {f['city']} {f['state']}", None)],
    # geo/month keep-context (full state names, US cities, months), each with a code:
    lambda f: [(f"case #{f['code']} for ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME"), (f" filed in {f['us_city']}, {f['state_name']} last {f['month']}", None)],
    lambda f: [(f"the {f['month']} report #{f['code']} from {f['us_city']}, {f['state_name']} lists ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME")],
    lambda f: [(f"appt #{f['code']} in {f['state_name']}: contact ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME"), (f" this {f['month']}", None)],
    lambda f: [(f"{f['us_city']} office (ref:{f['code']}) in {f['state_name']} — ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME")],
    lambda f: [(f"refund #{f['code']} of ${f['amount']} issued to ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME"), (f" in {f['us_city']}, {f['state_name']}", None)],
    # diverse-locale city (faker, many locales) followed by a state abbreviation --
    # the exact pattern the fairness set exposed, where the name-aggressive model
    # read the city (Michel, Nova Gradiska, Saint Theophile) as a person name and
    # swept the state into the span. Varied phrasings so it learns the context, not
    # one template.
    lambda f: [("Hi, my name is ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME"), (f" and I live in {f['city']}, {f['state']} {f['zip']}", None)],
    lambda f: [("ticket from ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME"), (f", resident id {f['code']}, {f['city']} {f['state']}", None)],
    lambda f: [("acct holder:", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME"), (f" city:{f['city']} {f['state']} status:active", None)],
    lambda f: [("update the account for ", None), (f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME"), (f" in {f['city']}, {f['state']} {f['zip']}", None)],
    lambda f: [(f['g'], "GIVENNAME"), (" ", None), (f['s'], "SURNAME"), (f" moved to {f['city']}, {f['state']} {f['zip']} last spring", None)],
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
        f = {
            "code": _code(rng),
            "g": faker.first_name(), "s": faker.last_name(),
            "city": faker.city(), "state": rng.choice(_STATES),
            "state_name": rng.choice(_STATE_NAMES),
            "us_city": rng.choice(_US_CITIES),
            "month": rng.choice(_MONTHS),
            "amount": rng.choice(["89", "210", "310", "450", "1,250", "1200", "75", "980"]),
            "zip": str(rng.randint(90000, 96999)),
        }
        rows.append(build_from_parts(AUG_UID_BASE + 700_000 + i, "en", tmpl(f)))
    return rows
