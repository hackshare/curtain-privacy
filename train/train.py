"""
train.py — fine-tune MiniLM on the BIO-labelled dataset produced by prepare.py.

Usage:
    uv run python train.py --data <tok_dir> --out <ckpt_dir> [options]

Options:
    --data        Path to tokenised datasets dir (from prepare.py)
    --out         Where to write the checkpoint (model + tokenizer)
    --epochs      Training epochs (default 3)
    --batch-size  Per-device batch size (default 16)
    --lr          Learning rate (default 5e-5)
    --max-rows    Cap dataset rows (useful with --smoke)
    --smoke       Short run: max-rows 300, epochs 1 (unless flags override)

The final token-F1 printed here is a sanity signal only.
The acceptance metric is the end-to-end eval (task 6).
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
from datasets import DatasetDict, load_from_disk
from transformers import (
    AutoModelForTokenClassification,
    AutoTokenizer,
    DataCollatorForTokenClassification,
    Trainer,
    TrainingArguments,
)

from labels import ID2LABEL, LABEL2ID

_BASE_MODEL = "nreimers/MiniLM-L6-H384-uncased"
_VAL_SPLIT = 0.1


# Token-level micro-F1 computed here is a training sanity signal only — it
# counts raw token predictions, not span boundaries.  This is intentionally
# simpler than seqeval span-F1; swapping in seqeval would produce a different
# (lower) number.  The authoritative acceptance metric is the end-to-end eval.
def _compute_metrics(eval_pred):
    logits, labels = eval_pred
    predictions = np.argmax(logits, axis=-1)

    true_flat: list[int] = []
    pred_flat: list[int] = []
    for pred_row, label_row in zip(predictions, labels):
        for p, l in zip(pred_row, label_row):
            if l == -100:
                continue
            true_flat.append(l)
            pred_flat.append(p)

    true_arr = np.array(true_flat)
    pred_arr = np.array(pred_flat)

    non_o = true_arr != 0
    tp = int(np.sum((true_arr == pred_arr) & non_o))
    fp = int(np.sum((true_arr != pred_arr) & (pred_arr != 0)))
    fn = int(np.sum((true_arr != pred_arr) & non_o))

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )
    return {"precision": precision, "recall": recall, "f1": f1}


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune MiniLM for NER.")
    parser.add_argument("--data", required=True, help="Tokenised datasets dir")
    parser.add_argument("--out", required=True, help="Checkpoint output dir")
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--max-rows", type=int, default=None)
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Short run: --max-rows 300 --epochs 1 unless explicitly overridden",
    )
    parser.add_argument(
        "--no-eval",
        action="store_true",
        help="Skip the per-epoch validation pass; save right after the last training step.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from the latest checkpoint in --out (for chunked runs under a bounded host).",
    )
    args = parser.parse_args()

    if args.smoke:
        if args.max_rows is None:
            args.max_rows = 300
        if args.epochs is None:  # not explicitly set; apply smoke default
            args.epochs = 1

    # Apply real defaults after any smoke overrides
    if args.epochs is None:
        args.epochs = 3

    # ── device (informational only) ─────────────────────────────────────────
    # HF Trainer / accelerate auto-selects MPS, CUDA, or CPU; we do not pass
    # this value to TrainingArguments.  The print is purely user feedback.
    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"
    print(f"device: {device} (auto-detected by accelerate)", flush=True)

    # ── dataset ─────────────────────────────────────────────────────────────
    raw = load_from_disk(args.data)
    if args.max_rows is not None:
        raw = raw.select(range(min(args.max_rows, len(raw))))

    split = raw.train_test_split(test_size=_VAL_SPLIT, seed=42)
    ds = DatasetDict({"train": split["train"], "validation": split["test"]})
    print(
        f"dataset: {len(ds['train'])} train / {len(ds['validation'])} val rows",
        flush=True,
    )

    # ── model + tokenizer ───────────────────────────────────────────────────
    tokenizer = AutoTokenizer.from_pretrained(_BASE_MODEL)
    model = AutoModelForTokenClassification.from_pretrained(
        _BASE_MODEL,
        num_labels=len(LABEL2ID),
        id2label=ID2LABEL,
        label2id=LABEL2ID,
        ignore_mismatched_sizes=True,
    )

    collator = DataCollatorForTokenClassification(tokenizer)

    # ── training args ───────────────────────────────────────────────────────
    out_path = Path(args.out)
    out_path.mkdir(parents=True, exist_ok=True)

    steps_per_epoch = max(1, len(ds["train"]) // args.batch_size)
    warmup_steps = max(1, int(0.1 * steps_per_epoch * args.epochs))

    # --no-eval skips the per-epoch validation pass (~15-18 min on the 30k val set),
    # which is dead weight when candidates are scored externally through the TS evals
    # and which, on a bounded-runtime host, can consume the window before the model
    # saves. With it off, the run saves right after the last training step.
    eval_off = getattr(args, "no_eval", False)
    training_args = TrainingArguments(
        output_dir=str(out_path),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        learning_rate=args.lr,
        warmup_steps=warmup_steps,
        weight_decay=0.01,
        lr_scheduler_type="linear",
        eval_strategy="no" if eval_off else "epoch",
        # With --no-eval, save frequently by steps so a bounded-host kill loses at most
        # ~5k steps and a --resume chunk picks up almost where it left off. The LR
        # schedule spans the full num_train_epochs regardless of chunking, because every
        # chunk passes the same --epochs and the scheduler state is restored on resume.
        save_strategy="steps" if eval_off else "epoch",
        save_steps=5000,
        save_total_limit=2,
        load_best_model_at_end=False if eval_off else True,
        metric_for_best_model="f1",
        logging_steps=10,
        fp16=False,
        report_to="none",
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=ds["train"],
        eval_dataset=ds["validation"],
        data_collator=collator,
        compute_metrics=_compute_metrics,
    )

    resume_ckpt = None
    if args.resume:
        from transformers.trainer_utils import get_last_checkpoint
        resume_ckpt = get_last_checkpoint(str(out_path))
        print(f"resuming from {resume_ckpt}", flush=True)
    trainer.train(resume_from_checkpoint=resume_ckpt)

    # ── save ────────────────────────────────────────────────────────────────
    trainer.save_model(str(out_path))
    tokenizer.save_pretrained(str(out_path))

    # ── final report ─────────────────────────────────────────────────────────
    metrics = trainer.evaluate()
    log_history = trainer.state.log_history
    train_loss = next(
        (e["train_loss"] for e in reversed(log_history) if "train_loss" in e),
        None,
    )
    print()
    if train_loss is not None:
        print(f"final train loss : {train_loss:.4f}")
    print(f"val token-F1     : {metrics.get('eval_f1', 0):.4f}")
    print(
        "\nNOTE: this F1 is a sanity signal only. "
        "Acceptance metric is the end-to-end eval (task 6)."
    )
    print(f"\ncheckpoint → {out_path.resolve()}", flush=True)


if __name__ == "__main__":
    main()
