"""Stage 1 decode-headroom diagnostic: token-space recoverability of the model's
argmax under BIO-legal decoding. Self-consistent (the model's own emissions vs
gold BIO); it does not compare to the shipped span-F1 number (that is Stage 2, on
the bench scale).

For each gold span it asks: is argmax already right; else does forbidding illegal
transitions recover it (hard-Viterbi); else does a realistic span-continuation
bias over the model emissions recover it (the lever a tuned-bias Viterbi pulls);
else is it emission-limited (the model's emission for the gold tag is too weak for
any bounded transition pull to recover). The oracle is deliberately bounded: an
unbounded gold-reward path would trivially reproduce gold and measure nothing."""
from __future__ import annotations
import numpy as np
from labels import LABELS, ID2LABEL

_NEG = -1e9

# Span-continuation biases swept for the "tuned_recoverable" bucket (logit units
# added to every legal transition into an I- tag). The lever a tuned-bias Viterbi
# uses to keep a span going; if no bias in the sweep recovers a span, the gold
# tag's emission is too weak for a bounded transition decoder.
BIAS_SWEEP = [1.0, 2.0, 4.0, 8.0, 16.0]


def legal_transitions() -> np.ndarray:
    """LxL bool: legal[prev, cur]. I-X is legal only after B-X or I-X."""
    L = len(LABELS)
    legal = np.ones((L, L), dtype=bool)
    for cur in range(L):
        tag = ID2LABEL[cur]
        if not tag.startswith("I-"):
            continue  # O and B-X are legal from anything
        ent = tag[2:]
        for prev in range(L):
            ptag = ID2LABEL[prev]
            legal[prev, cur] = ptag == f"B-{ent}" or ptag == f"I-{ent}"
    return legal


def _start_penalty() -> np.ndarray:
    """Length-L vector: -inf for I-X tags (illegal at sequence start), else 0."""
    pen = np.zeros(len(LABELS))
    for k, tag in ID2LABEL.items():
        if tag.startswith("I-"):
            pen[k] = _NEG
    return pen


def _transition_scores(legal: np.ndarray, cont_bias: float) -> np.ndarray:
    """LxL transition scores: 0 for a legal transition, -inf for illegal, plus
    `cont_bias` added to every legal transition into an I- tag (span continuation)."""
    trans = np.where(legal, 0.0, _NEG)
    if cont_bias:
        for cur in range(len(LABELS)):
            if ID2LABEL[cur].startswith("I-"):
                trans[:, cur] = np.where(legal[:, cur], cont_bias, _NEG)
    return trans


def viterbi(emissions: np.ndarray, legal: np.ndarray, cont_bias: float = 0.0) -> np.ndarray:
    """Best legal BIO path maximizing summed emission + transition scores. With
    `cont_bias`=0 this is the hard-constrained (legal-only) decode."""
    T, L = emissions.shape
    trans = _transition_scores(legal, cont_bias)
    dp = np.full((T, L), _NEG)
    bp = np.zeros((T, L), dtype=int)
    dp[0] = emissions[0] + _start_penalty()
    for t in range(1, T):
        scores = dp[t - 1][:, None] + trans        # [prev, cur]
        bp[t] = np.argmax(scores, axis=0)
        dp[t] = scores[bp[t], np.arange(L)] + emissions[t]
    path = np.zeros(T, dtype=int)
    path[T - 1] = int(np.argmax(dp[T - 1]))
    for t in range(T - 1, 0, -1):
        path[t - 1] = bp[t, path[t]]
    return path


