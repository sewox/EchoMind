// EchoMind Interactive Landing Engine (Full Bilingual & OS-Aware)

const sampleDlpTexts = {
  tr: "Toplantıda müşteri TCKN: 10987654328 ve Kartı 4532890123456789 ile sk-live9876543210abcdef anahtarını onayladı.",
  en: "In the meeting, customer ID: 10987654328 and Card: 4532890123456789 with API Key sk-live9876543210abcdef were confirmed.",
};

const translations = {
  tr: {
    navFeatures: "Özellikler",
    navShowcase: "Arayüz",
    navSecurity: "Güvenlik & DLP",
    navHardware: "Donanım",
    navDownload: "İndir",
    badgeRelease: "EchoMind v0.2.12 Yayında • Sıfır-Güven Mimarisi",
    heroTitle: "Toplantılarınızı Donanım Gücüyle Dinleyen Hibrit Yapay Zekâ",
    heroSubtitle:
      "Apple Metal ve NVIDIA CUDA ile %100 yerel ve gizli çalışabilen, kurumsal DLP ve toplantılar arası semantik hafıza sunan yeni nesil masaüstü toplantı asistanı.",
    btnDownloadWindows: "Windows (.exe İndir)",
    btnDownloadMac: "macOS (.dmg İndir)",
    btnGithub: "GitHub Kaynak Kodu",
    hudTitle: "EchoMind Kayan HUD Arayüzü • macOS / Windows",
    islandStatus: "Canlı Toplantı • Dinamik Ada",
    islandEngineBadge: "Whisper Metal • 0.12x",
    secShowcaseTitle: "✨ EchoMind Masaüstü Arayüzü",
    secShowcaseSubtitle:
      "Gizlilik odaklı, sıfır gecikmeli ve donanım hızlandırmalı modern toplantı arayüzünü inceleyin.",
    secFeaturesTitle: "Neden EchoMind?",
    secFeaturesSubtitle:
      "Tüm toplantı iş akışınızı gizlilikten ödün vermeden otomatikleştirin.",
    bentoHwTitle: "⚡ Donanım Farkındalıklı Hibrit Motor",
    bentoHwDesc:
      "Cihazınızın GPU (Metal, CUDA) ve CPU çekirdeklerini otomatik analiz ederek optimum Whisper modelini seçer.",
    hwBtnApple: "🍏 Apple Silicon (Metal)",
    hwBtnNvidia: "🟢 NVIDIA GeForce (CUDA)",
    hwBtnIntel: "💻 Intel / AMD CPU",
    hwSubApple: "M1/M2/M3/M4 Donanım Hızlandırma",
    hwSubNvidia: "RTX 30/40 Serisi Tensor Çekirdekleri",
    hwSubIntel: "AVX2 Vektör Komut Seti",
    hwLabelEngine: "Hızlandırıcı Motor",
    hwLabelModel: "Önerilen Model",
    hwLabelSpeed: "Transkripsiyon Hızı",
    bentoSecTitle: "🛡️ Kurumsal Seviye Canlı DLP Koruması",
    bentoSecDesc:
      "Toplantı sırasında telaffuz edilen veya metne dökülen TCKN, Kredi Kartı (Luhn), IBAN ve API anahtarlarını anında maskeler.",
    dlpPlaceholder:
      "Buraya test metni yazın... Örnek: TCKN 12345678901, Kart 4532890123456789 veya sk-live123456789abcdef",
    bentoMemTitle: "🧠 Toplantılar Arası Semantik Hafıza",
    bentoMemDesc:
      "Sadece anlık toplantıyı değil, aylar önceki konuşmaları da hatırlar. Doğal dilde soru sorarak kararlara ve alıntılara ulaşın.",
    memQuery: '💬 "Geçen ay bütçe için ne konuşulmuştu?"',
    memResult:
      "↳ 3 farklı toplantıdan 4 alıntı getirildi (14 Mayıs, 22 Haziran).",
    bentoAudioTitle: "✂️ 1-Tıkla Ses Kesiti & Mini Podcast",
    bentoAudioDesc:
      "Kritik tartışmaları 15-60 saniyelik ses kesiti (soundbite) olarak kırpın veya dahili ses çalarla özetleri dinleyin.",
    bentoDiarTitle: "🎙️ Konuşmacı Ayrıştırma & Analitik",
    bentoDiarDesc:
      "Konuşmacıları frekanslarına göre tanır, hitaplardan isimlerini öğrenir ve toplantı denge skorunu hesaplar.",
    diarSpeaker1: "Ahmet %60",
    diarSpeaker2: "Can %25",
    diarSpeaker3: "Selin %15",
    bentoProvidersTitle:
      "🌐 3 Katmanlı Esnek Model Mimarisi: Yerel, Self-Hosted & Bulut Sağlayıcılar",
    bentoProvidersDesc:
      "Sıfır bağımlılık: Donanımınızda %100 çevrimdışı çalışın, kendi yerel Ollama/vLLM sunucunuzu bağlayın veya kendi API anahtarınızla en güçlü bulut modellerini aracı komisyonsuz ve DLP korumasıyla kullanın.",
    tier1Title: "💻 %100 Yerel (Bare-Metal)",
    tier1Desc:
      "Apple Metal GPU & NVIDIA CUDA ile Whisper.cpp çevrimdışı transkripsiyon. Sıfır bulut, sıfır abonelik.",
    tier2Title: "🏠 Kendi LLM Sunucun (Ollama)",
    tier2Desc:
      "Yerel ağınızdaki Ollama, vLLM, LocalAI veya OpenAI-uyumlu sunucuları tek tıkla entegre edin.",
    tier3Title: "☁️ Genel Sağlayıcılar (Kendi API Anahtarınla)",
    tier3Desc:
      "Abonelik ödemeden kendi API anahtarınızla OpenAI, Google Gemini ve Groq. İstemci taraflı DLP ile sansürlenir.",
    secDownloadTitle: "Platformunuz İçin İndirin",
    secDownloadSubtitle:
      "Ücretsiz ve açık kaynaklı. İşletim sisteminize uygun kurulum dosyasını seçebilirsiniz.",
    winSetupTitle: "Windows Kurulum (.exe)",
    winSetupDesc: "Windows 10/11 x64 için standart NSIS kurulum paketi.",
    winMsiTitle: "Windows Installer (.msi)",
    winMsiDesc: "Kurumsal sistem yöneticileri için Windows MSI paketi.",
    macDmgTitle: "macOS Disk İmajı (.dmg)",
    macDmgDesc: "Apple Silicon (M1/M2/M3/M4) işlemcili Mac bilgisayarlar için.",
    linuxDistroTitle: "Linux Dağıtımları (.deb / .AppImage)",
    linuxDistroDesc: "Ubuntu, Debian, Fedora ve Arch x64 için yerel paketler.",
    btnDownloadWinExe: "İndir .exe (4.9 MB)",
    btnDownloadWinMsi: "İndir .msi (6.9 MB)",
    btnDownloadMacDmg: "İndir .dmg (8.2 MB)",
    footerText:
      "EchoMind © 2026. Açık Kaynaklı ve Sıfır-Güven Toplantı Zekâsı Platformu.",
  },
  en: {
    navFeatures: "Features",
    navShowcase: "Showcase",
    navSecurity: "Security & DLP",
    navHardware: "Hardware",
    navDownload: "Download",
    badgeRelease: "EchoMind v0.2.12 Released • Zero-Trust Architecture",
    heroTitle: "Hardware-Aware Hybrid AI Meeting Intelligence",
    heroSubtitle:
      "A next-generation desktop meeting assistant that runs 100% locally with Apple Metal & NVIDIA CUDA, featuring enterprise DLP and cross-meeting semantic memory.",
    btnDownloadWindows: "Download for Windows (.exe)",
    btnDownloadMac: "Download for macOS (.dmg)",
    btnGithub: "GitHub Repository",
    hudTitle: "EchoMind Floating HUD Overlay • macOS / Windows",
    islandStatus: "Live Meeting • Dynamic Island",
    islandEngineBadge: "Whisper Metal • 0.12x",
    secShowcaseTitle: "✨ EchoMind Desktop Experience",
    secShowcaseSubtitle:
      "Explore the privacy-first, zero-latency, and hardware-accelerated modern meeting interface.",
    secFeaturesTitle: "Why Choose EchoMind?",
    secFeaturesSubtitle:
      "Automate your entire meeting intelligence workflow without compromising data privacy.",
    bentoHwTitle: "⚡ Hardware-Aware Hybrid Engine",
    bentoHwDesc:
      "Automatically analyzes GPU (Metal, CUDA) and CPU threads to recommend the optimal Whisper model with zero latency.",
    hwBtnApple: "🍏 Apple Silicon (Metal)",
    hwBtnNvidia: "🟢 NVIDIA GeForce (CUDA)",
    hwBtnIntel: "💻 Intel / AMD CPU",
    hwSubApple: "M1/M2/M3/M4 Hardware Acceleration",
    hwSubNvidia: "RTX 30/40 Series Tensor Cores",
    hwSubIntel: "AVX2 Vectorized Instruction Set",
    hwLabelEngine: "Acceleration Engine",
    hwLabelModel: "Recommended Model",
    hwLabelSpeed: "Transcription Speed",
    bentoSecTitle: "🛡️ Real-Time Enterprise DLP Guard",
    bentoSecDesc:
      "Instantly redacts Turkish IDs, Luhn-validated Credit Cards, IBANs, and API credentials as they are transcribed.",
    dlpPlaceholder:
      "Type sample text here... Example: CC 4532890123456789, National ID 12345678901, or API key sk-live123456789abcdef",
    bentoMemTitle: "🧠 Cross-Meeting Semantic Memory",
    bentoMemDesc:
      "Remembers discussions from months ago. Ask natural questions and jump straight to audio timestamp citations.",
    memQuery: '💬 "What did Sarah decide about the Q3 budget last month?"',
    memResult:
      "↳ Retrieved 4 citations across 3 past meetings (May 14, June 22).",
    bentoAudioTitle: "✂️ 1-Click Soundbite Clipper & Audio Memo Player",
    bentoAudioDesc:
      "Extract 15s-60s vital audio clips or listen to executive summaries through the integrated mini podcast player.",
    bentoDiarTitle: "🎙️ Speaker Diarization & Analytics",
    bentoDiarDesc:
      "Acoustically separates distinct speakers, learns names from context, and visualizes talk-to-listen balance scores.",
    diarSpeaker1: "Alex 60%",
    diarSpeaker2: "John 25%",
    diarSpeaker3: "Sarah 15%",
    bentoProvidersTitle:
      "🌐 3-Tier Flexible Model Architecture: Local, Self-Hosted & Cloud",
    bentoProvidersDesc:
      "Zero vendor lock-in: Run 100% offline on bare-metal hardware, connect your local Ollama/vLLM server, or bring your own API keys (BYOK) for top cloud models protected by client-side DLP.",
    tier1Title: "💻 100% Local (Bare-Metal)",
    tier1Desc:
      "Whisper.cpp offline transcription accelerated by Apple Metal GPU & NVIDIA CUDA. Zero cloud, zero subscription.",
    tier2Title: "🏠 Self-Hosted LLMs (Ollama)",
    tier2Desc:
      "Seamlessly connect local Ollama, vLLM, LocalAI, or custom OpenAI-compatible servers on your LAN.",
    tier3Title: "☁️ Public Cloud (Bring Your Own Key)",
    tier3Desc:
      "Use OpenAI, Google Gemini, and Groq with your own API keys (no middleman fees). All data is client-side redacted before sending.",
    secDownloadTitle: "Download for Your Platform",
    secDownloadSubtitle:
      "Free and open-source. Select the installer corresponding to your operating system.",
    winSetupTitle: "Windows Setup (.exe)",
    winSetupDesc: "Standard NSIS setup installer for Windows 10/11 x64.",
    winMsiTitle: "Windows Installer (.msi)",
    winMsiDesc: "Enterprise Windows MSI package for system administrators.",
    macDmgTitle: "macOS Disk Image (.dmg)",
    macDmgDesc: "Optimized for Apple Silicon (M1/M2/M3/M4) Macs.",
    linuxDistroTitle: "Linux Distros (.deb / .AppImage)",
    linuxDistroDesc:
      "Native packages for Ubuntu, Debian, Fedora, and Arch x64.",
    btnDownloadWinExe: "Download .exe (4.9 MB)",
    btnDownloadWinMsi: "Download .msi (6.9 MB)",
    btnDownloadMacDmg: "Download .dmg (8.2 MB)",
    footerText:
      "EchoMind © 2026. Open-Source Zero-Trust Meeting Intelligence Platform.",
  },
};

