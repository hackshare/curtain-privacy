"""Part A of the long-name recall probe: per name-length bucket, does the model's
argmax tag the trailing subword of a gold person name correctly? Token-space and
self-consistent; it does not compare to the shipped span-F1 (that is Part B)."""
from __future__ import annotations
import numpy as np
from labels import ID2LABEL
from decode_probe import gold_spans

PERSON_ENTS = {"GIVEN_NAME", "SURNAME"}


def is_person(tag_id) -> bool:
    t = ID2LABEL[int(tag_id)]
    return (t.startswith("B-") or t.startswith("I-")) and t[2:] in PERSON_ENTS


def person_spans(gold: np.ndarray) -> list[tuple[int, int]]:
    return [(s, e) for (s, e) in gold_spans(gold) if ID2LABEL[int(gold[s])][2:] in PERSON_ENTS]


def length_bucket(n: int) -> str:
    if n <= 4:
        return "1-4"
    if n == 5:
        return "5"
    if n == 6:
        return "6"
    return "7+"


def classify_span(gold, argmax_p, s: int, e: int) -> dict:
    return {
        "bucket": length_bucket(e - s + 1),
        "trailing_person": is_person(argmax_p[e]),
        "trailing_exact": int(argmax_p[e]) == int(gold[e]),
        "full_ok": list(argmax_p[s : e + 1]) == list(gold[s : e + 1]),
    }


def gen_long_name_rows(n: int, seed: int) -> list[dict]:
    """Faker names across the augmentation locales, wrapped in a template, in raw
    OpenPII shape ({source_text, privacy_mask:[{label,start,end,value}]}). Length
    bucketing later sorts them; diverse locales populate the 5+ buckets."""
    from faker import Faker
    LOCALES = ["es_ES", "es_MX", "fr_FR", "de_DE", "it_IT", "pt_BR", "nl_NL",
               "pl_PL", "cs_CZ", "tr_TR", "hu_HU", "ro_RO", "hr_HR", "sk_SK"]
    faker = Faker(LOCALES)
    faker.seed_instance(seed)
    rows = []
    for i in range(n):
        g, s = faker.first_name(), faker.last_name()
        pre = "My name is "
        text = f"{pre}{g} {s}."
        gs = len(pre)
        ss = gs + len(g) + 1
        rows.append({
            "uid": 10_000_000 + i, "language": "xx", "source_text": text,
            "privacy_mask": [
                {"label": "GIVENNAME", "start": gs, "end": gs + len(g), "value": g},
                {"label": "SURNAME", "start": ss, "end": ss + len(s), "value": s},
            ],
        })
    return rows


def main() -> None:
    import argparse, json, os
    from collections import defaultdict
    import onnxruntime as ort
    from transformers import AutoTokenizer
    from decode_probe import row_emission_gold

    ap = argparse.ArgumentParser()
    ap.add_argument("--built", required=True, help="build-dataset output jsonl ({spans, text})")
    ap.add_argument("--source", required=True, help="label for this run, e.g. real or generator")
    ap.add_argument("--model", default="runs/model-ship")
    ap.add_argument("--out", default="runs/long-name-probe/partA.json")
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(args.model)
    sess = ort.InferenceSession(f"{args.model}/onnx/model.onnx")
    input_names = {i.name for i in sess.get_inputs()}

    agg = defaultdict(lambda: {"n": 0, "trailing_person": 0, "trailing_exact": 0, "full_ok": 0})
    for line in open(args.built):
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        E, g = row_emission_gold(row["text"], row["spans"], tok, sess, input_names)
        if E is None:
            continue
        argmax_p = E.argmax(axis=1)
        for s, e in person_spans(g):
            c = classify_span(g, argmax_p, s, e)
            b = agg[c["bucket"]]
            b["n"] += 1
            b["trailing_person"] += int(c["trailing_person"])
            b["trailing_exact"] += int(c["trailing_exact"])
            b["full_ok"] += int(c["full_ok"])

    report = {"source": args.source, "buckets": {}}
    for bucket in ["1-4", "5", "6", "7+"]:
        b = agg[bucket]
        n = b["n"] or 1
        report["buckets"][bucket] = {
            "n_spans": b["n"],
            "trailing_person_rate": b["trailing_person"] / n,
            "trailing_exact_rate": b["trailing_exact"] / n,
            "full_span_argmax_rate": b["full_ok"] / n,
        }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    json.dump(report, open(args.out, "w"), indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
