"""Stage a built curtain model as a GitHub Release so the publish workflow can
verify and push it to Hugging Face. Run on the build machine after a build.

    uv run python cut_release.py --model runs/model-latin24c-ship --version 1.0.0

Creates tag v<version>-<UTC ts>, a tarball of the serving files, and a SHA256SUMS,
then `gh release create ... --prerelease` with both attached. The fp32 export is
never included (serving_files excludes it).
"""
from __future__ import annotations
import argparse
import subprocess
import tarfile
from pathlib import Path

from publish_hf import serving_files, sha256


def build_tag(version: str, ts: str) -> str:
    """The immutable release tag v<version>-<ts>. Timestamp must be non-empty."""
    if not ts:
        raise ValueError("timestamp must not be empty")
    return f"v{version}-{ts}"


def main() -> None:
    from datetime import datetime, timezone

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="built model dir, e.g. runs/model-latin24c-ship")
    ap.add_argument("--version", default="1.0.0")
    ap.add_argument("--repo", default="hackshare/curtain-privacy", help="GitHub repo for the release")
    args = ap.parse_args()

    model_dir = Path(args.model)
    files = serving_files(model_dir)  # validates the set; excludes fp32
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    tag = build_tag(args.version, ts)

    tarball = Path(f"curtain-model-{tag}.tar.gz")
    with tarfile.open(tarball, "w:gz") as tar:
        for p in files:
            tar.add(p, arcname=p.relative_to(model_dir).as_posix())

    sums = Path("SHA256SUMS")
    q4 = model_dir / "onnx" / "model_q4.onnx"
    sums.write_text(f"{sha256(tarball)}  {tarball.name}\n{sha256(q4)}  model_q4.onnx\n")

    subprocess.run(
        ["gh", "release", "create", tag, str(tarball), str(sums),
         "--repo", args.repo, "--prerelease", "--title", tag,
         "--notes", f"curtain model build {tag}. SHA256SUMS attached."],
        check=True,
    )
    print(f"cut release {tag} on {args.repo}")


if __name__ == "__main__":
    main()