let currentLang = "tr";
let currentHwKey = "appleSilicon";

// Hardware Profiles Data (Bilingual)
const hwProfiles = {
  appleSilicon: {
    tr: {
      engine: "Whisper.cpp (Apple Metal GPU / ANE)",
      model: "Whisper Medium.en / Small.multilingual",
      speed: "0.15x Gerçek Zamanlı (1 saatlik ses ~90 saniye)",
    },
    en: {
      engine: "Whisper.cpp (Apple Metal GPU / ANE)",
      model: "Whisper Medium.en / Small.multilingual",
      speed: "0.15x Real-Time (1 hr audio in ~90 seconds)",
    },
  },
  nvidiaRtx: {
    tr: {
      engine: "Whisper.cpp + CUDA 12.x",
      model: "Whisper Large-v3 (FP16)",
      speed: "0.08x Gerçek Zamanlı (1 saatlik ses ~45 saniye)",
    },
    en: {
      engine: "Whisper.cpp + CUDA 12.x",
      model: "Whisper Large-v3 (FP16)",
      speed: "0.08x Real-Time (1 hr audio in ~45 seconds)",
    },
  },
  intelCpu: {
    tr: {
      engine: "Whisper.cpp (AVX2 / FMA Vektörel)",
      model: "Whisper Base / Small (Q5_1 Kuantize)",
      speed: "0.45x Gerçek Zamanlı (1 saatlik ses ~4.5 dakika)",
    },
    en: {
      engine: "Whisper.cpp (AVX2 / FMA Vectorized)",
      model: "Whisper Base / Small (Q5_1 Quantized)",
      speed: "0.45x Real-Time (1 hr audio in ~4.5 minutes)",
    },
  },
};

