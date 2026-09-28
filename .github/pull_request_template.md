<!--
PR başlığı Conventional Commits formatında olmalı; squash merge'de commit mesajı olur.
The PR title must follow Conventional Commits; it becomes the squash commit message.
  feat: …   fix(audio): …   docs: …   chore: …   refactor: …   test: …   ci: …
Kurallar / Rules: CONTRIBUTING.md
-->

## Ne değişti? / What changed?

<!-- Kısa özet ve nedeni. / Short summary and why. -->

## İlgili issue / Related issue

<!-- Closes #123 -->

## Değişiklik türü / Type of change

- [ ] 🐞 Hata düzeltmesi / Bug fix
- [ ] ✨ Yeni özellik / New feature
- [ ] ♻️ Refactor (davranış değişmez / no behavior change)
- [ ] 📝 Dokümantasyon / site
- [ ] 🔧 CI / build / bağımlılık / dependencies

## Nasıl test edildi? / How was it tested?

<!-- Çalıştırdığınız komutlar ve manuel test adımları. / Commands run and manual test steps. -->

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test:frontend`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` (Rust değiştiyse / if Rust changed)
- [ ] Uygulamada manuel olarak denendi / Manually verified in the app — OS: <!-- macOS / Windows / Linux -->

## Kontrol listesi / Checklist

- [ ] PR tek bir konuya odaklı / The PR is focused on one topic
- [ ] Davranış değişikliği için test eklendi veya güncellendi / Tests added or updated for behavior changes
- [ ] Yeni arayüz metinleri `t()` üzerinden ve 5 dilde de var (tr/en/de/fr/es) / New UI strings go through `t()` in all 5 locales
- [ ] Arayüz değiştiyse ekran görüntüsü eklendi / Screenshots attached for UI changes
- [ ] API anahtarı, token, gerçek toplantı verisi veya kişisel veri yok / No API keys, tokens, real meeting data or personal data
- [ ] Gizlilik etkisi düşünüldü: veri cihazdan çıkıyorsa kullanıcı onayı ve Paranoid mod kontrolü var / Privacy considered: any data leaving the device is consented and blocked in Paranoid mode

## Ekran görüntüleri / Screenshots

<!-- Arayüz değişikliklerinde önce/sonra. / Before/after for UI changes. -->
