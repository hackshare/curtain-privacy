"""Leading-subject narrative augmentation: synthesize short action narratives in
which a person is named in subject position and repeated across the sentence. The
base data and the value-swap augmentation under-represent this, and the base model
tags the object name but misses the sentence subject (e.g. "Johnny hit Timmy ...
but Johnny ran" redacts Timmy and leaks Johnny). These rows give the retrain that
structure directly. Names come from the shared sampler, so the CJK/short pool is
exercised in subject position too."""
from __future__ import annotations
import random
from faker import Faker
from augment.names import sample_person_name, sample_filipino_name, LOCALES
from augment.rows import build_from_parts, AUG_UID_BASE

# Narrative uids sit above the swap/govid/negative ranges (base+0, +500k, +700k).
_NARRATIVE_UID_BASE = AUG_UID_BASE + 900_000

# Each template is a list of tokens: a str is literal text; a ("key",) tuple is a
# name slot. g* -> GIVENNAME, s* -> SURNAME. The subject (g1/s1) leads and repeats.
TEMPLATES = [
    [("g1",), " ", ("s1",), " hit ", ("g2",), " ", ("s2",), " and ", ("g2",),
     " fell over, but ", ("g1",), " kept going."],
    [("g1",), " ", ("s1",), " chased ", ("g2",), " until ", ("g2",), " stopped, then ",
     ("g1",), " walked away."],
    ["Earlier ", ("g1",), " met ", ("g2",), " ", ("s2",), ", and later ", ("g1",),
     " called ", ("g2",), " again."],
    [("g1",), " ", ("s1",), " told the officer that ", ("g2",), " left first, but ",
     ("g1",), " stayed behind."],
    ["According to the report, ", ("g1",), " pushed ", ("g2",), " before ", ("g1",),
     " ran off."],
    [("g1",), " paid ", ("g2",), " ", ("s2",), " on Friday, and ", ("g1",),
     " thanked ", ("g2",), " for the help."],
    [("g1",), " ", ("s1",), " and ", ("g2",), " ", ("s2",), " argued, then ", ("g1",),
     " apologized to ", ("g2",), "."],
    ["When ", ("g1",), " arrived, ", ("g2",), " was already there, so ", ("g1",),
     " waited for ", ("g2",), " ", ("s2",), "."],
]


def _label_for(key: str) -> str:
    return "GIVENNAME" if key.startswith("g") else "SURNAME"


def _expand(template: list, names: dict) -> list[tuple[str, str | None]]:
    parts: list[tuple[str, str | None]] = []
    for tok in template:
        if isinstance(tok, tuple):
            parts.append((names[tok[0]], _label_for(tok[0])))
        else:
            parts.append((tok, None))
    return parts


# Narratives put a mix of CJK/short and diverse-Latin names in subject position, so
# the leading-subject signal covers both.
_NARRATIVE_CJK_FRAC = 0.5


def _sample_people(faker: Faker, rng: random.Random) -> dict:
    g1 = sample_person_name(faker, rng, "GIVENNAME", _NARRATIVE_CJK_FRAC)
    s1 = sample_person_name(faker, rng, "SURNAME", _NARRATIVE_CJK_FRAC)
    g2 = sample_person_name(faker, rng, "GIVENNAME", _NARRATIVE_CJK_FRAC)
    while g2 == g1:  # keep the two people distinct so subject/object stay legible
        g2 = sample_person_name(faker, rng, "GIVENNAME", _NARRATIVE_CJK_FRAC)
    s2 = sample_person_name(faker, rng, "SURNAME", _NARRATIVE_CJK_FRAC)
    return {"g1": g1, "s1": s1, "g2": g2, "s2": s2}


def synth_narrative_rows(seed: int, n: int) -> list[dict]:
    """`n` synthetic leading-subject narratives with exact spans on every name
    occurrence. Deterministic under `seed`."""
    faker = Faker(LOCALES)
    faker.seed_instance(seed)
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        names = _sample_people(faker, rng)
        template = rng.choice(TEMPLATES)
        rows.append(build_from_parts(_NARRATIVE_UID_BASE + i, "en", _expand(template, names)))
    return rows


# Speaker-label uids sit above the narrative range.
_SPEAKER_UID_BASE = AUG_UID_BASE + 1_300_000

# Speaker-label / Filipino-chat templates: a name in speaker-prefix, endearment, or
# repeated-subject position. This is the Tagalog convention that leaks (a first name
# alone before ":" or "(M)", or a common-noun nickname like "Princess:"). Only g1/s1
# are used, filled from the Filipino pool.
SPEAKER_TEMPLATES = [
    [("g1",), ": ", "Sige po, aandar na ako mamaya. Salamat!"],
    [("g1",), " (M): ", "Tapos na ang report kahapon."],
    [("g1",), " (F): ", "Nakatanggap ako ng bagong email ngayon."],
    ["Mahal kong ", ("g1",), ", kumusta ka na diyan?"],
    [("g1",), " ", ("s1",), ": ", "Naghihintay pa rin kami sa opisina."],
    ["Kontakin si ", ("g1",), " ", ("s1",), " para sa mga detalye."],
    [("g1",), ": Oo, pwede. ", ("g1",), ": Sige, pupunta ako."],
    ["Mga sangkot: ", ("g1",), " (M), ", ("g1",), " (M). Kailangan ng follow-up."],
    ["Dear ", ("g1",), " ", ("s1",), ", salamat sa iyong sulat kahapon."],
    ["11:33 ", ("g1",), ": Mag-check muna tayo bukas."],
]


def synth_speaker_rows(seed: int, n: int) -> list[dict]:
    """`n` Filipino speaker-label / chat rows: a name in speaker-prefix, endearment,
    or repeated-subject position, the Tagalog convention that leaks in chat text.
    Deterministic under `seed`."""
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        names = {"g1": sample_filipino_name(rng, "GIVENNAME"), "s1": sample_filipino_name(rng, "SURNAME")}
        template = rng.choice(SPEAKER_TEMPLATES)
        rows.append(build_from_parts(_SPEAKER_UID_BASE + i, "tl", _expand(template, names)))
    return rows
