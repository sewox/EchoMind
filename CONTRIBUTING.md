# Katkı Rehberi / Contributing

EchoMind'a katkı vermek istediğiniz için teşekkürler! / Thanks for contributing to EchoMind!

## `main` dalı korumalıdır / `main` is protected

Kimse (yöneticiler dahil) `main`'e doğrudan push veya force push yapamaz. Her değişiklik bir Pull Request ile gelir ve şu koşullar sağlanmadan merge edilemez:

Nobody — admins included — can push or force-push directly to `main`. Every change arrives through a Pull Request and can only be merged when:

1. **CI yeşil / CI is green** — `Test & Quality Gate` (typecheck, ESLint, Vitest + coverage, `cargo test`) geçmeli / must pass.
2. **Dal güncel / Branch is up to date** — PR, `main`'in son haliyle güncellenmiş olmalı; CI bu güncel hal üzerinde tekrar çalışır. / The PR must include the latest `main`, and CI re-runs on that exact code.
3. **Konuşmalar çözülmüş / Conversations resolved** — açık review yorumu kalmamalı. / No unresolved review threads.
4. **Squash merge** — tek commit, doğrusal geçmiş. Commit başlığı PR başlığıdır. / One commit per PR, linear history; the PR title becomes the commit title.

## PR kuralları / PR rules

- **Başlık / Title:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix(audio):`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`.
- **Kapsam / Scope:** Bir PR, bir konu. İlgisiz düzeltmeleri ayrı PR'a taşıyın. / One topic per PR; move unrelated fixes to a separate PR.
- **Testler / Tests:** Davranış değişiyorsa test ekleyin veya güncelleyin; bir testi geçirmek için onu silmeyin. / Add or update tests for behavior changes; don't delete a test to make CI pass.
- **Çeviri / i18n:** Arayüzde görünen her metin `t()` üzerinden gelmeli ve `src/locales/` altındaki 5 dilde (tr/en/de/fr/es) bulunmalı. / Every user-facing string goes through `t()` and exists in all five locales.
- **Gizlilik / Privacy:** Cihazdan veri çıkaran her yol açık kullanıcı onayı gerektirir ve Paranoid modda engellenmelidir. / Any path that sends data off the device needs explicit consent and must be blocked in Paranoid mode.
- **Gizli bilgi yok / No secrets:** API anahtarı, token, gerçek toplantı kaydı/metni veya kişisel veri commit'lemeyin; ekran görüntülerinde de gizleyin. / Never commit API keys, tokens, real recordings/transcripts or personal data; redact them in screenshots.
- **Arayüz / UI:** Görsel değişikliklerde önce/sonra ekran görüntüsü ekleyin. / Attach before/after screenshots for visual changes.

## Yerelde kontrol / Local checks

```bash
npm ci
npm run typecheck
npm run lint
npm run test:frontend
cargo test --manifest-path src-tauri/Cargo.toml
```

Uygulamayı geliştirme modunda çalıştırmak / Run the app in dev mode:

```bash
npm run tauri dev
```

## Sürüm çıkarma / Releases

1. `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (ve `Cargo.lock`) içindeki sürüm ile `README.md`'deki indirme linkleri aynı PR'da yükseltilir. / Bump the version in those files and the README download links in one PR.
2. PR merge edildikten sonra `vX.Y.Z` etiketi push edilir; `Release & Build App` iş akışı macOS, Windows ve Linux paketlerini üretir. / After merge, push a `vX.Y.Z` tag; the release workflow builds the installers.
3. Web sitesindeki indirme butonları en son release'i otomatik olarak gösterir. / The website's download buttons pick up the latest release automatically.
4. Release sayfasına TR/EN sürüm notlarını ekleyin (yeni özellikler, düzeltmeler, bilinen sorunlar). / Add TR/EN release notes to the GitHub release (features, fixes, known issues).

## Hata ve öneriler / Bugs and ideas

[Issue formlarını](https://github.com/sewox/EchoMind/issues/new/choose) kullanın. Güvenlik açıklarını herkese açık issue olarak değil, [gizli olarak](https://github.com/sewox/EchoMind/security/advisories/new) bildirin (bkz. [SECURITY.md](SECURITY.md)).

Use the [issue forms](https://github.com/sewox/EchoMind/issues/new/choose). Report security vulnerabilities [privately](https://github.com/sewox/EchoMind/security/advisories/new), not as public issues (see [SECURITY.md](SECURITY.md)).
