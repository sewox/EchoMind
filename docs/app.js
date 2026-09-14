// EchoMind Interactive Landing Engine

const translations = {
  tr: {
    navFeatures: "Özellikler",
    navSecurity: "Güvenlik & DLP",
    navHardware: "Donanım",
    navDownload: "İndir",
    badgeRelease: "EchoMind v0.2.0 Yayında • Sıfır-Güven Mimarisi",
    heroTitle: "Toplantılarınızı Donanım Gücüyle Dinleyen Hibrit Yapay Zekâ",
    heroSubtitle: "Apple Metal ve NVIDIA CUDA ile %100 yerel ve gizli çalışabilen, kurumsal DLP ve toplantılar arası semantik hafıza sunan yeni nesil masaüstü toplantı asistanı.",
    btnDownloadWindows: "Windows İçin İndir (.exe)",
    btnDownloadMac: "macOS İçin İndir (.dmg)",
    btnGithub: "GitHub Kaynak Kodu",
    islandStatus: "Canlı Toplantı • Dinamik Ada",
    islandTranscript: "Ahmet: \"Q3 hedeflerimiz için yerel model hızlandırmasını tamamladık.\"",
    secFeaturesTitle: "Neden EchoMind?",
    secFeaturesSubtitle: "Tüm toplantı iş akışınızı gizlilikten ödün vermeden otomatikleştirin.",
    bentoHwTitle: "⚡ Donanım Farkındalıklı Hibrit Motor",
    bentoHwDesc: "Cihazınızın GPU (Metal, CUDA) ve CPU çekirdeklerini otomatik analiz ederek optimum Whisper modelini seçer.",
    bentoSecTitle: "🛡️ Kurumsal Seviye Canlı DLP Koruması",
    bentoSecDesc: "Toplantı sırasında telaffuz edilen veya metne dökülen TCKN, Kredi Kartı (Luhn), IBAN ve API anahtarlarını anında maskeler.",
    bentoMemTitle: "🧠 Toplantılar Arası Semantik Hafıza",
    bentoMemDesc: "Sadece anlık toplantıyı değil, aylar önceki konuşmaları da hatırlar. Doğal dilde soru sorarak kararlara ve alıntılara ulaşın.",
    bentoAudioTitle: "✂️ 1-Tıkla Ses Kesiti & Mini Podcast Çalar",
    bentoAudioDesc: "Kritik tartışmaları 15-60 saniyelik ses kesiti (soundbite) olarak kırpın veya dahili ses çalarla özetleri dinleyin.",
    dlpPlaceholder: "Buraya test metni yazın... Örnek: TCKN 12345678901, Kart 4532890123456789 veya sk-live123456789abcdef",
    secDownloadTitle: "Hemen İndirin ve Başlayın",
    secDownloadSubtitle: "Ücretsiz ve açık kaynaklı. Windows ve macOS işletim sistemleri için derlendi.",
    winSetupDesc: "Windows 10/11 x64 İçin Standart Kurulum Paketi",
    winMsiDesc: "Kurumsal Sistem Yöneticileri İçin Windows Installer",
    macDmgDesc: "Apple Silicon (M1/M2/M3/M4) İşlemcili Mac'ler İçin Disk İmajı",
    footerText: "EchoMind © 2026. Açık Kaynaklı ve Sıfır-Güven Toplantı Zekâsı Platformu."
  },
  en: {
    navFeatures: "Features",
    navSecurity: "Security & DLP",
    navHardware: "Hardware",
    navDownload: "Download",
    badgeRelease: "EchoMind v0.2.0 Released • Zero-Trust Architecture",
    heroTitle: "Hardware-Aware Hybrid AI Meeting Intelligence",
    heroSubtitle: "A next-generation desktop meeting assistant that runs 100% locally with Apple Metal & NVIDIA CUDA, featuring enterprise DLP and cross-meeting semantic memory.",
    btnDownloadWindows: "Download for Windows (.exe)",
    btnDownloadMac: "Download for macOS (.dmg)",
    btnGithub: "GitHub Repository",
    islandStatus: "Live Meeting • Dynamic Island",
    islandTranscript: "Alex: \"We have finalized the on-device acceleration for Q3 goals.\"",
    secFeaturesTitle: "Why Choose EchoMind?",
    secFeaturesSubtitle: "Automate your entire meeting intelligence workflow without compromising data privacy.",
    bentoHwTitle: "⚡ Hardware-Aware Hybrid Engine",
    bentoHwDesc: "Automatically analyzes GPU (Metal, CUDA) and CPU threads to recommend the optimal Whisper model with zero latency.",
    bentoSecTitle: "🛡️ Real-Time Enterprise DLP Guard",
    bentoSecDesc: "Instantly redacts Turkish IDs, Luhn-validated Credit Cards, IBANs, and API credentials as they are transcribed.",
    bentoMemTitle: "🧠 Cross-Meeting Semantic Memory",
    bentoMemDesc: "Remembers discussions from months ago. Ask natural questions and jump straight to audio timestamp citations.",
    bentoAudioTitle: "✂️ 1-Click Soundbite Clipper & Audio Memo Player",
    bentoAudioDesc: "Extract 15s-60s vital audio clips or listen to executive summaries through the integrated mini podcast player.",
    dlpPlaceholder: "Type sample text here... Example: CC 4532890123456789, National ID 12345678901, or API key sk-live123456789abcdef",
    secDownloadTitle: "Download and Get Started",
    secDownloadSubtitle: "Free and open-source. Compiled natively for Windows and macOS.",
    winSetupDesc: "Standard NSIS Installer for Windows 10/11 x64",
    winMsiDesc: "Enterprise Windows MSI Package for Administrators",
    macDmgDesc: "Native Apple Silicon Disk Image (M1/M2/M3/M4)",
    footerText: "EchoMind © 2026. Open-Source Zero-Trust Meeting Intelligence Platform."
  }
};

