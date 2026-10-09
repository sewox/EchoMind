# Echo cancellation model (DTLN-aec 128)

| File | SHA-256 |
|---|---|
| model_128_1.onnx | a060e46a6bebed03d6360262d814851dc6c2806cec7c1b6a388e617cae7c082c |
| model_128_2.onnx | 6b6e312f701a3fad2aac2981ca1ed978d25dffa0bc8da9f33235a2e91f56705a |

- **Model:** DTLN-aec, 128 LSTM units per layer (1.8M parameters), by Nils L.
  Westhausen, MIT License (`LICENSE-DTLN-aec`).
  https://github.com/breizhn/DTLN-aec
- **ONNX files:** copied unmodified from fastrepl/anarlog (MIT License,
  `LICENSE-anarlog`), commit a112ca8, `crates/aec/data/models/`.
  https://github.com/fastrepl/anarlog
- **Inference:** `src/echo.rs` follows anarlog's `crates/aec/src/onnx/mod.rs`
  (MIT): 512-sample blocks, 128-sample shift, two stateful models.
