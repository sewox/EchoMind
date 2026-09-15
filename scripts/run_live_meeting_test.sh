#!/usr/bin/env bash
set -e

echo "================================================================================"
echo "🎯 ECHOMIND - CANLI TOPLANTI & SES STRES TESTİ BAŞLATILIYOR"
echo "================================================================================"

# Proje kök dizinine git
cd "$(dirname "$0")/.."

echo "📦 Rust test ortamı derleniyor ve gerçek sesle koşturuluyor..."
cargo run --bin live_meeting_stress_tester --manifest-path src-tauri/Cargo.toml

echo "✅ Canlı toplantı stres testi başarıyla tamamlandı!"
