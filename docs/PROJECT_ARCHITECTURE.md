# EchoMind Technical Architecture

## 1. System Capture Layer
- **Windows:** WASAPI Loopback to capture system output + Microphone input.
- **macOS:** ScreenCaptureKit (SCK) for system audio bypass + CoreAudio for mic.
- **Mixer:** A Rust-based audio mixer to combine both streams into a single 16kHz mono PCM stream for AI processing.

## 2. Transcription Layer (Offline)
- **Engine:** Whisper.cpp (via whisper-rs).
- **Optimization:** 
    - macOS: Use CoreML/Metal.
    - Windows: Use CUDA if available, else AVX2.
- **Features:** Diarization (Speaker identification) using voice activity and embedding comparison.

## 3. Analysis Layer (Hybrid)
- **Online:** Google Gemini 1.5 Flash API for fast, high-quality summaries.
- **Offline:** Gemma 2 2B (GGUF quantized) for private, internet-free analysis.

## 4. UI Layer
- **Tauri:** System tray-based application.
- **Triggers:** Detect system mic activation to show a "Record Meeting?" notification popup.