def gold_spans(gold: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive token ranges of each gold entity span (B-X followed by I-X*)."""
    spans: list[tuple[int, int]] = []
    i, T = 0, len(gold)
    while i < T:
        tag = ID2LABEL[int(gold[i])]
        if tag.startswith("B-"):
            ent = tag[2:]
            j = i + 1
            while j < T and ID2LABEL[int(gold[j])] == f"I-{ent}":
                j += 1
            spans.append((i, j - 1))
            i = j
        else:
            i += 1
    return spans


def bucket_spans(gold, argmax_p, hard_p, tuned_paths) -> dict[str, int]:
    """Assign each gold span to exactly one recoverability bucket, by precedence:
    argmax already correct; else the hard-constrained (legal-only) Viterbi recovers
    it; else some continuation-bias Viterbi in `tuned_paths` recovers it; else the
    emission is too weak for a bounded transition decoder to recover it."""
    counts = {"argmax_ok": 0, "legal_recovers": 0, "tuned_recoverable": 0, "emission_limited": 0}
    for s, e in gold_spans(gold):
        g = list(gold[s : e + 1])
        if list(argmax_p[s : e + 1]) == g:
            counts["argmax_ok"] += 1
        elif list(hard_p[s : e + 1]) == g:
            counts["legal_recovers"] += 1
        elif any(list(p[s : e + 1]) == g for p in tuned_paths):
            counts["tuned_recoverable"] += 1
        else:
            counts["emission_limited"] += 1
    return counts


def row_emission_gold(text, spans, tok, sess, input_names):
    """Per-row content-token emissions and gold BIO, sharing one encoding. Returns
    (E, g) with specials (gold -100) dropped, or (None, None) if no content tokens."""
    from prepare import align_labels
    enc = tok(text, return_offsets_mapping=True, truncation=True, max_length=512, return_tensors="np")
    feeds = {"input_ids": enc["input_ids"], "attention_mask": enc["attention_mask"]}
    if "token_type_ids" in input_names:
        feeds["token_type_ids"] = np.zeros_like(enc["input_ids"])
    logits = sess.run(None, feeds)[0][0]
    gold = np.array(align_labels(text, spans, tok, max_length=512))
    content = gold != -100
    if not content.any():
        return None, None
    return logits[content], gold[content]


def main() -> None:
    import argparse, json, os
    import onnxruntime as ort
    from transformers import AutoTokenizer

    ap = argparse.ArgumentParser()
    ap.add_argument("--built", required=True, help="build-dataset.ts output jsonl ({spans, text})")
    ap.add_argument("--model", default="runs/model-ship", help="exported model dir")
    ap.add_argument("--out", default="runs/decode-probe/stage1.json")
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(args.model)
    sess = ort.InferenceSession(f"{args.model}/onnx/model.onnx")
    input_names = {i.name for i in sess.get_inputs()}
    legal = legal_transitions()

    totals = {"argmax_ok": 0, "legal_recovers": 0, "tuned_recoverable": 0, "emission_limited": 0}
    n_gold = illegal_steps = total_steps = 0

    for line in open(args.built):
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        E, g = row_emission_gold(row["text"], row["spans"], tok, sess, input_names)
        if E is None:
            continue
        argmax_p = E.argmax(axis=1)
        hard_p = viterbi(E, legal, 0.0)
        tuned_paths = [viterbi(E, legal, b) for b in BIAS_SWEEP]
        c = bucket_spans(g, argmax_p, hard_p, tuned_paths)
        for k in totals:
            totals[k] += c[k]
        n_gold += sum(c.values())
        total_steps += max(0, len(argmax_p) - 1)
        illegal_steps += int(np.sum(~legal[argmax_p[:-1], argmax_p[1:]]))

    recoverable = totals["legal_recovers"] + totals["tuned_recoverable"]
    frac = recoverable / n_gold if n_gold else 0.0
    verdict = "CLOSE (no decode headroom)" if frac < 0.005 else "PROCEED to Stage 2"
    report = {
        **totals,
        "n_gold": n_gold,
        "recoverable": recoverable,
        "recoverable_frac": frac,
        "argmax_illegal_step_rate": (illegal_steps / total_steps) if total_steps else 0.0,
        "bias_sweep": BIAS_SWEEP,
        "verdict": verdict,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    json.dump(report, open(args.out, "w"), indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
