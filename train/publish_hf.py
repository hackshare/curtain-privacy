"""Publish a built curtain model's serving files to a Hugging Face Hub repo.

The model is built locally from this train/ pipeline; HF is a distribution layer,
not a source of truth. This uploads only the serving files (the fp32 diagnostic
export is excluded) plus the HF card, and prints the model_q4.onnx SHA-256 so it
can be checked against SECURITY.md.

    HF_TOKEN=... uv run python publish_hf.py \
        --model runs/model-latin24c-ship --repo hackshare/curtain-privacy --revision-tag v1.0.0
"""
from __future__ import annotations
import argparse
import hashlib
from pathlib import Path

# Order matters only for a stable log; the HF layout is flat + onnx/ .
SERVING_RELPATHS = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "onnx/model_q4.onnx",
]


def serving_files(model_dir: Path) -> list[Path]:
    """The serving files to upload, validated to exist. The fp32 onnx/model.onnx
    is never included."""
    out: list[Path] = []
    for rel in SERVING_RELPATHS:
        p = model_dir / rel
        if not p.exists():
            raise FileNotFoundError(f"missing serving file: {rel} (looked in {model_dir})")
        out.append(p)
    return out


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    from huggingface_hub import HfApi

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="built model dir, e.g. runs/model-latin24c-ship")
    ap.add_argument("--repo", required=True, help="HF repo id, e.g. hackshare/curtain-privacy")
    ap.add_argument("--revision-tag", default=None, help="tag to create for this upload, e.g. v1.0.0")
    ap.add_argument("--moving-ref", default=None, help="a tag to (re)point at this upload, e.g. v1.0.0")
    ap.add_argument("--card", default="hf_card.md", help="HF README/model-card source")
    ap.add_argument("--private", action="store_true", help="create the repo private (default public)")
    args = ap.parse_args()

    model_dir = Path(args.model)
    files = serving_files(model_dir)
    digest = sha256(model_dir / "onnx" / "model_q4.onnx")

    api = HfApi()
    api.create_repo(args.repo, repo_type="model", private=args.private, exist_ok=True)

    api.upload_file(path_or_fileobj=args.card, path_in_repo="README.md", repo_id=args.repo, repo_type="model")
    for p in files:
        rel = p.relative_to(model_dir).as_posix()
        api.upload_file(path_or_fileobj=str(p), path_in_repo=rel, repo_id=args.repo, repo_type="model")
        print(f"uploaded {rel}")

    if args.revision_tag:
        api.create_tag(args.repo, tag=args.revision_tag, repo_type="model", exist_ok=True)
        print(f"tagged {args.revision_tag}")

    if args.moving_ref:
        # delete_tag has no missing_ok; the moving tag is absent on the first
        # publish, so ignore a not-found delete. Auth is already proven by the
        # uploads above, so a delete error here can only mean the tag was absent.
        try:
            api.delete_tag(args.repo, tag=args.moving_ref, repo_type="model")
        except Exception:
            pass
        api.create_tag(args.repo, tag=args.moving_ref, repo_type="model", exist_ok=True)
        print(f"moved {args.moving_ref}")

    print(f"model_q4.onnx sha256: {digest}")
    print(f"done: https://huggingface.co/{args.repo}")


if __name__ == "__main__":
    main()
