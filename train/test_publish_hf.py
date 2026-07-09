from pathlib import Path
import pytest
from publish_hf import serving_files, SERVING_RELPATHS


def _make_model(tmp_path: Path, include_fp32: bool = True) -> Path:
    d = tmp_path / "model"
    (d / "onnx").mkdir(parents=True)
    for rel in SERVING_RELPATHS:
        (d / rel).write_text("x")
    if include_fp32:
        (d / "onnx" / "model.onnx").write_text("big")
    return d


def test_serving_files_returns_the_five_serving_files(tmp_path):
    d = _make_model(tmp_path)
    got = [p.relative_to(d).as_posix() for p in serving_files(d)]
    assert got == SERVING_RELPATHS


def test_serving_files_excludes_fp32_model(tmp_path):
    d = _make_model(tmp_path, include_fp32=True)
    got = [p.name for p in serving_files(d)]
    assert "model.onnx" not in got
    assert "model_q4.onnx" in got


def test_serving_files_raises_on_missing(tmp_path):
    d = _make_model(tmp_path)
    (d / "tokenizer.json").unlink()
    with pytest.raises(FileNotFoundError):
        serving_files(d)
