"""
export.py — Export a PyTorch NER checkpoint to the on-device artifact shape.

Usage:
    uv run python export.py --ckpt <ckpt_dir> --out <out_dir>

Produces a directory compatible with the transformers.js loadNerClassifier:
    <out>/
        onnx/model.onnx         (fp32 ONNX baseline)
        onnx/model_q4.onnx      (4-bit quantized; loaded at runtime)
        config.json             (with id2label)
        tokenizer.json
        tokenizer_config.json
        special_tokens_map.json

The quantization uses onnxruntime's MatMulNBitsQuantizer (4 bits, block_size=32,
QDQ format) which replaces MatMul weight constants with DequantizeLinear + MatMul
using int4 tensors — a standard-ONNX representation that onnxruntime-node can run.

Versions in use: optimum 2.1.0, onnxruntime 1.27.0
"""
from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

import onnx
from optimum.onnxruntime import ORTModelForTokenClassification
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
from onnxruntime.quantization.quant_utils import QuantFormat


def main() -> None:
    parser = argparse.ArgumentParser(description="Export NER checkpoint to ONNX + Q4.")
    parser.add_argument("--ckpt", required=True, help="PyTorch checkpoint dir (from train.py)")
    parser.add_argument("--out", required=True, help="Output model dir")
    parser.add_argument(
        "--quantize-embedding",
        action="store_true",
        help="Also INT8-quantize the word-embedding Gather (needed to hit the ~14.7 MB ship budget on a vocab-trimmed model).",
    )
    args = parser.parse_args()

    ckpt = Path(args.ckpt)
    out = Path(args.out)
    onnx_dir = out / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)

    # ── Step 1: Export PyTorch checkpoint → fp32 ONNX ───────────────────────
    print(f"Exporting {ckpt} → ONNX (fp32)…", flush=True)
    ort_model = ORTModelForTokenClassification.from_pretrained(str(ckpt), export=True)

    # save_pretrained writes model.onnx + tokenizer files to the given dir;
    # we stage in a temp dir so we control the final layout.
    with tempfile.TemporaryDirectory() as _tmp:
        tmp = Path(_tmp)
        ort_model.save_pretrained(str(tmp))
        onnx_candidates = list(tmp.glob("*.onnx"))
        if not onnx_candidates:
            raise RuntimeError(f"No .onnx file in {tmp}; export failed.")
        tmp_fp32 = onnx_candidates[0]

        fp32_dest = onnx_dir / "model.onnx"
        shutil.copy(tmp_fp32, fp32_dest)

    fp32_size = fp32_dest.stat().st_size
    print(f"  fp32 ONNX:  {fp32_dest}  ({fp32_size / 1_048_576:.1f} MB)", flush=True)

    # ── Step 2: Quantize fp32 ONNX → Q4 (int4 weights, QDQ format) ──────────
    # MatMulNBitsQuantizer replaces every MatMul's weight constant with a
    # DequantizeLinear + packed int4 tensor (bits=4, block_size=32).  The QDQ
    # format uses only standard ONNX ops (no contrib MatMulNBits), so it runs
    # on any ONNX Runtime build including onnxruntime-node 1.21.
    print("Quantizing to Q4 (MatMulNBitsQuantizer, QDQ, bits=4, block_size=32)…", flush=True)
    fp32_model = onnx.load(str(fp32_dest))
    quantizer = MatMulNBitsQuantizer(
        fp32_model,
        bits=4,
        block_size=32,
        is_symmetric=False,
        quant_format=QuantFormat.QDQ,
    )
    quantizer.process()

    q4_dest = onnx_dir / "model_q4.onnx"
    onnx.save(quantizer.model.model, str(q4_dest))

    q4_size = q4_dest.stat().st_size
    print(f"  Q4 ONNX:    {q4_dest}  ({q4_size / 1_048_576:.1f} MB)", flush=True)
    print(f"  Size reduction: {100 * (1 - q4_size / fp32_size):.0f}%", flush=True)

    # ── Step 2b: INT8-quantize the word-embedding Gather (ship-size step) ─────
    # MatMulNBits leaves the embedding table in fp32 (~29 MB on a 19,730-piece
    # vocab), which dominates the artifact. A dynamic INT8 pass on the Gather op
    # (QDQ: int8 initializer + DequantizeLinear, transformers.js-compatible) takes
    # it to ~7 MB, bringing a vocab-trimmed model to the ~14.7 MB ship budget.
    if args.quantize_embedding:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        print("INT8-quantizing the word-embedding (Gather)…", flush=True)
        emb_tmp = onnx_dir / "model_q4_embint8.tmp.onnx"
        quantize_dynamic(
            str(q4_dest),
            str(emb_tmp),
            weight_type=QuantType.QInt8,
            op_types_to_quantize=["Gather"],
            per_channel=False,
        )
        emb_tmp.replace(q4_dest)
        q4_size = q4_dest.stat().st_size
        print(f"  Q4 + INT8-emb ONNX: {q4_dest}  ({q4_size / 1_048_576:.1f} MB)", flush=True)

    # ── Step 3: Copy tokenizer + config files ────────────────────────────────
    for fname in ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"]:
        src = ckpt / fname
        if src.exists():
            shutil.copy(src, out / fname)
        else:
            print(f"  WARNING: {fname} not found in {ckpt}", flush=True)

    print(f"\nExported model dir: {out.resolve()}", flush=True)
    print("Files:")
    for p in sorted(out.rglob("*")):
        if p.is_file():
            print(f"  {p.relative_to(out)}  ({p.stat().st_size / 1_048_576:.2f} MB)", flush=True)


if __name__ == "__main__":
    main()