function updateHardwareDisplay() {
  const profile = hwProfiles[currentHwKey][currentLang];
  if (profile) {
    const engineEl = document.getElementById("hwEngineVal");
    const modelEl = document.getElementById("hwModelVal");
    const speedEl = document.getElementById("hwSpeedVal");
    if (engineEl) engineEl.textContent = profile.engine;
    if (modelEl) modelEl.textContent = profile.model;
    if (speedEl) speedEl.textContent = profile.speed;
  }
}

function selectHardware(profileKey) {
  currentHwKey = profileKey;
  document.querySelectorAll(".hw-item-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-hw") === profileKey);
  });
  updateHardwareDisplay();
}

// Language Switcher Function
function setLanguage(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (translations[lang] && translations[lang][key]) {
      el.textContent = translations[lang][key];
    }
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (translations[lang] && translations[lang][key]) {
      el.title = translations[lang][key];
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (translations[lang] && translations[lang][key]) {
      el.placeholder = translations[lang][key];
    }
  });

  // Translations carry the fallback version/sizes; overwrite with the live release.
  applyLatestRelease();

  const langBtn = document.getElementById("langToggleBtn");
  if (langBtn) {
    langBtn.innerHTML = lang === "tr" ? "🌐 English" : "🌐 Türkçe";
  }

  updateHardwareDisplay();

  // Switch DLP sample text if user hasn't typed custom text, or update current
  const dlpInput = document.getElementById("dlpInput");
  const dlpOutput = document.getElementById("dlpOutput");
  if (dlpInput && dlpOutput) {
    // If input matches one of the sample texts or is empty, switch to the new language sample
    const isDefaultSample =
      !dlpInput.value ||
      dlpInput.value === sampleDlpTexts.tr ||
      dlpInput.value === sampleDlpTexts.en;

    if (isDefaultSample) {
      dlpInput.value = sampleDlpTexts[lang];
    }
    dlpOutput.innerHTML = simulateDLP(dlpInput.value);
  }

  // Update Dynamic Island Transcript immediately on lang switch
  const transcriptEl = document.getElementById("islandTranscriptText");
  if (transcriptEl) {
    const list = lang === "tr" ? transcripts.tr : transcripts.en;
    transcriptEl.textContent = list[0];
  }

  // Re-render the screenshot slider in the new language
  if (typeof renderShowcaseSlide === "function") {
    renderShowcaseSlide(showcaseIndex);
  }

  localStorage.setItem("echomind_lang", lang);
}

