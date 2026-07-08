"""Synthesize messy chat rows containing a custom-prefixed government ID next to an
identity cue, so the model learns the class instead of leaving it purely contextual."""
from __future__ import annotations
import random
import string
from augment.rows import build_from_parts, GOVID_LABEL, AUG_UID_BASE

_PREFIXES = ["EMP", "NIN", "AGN", "GOV", "STF", "MED", "RSN", "BEN", "AGT", "ENT", "VET", "GV", "STAFF"]
# (cue phrase, template halves around the id) — cue guarantees an identity signal.
_TEMPLATES = [
    ("emp id", "emp id:{id} dept:Finance start:01/15/2024"),
    ("government id", "My government ID is {id} and I want to link my account."),
    ("state agency number", "My state agency number is {id}. Filing a claim today."),
    ("staff badge", "staff badge:{id} clearance:Level 2 site:Portland OR"),
    ("resident id", "Resident ID: {id}, issued last spring."),
    ("employee id", "please verify employee ID {id} for access"),
    ("government id", "Beneficiary record, government ID {id}, eligible this year."),
]


def _make_id(rng: random.Random) -> str:
    prefix = rng.choice(_PREFIXES)
    digits = "".join(rng.choice(string.digits) for _ in range(rng.choice([6, 6, 7, 8])))
    sep = "-" if rng.random() < 0.8 else ""
    return f"{prefix}{sep}{digits}"


def synth_govid_rows(seed: int, n: int) -> list[dict]:
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        gid = _make_id(rng)
        _cue, tmpl = rng.choice(_TEMPLATES)
        before, after = tmpl.split("{id}")
        row = build_from_parts(
            AUG_UID_BASE + 500_000 + i, "en",
            [(before, None), (gid, GOVID_LABEL), (after, None)],
        )
        rows.append(row)
    return rows
