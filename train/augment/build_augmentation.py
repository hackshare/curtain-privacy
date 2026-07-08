"""Assemble the augmentation set: name-swapped + messified OpenPII rows, synthesized
gov-id rows, and the verified realism seed. Every emitted row is label-safe and
carries a synthetic uid disjoint from the eval-30k manifest."""
from __future__ import annotations
import json
import pathlib
import random
from augment.names import swap_names
from augment.messy import messify
from augment.govid import synth_govid_rows
from augment.negatives import synth_negative_rows
from augment.verify import verify_row
from augment.rows import assert_spans_exact, AUG_UID_BASE

_SEED_FILE = pathlib.Path(__file__).with_name("realism_seed.jsonl")


def _load_seed() -> list[dict]:
    rows = [json.loads(l) for l in _SEED_FILE.read_text().splitlines() if l.strip()]
    return [r for r in (verify_row(x) for x in rows) if r is not None]


def build_augmentation(base_rows: list[dict], seed: int, name_frac: float,
                       messy_frac: float, n_govid: int, n_neg: int = 0) -> list[dict]:
    rng = random.Random(seed)
    out: list[dict] = []
    for i, row in enumerate(base_rows):
        r = row
        if rng.random() < name_frac:
            r = swap_names(r, seed)
        if rng.random() < messy_frac:
            r = messify(r, seed)
        # Re-key onto a synthetic uid so the augmented copy is disjoint from eval-30k.
        r = {**r, "uid": AUG_UID_BASE + i}
        assert_spans_exact(r)
        out.append(r)
    out.extend(synth_govid_rows(seed, n_govid))
    out.extend(synth_negative_rows(seed, n_neg))
    out.extend(_load_seed())
    return out


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="OpenPII base rows jsonl")
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--name-frac", type=float, default=0.6)
    ap.add_argument("--messy-frac", type=float, default=0.4)
    ap.add_argument("--n-govid", type=int, default=4000)
    ap.add_argument("--n-neg", type=int, default=0)
    a = ap.parse_args()
    base = [json.loads(l) for l in pathlib.Path(a.base).read_text().splitlines() if l.strip()]
    rows = build_augmentation(base, a.seed, a.name_frac, a.messy_frac, a.n_govid, a.n_neg)
    pathlib.Path(a.out).write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    print(f"wrote {len(rows)} augmentation rows -> {a.out}")
