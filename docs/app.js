// EchoMind Interactive Landing Engine (Full Bilingual & OS-Aware)

const sampleDlpTexts = {
  tr: "Toplantıda müşteri TCKN: 10987654328 ve Kartı 4532890123456789 ile sk-live9876543210abcdef anahtarını onayladı.",
  en: "In the meeting, customer ID: 10987654328 and Card: 4532890123456789 with API Key sk-live9876543210abcdef were confirmed.",
};

const translations = {
  tr: {
    navFeatures: "Özellikler",
    navSecurity: "Güvenlik & DLP",
    navHardware: "Donanım",
    navDownload: "İndir",
    badgeRelease: "EchoMind v0.2.0 Yayında • Sıfır-Güven Mimarisi",
    badgeProductHunt: "🚀 Product Hunt'ta Keşfedin",
    heroTitle: "Toplantılarınızı Donanım Gücüyle Dinleyen Hibrit Yapay Zekâ",
    heroSubtitle:
      "Apple Metal ve NVIDIA CUDA ile %100 yerel ve gizli çalışabilen, kurumsal DLP ve toplantılar arası semantik hafıza sunan yeni nesil masaüstü toplantı asistanı.",
    btnDownloadWindows: "Windows (.exe İndir)",
    btnDownloadMac: "macOS (.dmg İndir)",
    btnGithub: "GitHub Kaynak Kodu",
    hudTitle: "EchoMind Kayan HUD Arayüzü • macOS / Windows",
    islandStatus: "Canlı Toplantı • Dinamik Ada",
    islandEngineBadge: "Whisper Metal • 0.12x",
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
    btnDownloadWinMsi: "İndir .msi (7.0 MB)",
    btnDownloadMacDmg: "İndir .dmg (8.4 MB)",
    footerText:
      "EchoMind © 2026. Açık Kaynaklı ve Sıfır-Güven Toplantı Zekâsı Platformu.",
  },
  en: {
    navFeatures: "Features",
    navSecurity: "Security & DLP",
    navHardware: "Hardware",
    navDownload: "Download",
    badgeRelease: "EchoMind v0.2.0 Released • Zero-Trust Architecture",
    badgeProductHunt: "🚀 Discover on Product Hunt",
    heroTitle: "Hardware-Aware Hybrid AI Meeting Intelligence",
    heroSubtitle:
      "A next-generation desktop meeting assistant that runs 100% locally with Apple Metal & NVIDIA CUDA, featuring enterprise DLP and cross-meeting semantic memory.",
    btnDownloadWindows: "Download for Windows (.exe)",
    btnDownloadMac: "Download for macOS (.dmg)",
    btnGithub: "GitHub Repository",
    hudTitle: "EchoMind Floating HUD Overlay • macOS / Windows",
    islandStatus: "Live Meeting • Dynamic Island",
    islandEngineBadge: "Whisper Metal • 0.12x",
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
    btnDownloadWinMsi: "Download .msi (7.0 MB)",
    btnDownloadMacDmg: "Download .dmg (8.4 MB)",
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
});