// Interactive DLP Engine Simulation
function simulateDLP(input) {
  if (!input || input.trim() === "") {
    return currentLang === "tr"
      ? "Maskelenmiş çıktı burada anlık olarak görüntülenecektir..."
      : "Redacted real-time output will appear here...";
  }

  let sanitized = input;

  // 1. API Keys (sk-..., gsk_..., AIzaSy..., ghp_...)
  sanitized = sanitized.replace(
    /\b(sk-[a-zA-Z0-9_-]{20,}|gsk_[a-zA-Z0-9_-]{20,}|AIzaSy[a-zA-Z0-9_-]{33}|ghp_[a-zA-Z0-9]{36})\b/g,
    () => {
      return `<span class="redacted-tag">[REDACTED_API_KEY]</span>`;
    },
  );

  // 2. Credit Card (13-19 digits, Luhn check)
  sanitized = sanitized.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
    const cleaned = match.replace(/[\s-]/g, "");
    if (luhnCheck(cleaned)) {
      return `<span class="redacted-tag">[REDACTED_CARD: ${cleaned.slice(-4)}]</span>`;
    }
    return match;
  });

  // 3. TCKN (11 digits)
  sanitized = sanitized.replace(/\b[1-9]\d{10}\b/g, () => {
    return `<span class="redacted-tag">[REDACTED_TCKN]</span>`;
  });

  // 4. IBAN (TR...)
  sanitized = sanitized.replace(/\bTR\d{2}[0-9A-Z]{5,30}\b/gi, () => {
    return `<span class="redacted-tag">[REDACTED_IBAN]</span>`;
  });

  // 5. Email
  sanitized = sanitized.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    () => {
      return `<span class="redacted-tag">[REDACTED_EMAIL]</span>`;
    },
  );

  // 6. Phone numbers
  sanitized = sanitized.replace(
    /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    () => {
      return `<span class="redacted-tag">[REDACTED_PHONE]</span>`;
    },
  );

  return sanitized;
}