let currentLang = 'tr';

// Language Switcher Function
function setLanguage(lang) {
  currentLang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang] && translations[lang][key]) {
      el.textContent = translations[lang][key];
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (translations[lang] && translations[lang][key]) {
      el.placeholder = translations[lang][key];
    }
  });

  const langBtn = document.getElementById('langToggleBtn');
  if (langBtn) {
    langBtn.innerHTML = lang === 'tr' ? '🌐 English' : '🌐 Türkçe';
  }

  localStorage.setItem('echomind_lang', lang);
}

// Interactive DLP Engine Simulation
function simulateDLP(input) {
  if (!input || input.trim() === '') {
    return currentLang === 'tr' 
      ? 'Maskelenmiş çıktı burada anlık olarak görüntülenecektir...' 
      : 'Redacted real-time output will appear here...';
  }

  let sanitized = input;

  // Credit Card (13-19 digits, Luhn check)
  sanitized = sanitized.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
    const cleaned = match.replace(/[\s-]/g, '');
    if (luhnCheck(cleaned)) {
      return `<span class="redacted-tag">[REDACTED_CARD: ${cleaned.slice(-4)}]</span>`;
    }
    return match;
  });

  // TCKN (11 digits)
  sanitized = sanitized.replace(/\b[1-9]\d{10}\b/g, (match) => {
    return `<span class="redacted-tag">[REDACTED_TCKN]</span>`;
  });

  // IBAN (TR...)
  sanitized = sanitized.replace(/\bTR\d{2}[0-9A-Z]{5,30}\b/gi, (match) => {
    return `<span class="redacted-tag">[REDACTED_IBAN]</span>`;
  });

  // API Keys (sk-..., gsk_..., AIzaSy..., Bearer)
  sanitized = sanitized.replace(/\b(sk-[a-zA-Z0-9_-]{20,}|gsk_[a-zA-Z0-9_-]{20,}|AIzaSy[a-zA-Z0-9_-]{33}|ghp_[a-zA-Z0-9]{36})\b/g, () => {
    return `<span class="redacted-tag">[REDACTED_API_KEY]</span>`;
  });

  // Email
  sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, (match) => {
    return `<span class="redacted-tag">[REDACTED_EMAIL]</span>`;
  });

  // Phone numbers
  sanitized = sanitized.replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, () => {
    return `<span class="redacted-tag">[REDACTED_PHONE]</span>`;
  });

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
  return (sum % 10) === 0;
}

