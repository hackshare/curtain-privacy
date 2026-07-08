"""Held-out fairness eval: diverse Latin-script names in chat templates, emitted in
the eval/real case shape with OUR taxonomy labels. Seed is disjoint from the
augmentation name seed so the model cannot have memorized these names."""
from __future__ import annotations
import argparse
import json
import pathlib
import random
from faker import Faker

LOCALES = ["es_ES", "es_MX", "fr_FR", "de_DE", "it_IT", "pt_BR", "nl_NL",
           "pl_PL", "cs_CZ", "tr_TR", "hu_HU", "ro_RO", "hr_HR", "sk_SK"]

# (tier, template). {g}=given, {s}=surname, {city}/{state}/{zip} are keeps.
_TEMPLATES = [
    ("normal", "Hi, my name is {g} {s} and I live in {city}, {state} {zip}."),
    ("normal", "Please update the account for {g} {s} in {city}."),
    ("messy", "acct holder:{g} {s} city:{city} {state} status:active"),
    ("messy", "ticket from {g} {s}, resident id RSN-{d}, {city} {state}"),
]


def generate_cases(seed: int, n: int) -> list[dict]:
    faker = Faker(LOCALES)
    faker.seed_instance(seed)
    rng = random.Random(seed)
    cases = []
    for i in range(n):
        tier, tmpl = _TEMPLATES[i % len(_TEMPLATES)]
        g, s = faker.first_name(), faker.last_name()
        city, state = faker.city(), "CA"
        zc = f"{rng.randint(90000, 96999)}"
        d = f"{rng.randint(100000, 999999)}"
        text = tmpl.format(g=g, s=s, city=city, state=state, zip=zc, d=d)
        redact = [{"label": "GIVEN_NAME", "value": g}, {"label": "SURNAME", "value": s}]
        if "RSN-" in text:
            redact.append({"label": "GOVERNMENT_ID", "value": f"RSN-{d}"})
        keep = []
        if city in text:
            keep.append({"value": city})
        if state in text:
            keep.append({"value": state})
        if zc in text:
            keep.append({"value": zc})
        # Skip a case if a name collides with the city/state substring (keeps resolution clean).
        if any(t["value"] in (city, state) for t in redact):
            continue
        cases.append({"id": f"fair-{i:03d}", "tier": tier, "text": text,
                      "redact": redact, "keep": keep})
    return cases


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=100)
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--out", default=str(pathlib.Path(__file__).with_name("cases.jsonl")))
    a = ap.parse_args()
    cases = generate_cases(a.seed, a.n)
    pathlib.Path(a.out).write_text("\n".join(json.dumps(c) for c in cases) + "\n")
    print(f"wrote {len(cases)} fairness cases -> {a.out}")