function luhnCheck(val) {
  let sum = 0;
  let shouldDouble = false;
  for (let i = val.length - 1; i >= 0; i--) {
    let digit = parseInt(val.charAt(i), 10);
    if (shouldDouble) {
      if ((digit *= 2) > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

// OS Detection for Hero CTAs
function detectUserOS() {
  const ua = window.navigator.userAgent.toLowerCase();
  const isMac = ua.includes("mac") || ua.includes("darwin");
  const isWindows = ua.includes("win");
  const isLinux = ua.includes("linux") || ua.includes("x11");

  const winBtn = document.getElementById("heroDownloadWin");
  const macBtn = document.getElementById("heroDownloadMac");

  if (winBtn && macBtn) {
    if (isMac) {
      macBtn.classList.remove("btn-secondary");
      macBtn.classList.add("btn-primary");
      winBtn.classList.remove("btn-primary");
      winBtn.classList.add("btn-secondary");
    } else if (isWindows) {
      winBtn.classList.remove("btn-secondary");
      winBtn.classList.add("btn-primary");
      macBtn.classList.remove("btn-primary");
      macBtn.classList.add("btn-secondary");
    } else if (isLinux) {
      // For Linux, point secondary button to Linux download or docs section
      winBtn.classList.remove("btn-primary");
      winBtn.classList.add("btn-secondary");
      macBtn.classList.remove("btn-primary");
      macBtn.classList.add("btn-secondary");
    }
  }
}

// Dynamic Island Transcripts
const transcripts = {
  tr: [
    'Ahmet: "Q3 hedeflerimiz için yerel model hızlandırmasını tamamladık."',
    'Gizem: "Kullanıcı kredi kartı ve TCKN verileri DLP kuralıyla maskelendi."',
    'Can: "Geçen ayki toplantıda alınan bütçe kararlarını hafızadan getirdim."',
    'Selin: "Ses kesiti 250ms içinde dışa aktarıldı. Buluta veri iletilmedi."',
  ],
  en: [
    'Alex: "We have finalized on-device acceleration for Q3 milestones."',
    'Sarah: "Confidential customer cards and national IDs are redacted by DLP."',
    'Michael: "Retrieved the budget consensus from last month\'s memory."',
    'Elena: "Soundbite exported in 250ms with zero cloud transmission."',
  ],
};

// DOM Ready initialization
document.addEventListener("DOMContentLoaded", () => {
  // Detect OS for Smart CTA Highlighting
  detectUserOS();

  // Init Language (check localStorage or default 'tr')
  const savedLang = localStorage.getItem("echomind_lang") || "tr";
  setLanguage(savedLang);

  // Point download buttons at the newest GitHub release
  loadLatestRelease();

  // Init DLP Sandbox Input & Output Elements
  const dlpInput = document.getElementById("dlpInput");
  const dlpOutput = document.getElementById("dlpOutput");
  if (dlpInput && dlpOutput) {
    if (!dlpInput.value || dlpInput.value.trim() === "") {
      dlpInput.value = sampleDlpTexts[savedLang] || sampleDlpTexts.tr;
    }
    dlpOutput.innerHTML = simulateDLP(dlpInput.value);

    dlpInput.addEventListener("input", (e) => {
      dlpOutput.innerHTML = simulateDLP(e.target.value);
    });
  }

  const langBtn = document.getElementById("langToggleBtn");
  if (langBtn) {
    langBtn.addEventListener("click", () => {
      setLanguage(currentLang === "tr" ? "en" : "tr");
    });
  }

  // Init Hardware Advisor buttons
  document.querySelectorAll(".hw-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectHardware(btn.getAttribute("data-hw"));
    });
  });

  // Dynamic Island Transcript Rotation
  let transcriptIdx = 0;
  const transcriptEl = document.getElementById("islandTranscriptText");
  if (transcriptEl) {
    setInterval(() => {
      const list = transcripts[currentLang] || transcripts.tr;
      transcriptIdx = (transcriptIdx + 1) % list.length;
      transcriptEl.style.opacity = 0;
      setTimeout(() => {
        transcriptEl.textContent = list[transcriptIdx];
        transcriptEl.style.opacity = 1;
      }, 300);
    }, 4000);
  }

  // Init screenshot slider
  initShowcaseSlider();
});

// ---------------------------------------------------------------------------
// Screenshot slider. Real captures of the running app (macOS, v0.2.12);
// web-optimized copies live in assets/screenshots/web/{tr,en}/ and the
// full-resolution PNGs next to them.
// ---------------------------------------------------------------------------
const SHOWCASE_SLIDES = [
  {
    shot: "01-main-empty",
    title: { tr: "Ana Ekran", en: "Main Window" },
    caption: {
      tr: "Tek tıkla dinlemeye başlayın veya bir ses dosyası yükleyin; geçmiş toplantılar solda listelenir.",
      en: "Start listening with one click or import an audio file; past meetings are listed on the left.",
    },
  },
  {
    shot: "02-recording",
    title: { tr: "Kayıt Başladı", en: "Recording Started" },
    caption: {
      tr: "Canlı dinleme sırasında mikrofon durumu ve sistem sesi yakalanıp yakalanmadığı açıkça gösterilir.",
      en: "While listening, the app clearly shows the microphone state and whether system audio is captured.",
    },
  },
  {
    shot: "03-live-transcript",
    title: { tr: "Canlı Transkripsiyon", en: "Live Transcription" },
    caption: {
      tr: "Toplantı sırasında konuşmalar cihazınızdaki Whisper modeliyle anlık olarak yazıya dökülür; ses bilgisayarınızdan çıkmaz.",
      en: "Speech is transcribed live by the Whisper model on your device; the audio never leaves your computer.",
    },
  },
  {
    shot: "04-meeting-detail",
    title: { tr: "Toplantı Detayı", en: "Meeting Detail" },
    caption: {
      tr: "Geçmiş bir toplantıyı açın, sesi dinleyin ve zaman damgalı konuşma akışında gezinin.",
      en: "Open a past meeting, play back the audio and browse the timestamped dialogue stream.",
    },
  },
  {
    shot: "13-meeting-report",
    title: { tr: "Toplantı Raporu", en: "Meeting Report" },
    caption: {
      tr: "Toplantı bittiğinde amaç, öne çıkan başlıklar, kararlar ve görevler otomatik bir rapora dönüşür.",
      en: "When the meeting ends, its purpose, highlights, decisions and tasks turn into an automatic report.",
    },
  },
  {
    shot: "14-smart-assistant",
    title: { tr: "Akıllı Asistan • ⌘K", en: "Smart Advisor • ⌘K" },
    caption: {
      tr: "Tüm toplantı arşivinizi tarayarak kararlar, görevler ve konuşmalar hakkındaki sorularınızı yanıtlar.",
      en: "Searches your whole meeting archive to answer questions about decisions, tasks and discussions.",
    },
  },
  {
    shot: "12-floating-island",
    title: { tr: "Floating Island", en: "Floating Island" },
    caption: {
      tr: "Meet, Zoom veya Teams toplantısı algılandığında ekranın üstünde kayıt başlatma önerisi belirir.",
      en: "When a Meet, Zoom or Teams call is detected, a prompt to start recording appears at the top of the screen.",
    },
  },
  {
    shot: "15-privacy-mode-menu",
    title: { tr: "Gizlilik Profili", en: "Privacy Profile" },
    caption: {
      tr: "Paranoid, Dengeli ve Maksimum Zeka profilleri arasında üst menüden anında geçiş yapın.",
      en: "Switch instantly between Paranoid, Balanced and Max Intelligence from the header menu.",
    },
  },
  {
    shot: "06-privacy-mode",
    title: { tr: "Cihaz & Gizlilik", en: "Device & Privacy" },
    caption: {
      tr: "Verinin cihazdan çıkıp çıkmayacağına siz karar verin; donanım bilgileri de burada görünür.",
      en: "Decide whether any data may leave the device; your hardware details are shown here too.",
    },
  },
  {
    shot: "05-settings-audio",
    title: { tr: "Mikrofon & Sistem Sesi", en: "Microphone & System Audio" },
    caption: {
      tr: "Mikrofon seçimi, canlı ses seviyesi ve karşı tarafı kaydetmek için Loopback / BlackHole rehberi.",
      en: "Microphone selection, a live input meter and a Loopback / BlackHole guide for capturing remote audio.",
    },
  },
  {
    shot: "07-model-hub",
    title: { tr: "Model Merkezi • Yerel", en: "Model Hub • Local" },
    caption: {
      tr: "Apple Dikte, SenseVoice ve Whisper gibi tamamen çevrimdışı çalışan motorlar arasından seçim yapın.",
      en: "Choose between fully offline engines such as Apple Dictation, SenseVoice and Whisper.",
    },
  },
  {
    shot: "11-model-hub-cloud",
    title: { tr: "Model Merkezi • Bulut", en: "Model Hub • Cloud" },
    caption: {
      tr: "İsterseniz kendi anahtarınızla Groq, Gemini veya OpenAI ile saniyeler içinde yazıya dökün.",
      en: "Optionally transcribe in seconds with Groq, Gemini or OpenAI using your own key.",
    },
  },
  {
    shot: "08-settings-ai-services",
    title: { tr: "Yapay Zeka Servisleri", en: "AI Services" },
    caption: {
      tr: "Yerel LLM sunucusu (Ollama / LM Studio) ve bulut anahtarları; anahtarlar cihazınızda saklanır.",
      en: "Local LLM server (Ollama / LM Studio) and cloud keys; keys are stored on your device.",
    },
  },
  {
    shot: "10-settings-language",
    title: { tr: "Arayüz Dili", en: "App Language" },
    caption: {
      tr: "Türkçe, İngilizce, Almanca, Fransızca ve İspanyolca arayüz desteği.",
      en: "Interface available in Turkish, English, German, French and Spanish.",
    },
  },
  {
    shot: "16-secure-storage-unlocking",
    title: { tr: "Güvenli Depolama", en: "Secure Storage" },
    caption: {
      tr: "Toplantı geçmişi şifreli saklanır; açılışta anahtar sistem Anahtarlığı'ndan alınır.",
      en: "Meeting history is stored encrypted; on launch the key is fetched from the system Keychain.",
    },
  },
];

const SLIDER_UI = {
  tr: {
    prev: "Önceki ekran",
    next: "Sonraki ekran",
    region: "EchoMind ekran görüntüleri",
    goto: "Ekran",
  },
  en: {
    prev: "Previous screen",
    next: "Next screen",
    region: "EchoMind screenshots",
    goto: "Screen",
  },
};

let showcaseIndex = 2;

function showcaseLang() {
  return currentLang === "en" ? "en" : "tr";
}

function showcaseSrc(i, lang) {
  return `assets/screenshots/web/${lang}/${SHOWCASE_SLIDES[i].shot}.webp`;
}

function renderShowcaseSlide(index) {
  const n = SHOWCASE_SLIDES.length;
  showcaseIndex = ((index % n) + n) % n;
  const lang = showcaseLang();
  const slide = SHOWCASE_SLIDES[showcaseIndex];
  const ui = SLIDER_UI[lang];

  const imgEl = document.getElementById("showcaseMainImg");
  const titleEl = document.getElementById("sliderTitle");
  const captionEl = document.getElementById("showcaseCaptionText");
  const counterEl = document.getElementById("sliderCounter");
  const sliderEl = document.getElementById("shotSlider");
  if (!imgEl) return;

  const nextSrc = showcaseSrc(showcaseIndex, lang);
  if (imgEl.getAttribute("src") !== nextSrc) {
    imgEl.style.opacity = "0.35";
    const loader = new Image();
    loader.onload = loader.onerror = () => {
      imgEl.src = nextSrc;
      imgEl.style.opacity = "1";
    };
    loader.src = nextSrc;
  }
  imgEl.alt = slide.title[lang];
  if (titleEl) titleEl.textContent = slide.title[lang];
  if (captionEl) captionEl.textContent = slide.caption[lang];
  if (counterEl) counterEl.textContent = `${showcaseIndex + 1} / ${n}`;
  if (sliderEl) sliderEl.setAttribute("aria-label", ui.region);

  const prevBtn = document.getElementById("sliderPrev");
  const nextBtn = document.getElementById("sliderNext");
  if (prevBtn) prevBtn.setAttribute("aria-label", ui.prev);
  if (nextBtn) nextBtn.setAttribute("aria-label", ui.next);

  document.querySelectorAll("#sliderDots .slider-dot").forEach((dot, i) => {
    const active = i === showcaseIndex;
    dot.classList.toggle("active", active);
    dot.setAttribute("aria-selected", active ? "true" : "false");
    dot.setAttribute(
      "aria-label",
      `${ui.goto} ${i + 1}: ${SHOWCASE_SLIDES[i].title[lang]}`,
    );
  });

  // Warm the cache for the neighbours so arrow clicks feel instant.
  [showcaseIndex - 1, showcaseIndex + 1].forEach((j) => {
    const k = ((j % n) + n) % n;
    new Image().src = showcaseSrc(k, lang);
  });
}

function initShowcaseSlider() {
  const sliderEl = document.getElementById("shotSlider");
  const dotsEl = document.getElementById("sliderDots");
  if (!sliderEl || !dotsEl) return;

  dotsEl.innerHTML = "";
  SHOWCASE_SLIDES.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "slider-dot";
    dot.setAttribute("role", "tab");
    dot.addEventListener("click", () => renderShowcaseSlide(i));
    dotsEl.appendChild(dot);
  });

  document
    .getElementById("sliderPrev")
    .addEventListener("click", () => renderShowcaseSlide(showcaseIndex - 1));
  document
    .getElementById("sliderNext")
    .addEventListener("click", () => renderShowcaseSlide(showcaseIndex + 1));

  sliderEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      renderShowcaseSlide(showcaseIndex - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      renderShowcaseSlide(showcaseIndex + 1);
    }
  });

  let touchX = null;
  sliderEl.addEventListener(
    "touchstart",
    (e) => {
      touchX = e.touches[0].clientX;
    },
    { passive: true },
  );
  sliderEl.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 40)
      renderShowcaseSlide(showcaseIndex + (dx < 0 ? 1 : -1));
  });

  renderShowcaseSlide(showcaseIndex);
}