// Hardware Simulation Data
const hwProfiles = {
  appleSilicon: {
    engine: "Whisper.cpp (Apple Metal GPU / ANE)",
    model: "Whisper Medium.en / Small.multilingual",
    speed: "0.15x Real-Time (1 saatlik ses ~90 saniye)",
    ram: "1.2 GB VRAM / 0% CPU Throttling"
  },
  nvidiaRtx: {
    engine: "Whisper.cpp + CUDA 12.x",
    model: "Whisper Large-v3 (FP16)",
    speed: "0.08x Real-Time (1 saatlik ses ~45 saniye)",
    ram: "2.4 GB VRAM / Tensor Core Active"
  },
  intelCpu: {
    engine: "Whisper.cpp (AVX2 / FMA Vectorized)",
    model: "Whisper Base / Small (Q5_1 Quantized)",
    speed: "0.45x Real-Time (1 saatlik ses ~4.5 dakika)",
    ram: "600 MB RAM / Eco-Mode Active"
  }
};

function selectHardware(profileKey) {
  document.querySelectorAll('.hw-item-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-hw') === profileKey);
  });

  const profile = hwProfiles[profileKey];
  if (profile) {
    document.getElementById('hwEngineVal').textContent = profile.engine;
    document.getElementById('hwModelVal').textContent = profile.model;
    document.getElementById('hwSpeedVal').textContent = profile.speed;
    document.getElementById('hwRamVal').textContent = profile.ram;
  }
}

// DOM Ready initialization
document.addEventListener('DOMContentLoaded', () => {
  // Init Language
  const savedLang = localStorage.getItem('echomind_lang') || 'tr';
  setLanguage(savedLang);

  const langBtn = document.getElementById('langToggleBtn');
  if (langBtn) {
    langBtn.addEventListener('click', () => {
      setLanguage(currentLang === 'tr' ? 'en' : 'tr');
    });
  }

  // Init DLP Sandbox Listener
  const dlpInput = document.getElementById('dlpInput');
  const dlpOutput = document.getElementById('dlpOutput');
  if (dlpInput && dlpOutput) {
    // default sample text
    dlpInput.value = "Toplantıda müşteri TCKN: 10987654328 ve Kartı 4532890123456789 ile sk-live9876543210abcdef anahtarını onayladı.";
    dlpOutput.innerHTML = simulateDLP(dlpInput.value);

    dlpInput.addEventListener('input', (e) => {
      dlpOutput.innerHTML = simulateDLP(e.target.value);
    });
  }

  // Init Hardware Advisor buttons
  document.querySelectorAll('.hw-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectHardware(btn.getAttribute('data-hw'));
    });
  });

  // Dynamic Island Transcript Rotation
  const transcripts = [
    'Ahmet: "Q3 hedeflerimiz için yerel model hızlandırmasını tamamladık."',
    'Sarah: "All confidential customer data is redacted via local DLP rules."',
    'Can: "Geçen ayki toplantıda alınan bütçe kararlarını hafızadan getirdim."',
    'Elena: "Soundbite exported in 250ms. No cloud transmission detected."'
  ];
  let transcriptIdx = 0;
  const transcriptEl = document.getElementById('islandTranscriptText');
  if (transcriptEl) {
    setInterval(() => {
      transcriptIdx = (transcriptIdx + 1) % transcripts.length;
      transcriptEl.style.opacity = 0;
      setTimeout(() => {
        transcriptEl.textContent = transcripts[transcriptIdx];
        transcriptEl.style.opacity = 1;
      }, 300);
    }, 4000);
  }
});
