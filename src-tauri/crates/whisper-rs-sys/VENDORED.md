# Vendored whisper.cpp

- Source: https://github.com/ggml-org/whisper.cpp
- Commit: `711ef84442117b07c345b57fa16ceb5667b0dd03` (last commit before ggml 0.25.0)
- Tarball SHA-256: `a2bcce3bac7ab2d33751e4593d05ba1b4f5a54aacc617446d6e582b2d45ba331`
- ggml version: 0.24.0, the same as `llama-cpp-sys-2 = 0.1.158`
- Copied: `CMakeLists.txt`, `LICENSE`, `cmake/`, `include/`, `src/`, `bindings/javascript/package-tmpl.json` (read by CMake) (no `ggml/`: ggml comes from llama-cpp-sys-2)

When bumping `llama-cpp-2`/`llama-cpp-sys-2`, pick the whisper.cpp commit whose
`ggml/CMakeLists.txt` has the same `GGML_VERSION_*` and re-vendor.
