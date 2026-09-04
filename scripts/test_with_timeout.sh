#!/bin/bash
# EchoMind Safe Test Runner with Timeout & Auto-Kill Safeguard
# Prevents orphaned test processes from running in background and consuming CPU.

TIMEOUT_SECONDS=120
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 1. Clean up any existing stale test runners
pkill -9 -f "echomind_lib" 2>/dev/null || true

echo "🧪 EchoMind Testleri Başlatılıyor (Zaman Aşımı Koruması: ${TIMEOUT_SECONDS}s)..."

export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"

# Run cargo test in background and monitor with timeout
cargo test --manifest-path "${ROOT_DIR}/src-tauri/Cargo.toml" &
TEST_PID=$!

# Monitor loop
ELAPSED=0
while kill -0 $TEST_PID 2>/dev/null; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
    if [ $ELAPSED -ge $TIMEOUT_SECONDS ]; then
        echo "🚨 [ZAMAN AŞIMI UYARISI] Test ${TIMEOUT_SECONDS} saniyede tamamlanamadı! Askıda kalan işlem otomatik sonlandırılıyor..."
        kill -9 $TEST_PID 2>/dev/null || true
        pkill -9 -f "echomind_lib" 2>/dev/null || true
        exit 1
    fi
done

wait $TEST_PID
EXIT_CODE=$?

# Final safety cleanup
pkill -9 -f "echomind_lib" 2>/dev/null || true

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Tüm testler başarıyla ve zamanında tamamlandı!"
else
    echo "❌ Testler hata ile sonuçlandı (Çıkış Kodu: $EXIT_CODE)"
fi

exit $EXIT_CODE