// ---------------------------------------------------------------------------
// Latest release: the HTML ships working links to a known release as a
// fallback; on load we ask the GitHub API for the newest release and swap in
// its asset URLs, sizes and version so the site never points at a stale build.
// ---------------------------------------------------------------------------
const RELEASES_API =
  "https://api.github.com/repos/sewox/EchoMind/releases/latest";
let latestRelease = null;

async function loadLatestRelease() {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    const data = await res.json();
    const assets = {};
    (data.assets || []).forEach((a) => {
      // EchoMind_0.2.12_x64-setup.exe -> key "x64-setup.exe"
      const m = a.name.match(/^EchoMind_[\d.]+_(.+)$/);
      if (m) {
        assets[m[1]] = {
          url: a.browser_download_url,
          mb: (a.size / (1024 * 1024)).toFixed(1),
        };
      }
    });
    if (!data.tag_name || Object.keys(assets).length === 0) return;
    latestRelease = { version: data.tag_name, assets };
    applyLatestRelease();
  } catch {
    // Offline or rate-limited: keep the fallback links from the HTML.
  }
}

function applyLatestRelease() {
  if (!latestRelease) return;
  document
    .querySelectorAll('a[href*="/releases/download/"], a[data-release-asset]')
    .forEach((a) => {
      // Remember which asset a button is for, so re-applying (e.g. after a
      // language switch) doesn't depend on the current href shape.
      if (!a.dataset.releaseAsset) {
        const m = a.getAttribute("href").match(/EchoMind_[\d.]+_([^/]+)$/);
        if (m) a.dataset.releaseAsset = m[1];
      }
      const asset = latestRelease.assets[a.dataset.releaseAsset];
      if (!asset) return;
      a.href = asset.url;
      a.querySelectorAll("span").forEach((span) => {
        span.textContent = span.textContent.replace(
          /\([\d.,]+\s*MB\)/,
          `(${asset.mb} MB)`,
        );
      });
    });
  const badge = document.querySelector('[data-i18n="badgeRelease"]');
  if (badge) {
    badge.textContent = badge.textContent.replace(
      /v\d+\.\d+\.\d+/,
      latestRelease.version,
    );
  }
}
