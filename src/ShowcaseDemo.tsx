import {
  Square,
  Settings,
  ShieldCheck,
  Sparkles,
  Calendar,
  Clock,
  Search,
  CheckCircle2,
  BarChart3,
  Play,
  Volume2,
  Cpu,
  Lock,
  Download,
  CheckSquare,
} from "lucide-react";
import { EchoMindLogo } from "./components/EchoMindLogo";

export function ShowcaseDemo() {
  const urlParams = new URLSearchParams(window.location.search);
  const demoType = urlParams.get("demo") || "live";

  return (
    <div className="w-screen h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans overflow-hidden select-none">
      {/* Top Window Bar */}
      <header className="h-12 bg-[#0c1222] border-b border-slate-800/80 px-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 mr-2">
            <span className="w-3 h-3 rounded-full bg-red-500/80"></span>
            <span className="w-3 h-3 rounded-full bg-amber-500/80"></span>
            <span className="w-3 h-3 rounded-full bg-emerald-500/80"></span>
          </div>
          <EchoMindLogo />
          <span className="text-xs font-semibold tracking-wider text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/50">
            v0.2.0 • Zero-Trust
          </span>
        </div>

        {/* Status Center */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Whisper Metal (Apple M-Series GPU)</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium">
            <ShieldCheck size={14} />
            <span>DLP Aktif (Luhn + TCKN)</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button className="px-3 py-1 rounded-md bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 flex items-center gap-1.5 border border-slate-700/50">
            <Settings size={13} />
            <span>Ayarlar</span>
          </button>
        </div>
      </header>

      {/* Main Layout Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Meeting History */}
        <aside className="w-64 bg-[#0a0f1d] border-r border-slate-800/80 flex flex-col justify-between">
          <div className="p-3">
            <div className="relative mb-3">
              <Search
                size={14}
                className="absolute left-2.5 top-2.5 text-slate-500"
              />
              <input
                type="text"
                readOnly
                value="Toplantılarda ara..."
                className="w-full bg-slate-900/80 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-400 focus:outline-none"
              />
            </div>

            <div className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase px-1 mb-2">
              Son Toplantılar
            </div>

            <div className="space-y-1.5">
              {/* Active Meeting Item */}
              <div className="p-2.5 rounded-lg bg-indigo-600/15 border border-indigo-500/30 cursor-pointer">
                <div className="flex items-center justify-between text-xs font-semibold text-indigo-300 mb-1">
                  <span className="truncate">Q3 Ürün Lansmanı & Donanım</span>
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <Clock size={11} /> 00:42:15
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar size={11} /> Bugün
                  </span>
                </div>
              </div>

              {/* Past Meeting 2 */}
              <div className="p-2.5 rounded-lg bg-slate-900/40 border border-slate-800/60 hover:bg-slate-800/40 cursor-pointer">
                <div className="text-xs font-medium text-slate-300 truncate mb-1">
                  Yıllık Bütçe & Bulut Maliyetleri
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span>01:14:00</span>
                  <span>14 Mayıs</span>
                </div>
              </div>

              {/* Past Meeting 3 */}
              <div className="p-2.5 rounded-lg bg-slate-900/40 border border-slate-800/60 hover:bg-slate-800/40 cursor-pointer">
                <div className="text-xs font-medium text-slate-300 truncate mb-1">
                  Güvenlik & Sıfır-Güven Mimarisi
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span>00:35:40</span>
                  <span>22 Haziran</span>
                </div>
              </div>
            </div>
          </div>

          {/* Storage & Encryption Badge */}
          <div className="p-3 border-t border-slate-800/80 bg-slate-900/30">
            <div className="flex items-center gap-2 text-[11px] text-emerald-400">
              <Lock size={12} />
              <span>AES-256 Şifreli Yerel Depolama</span>
            </div>
          </div>
        </aside>

        {/* Right Content Area: Switched by demo type */}
        <main className="flex-1 flex flex-col bg-[#070b14] overflow-hidden">
          {demoType === "live" && <LiveTranscriptionView />}
          {demoType === "summary" && <SummaryReportView />}
          {demoType === "memory" && <SemanticMemoryView />}
          {demoType === "hardware" && <HardwareSettingsView />}
        </main>
      </div>
    </div>
  );
}

// 1. Live Transcription View Mock
function LiveTranscriptionView() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header bar */}
      <div className="h-14 border-b border-slate-800/80 px-6 flex items-center justify-between bg-slate-900/40">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
            <span className="text-xs font-bold uppercase tracking-wider">
              Canlı Kayıt
            </span>
          </div>
          <h2 className="text-sm font-semibold text-slate-200">
            Q3 Ürün Lansmanı & Metal Hızlandırma
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-800/80 rounded-md border border-slate-700 text-xs text-slate-300">
            <Volume2 size={13} className="text-cyan-400" />
            <span>Sistem Sesi + Mikrofon</span>
          </div>
          <button className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-red-600/20">
            <Square size={13} fill="currentColor" />
            <span>Toplantıyı Bitir</span>
          </button>
        </div>
      </div>

      {/* Transcript Stream */}
      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        {/* Segment 1: Ahmet */}
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-xs font-bold text-indigo-300">
            A
          </div>
          <div className="flex-1 bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-indigo-400">
                Ahmet (Kurucu)
              </span>
              <span className="text-[11px] text-slate-500">00:02:14</span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">
              Apple Silicon M3 Max donanımında Whisper Medium modelini 0.12x
              hızla çalıştırıyoruz. Müşteri API anahtarımız{" "}
              <span className="bg-red-500/20 text-red-300 border border-red-500/30 px-1.5 py-0.5 rounded text-[11px] font-mono">
                [REDACTED_API_KEY]
              </span>{" "}
              olarak DLP tarafından anında sansürlendi.
            </p>
          </div>
        </div>

        {/* Segment 2: Selin */}
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-600/30 border border-emerald-500/40 flex items-center justify-center text-xs font-bold text-emerald-300">
            S
          </div>
          <div className="flex-1 bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-emerald-400">
                Selin (Baş Mühendis)
              </span>
              <span className="text-[11px] text-slate-500">00:03:05</span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">
              Ödeme altyapısı için onaylanan kart{" "}
              <span className="bg-red-500/20 text-red-300 border border-red-500/30 px-1.5 py-0.5 rounded text-[11px] font-mono">
                [REDACTED_CARD: 4532]
              </span>{" "}
              ve TCKN{" "}
              <span className="bg-red-500/20 text-red-300 border border-red-500/30 px-1.5 py-0.5 rounded text-[11px] font-mono">
                [REDACTED_TCKN]
              </span>{" "}
              cihazdan dışarı çıkmadan istemci tarafında maskelendi.
            </p>
          </div>
        </div>

        {/* Segment 3: Can */}
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-cyan-600/30 border border-cyan-500/40 flex items-center justify-center text-xs font-bold text-cyan-300">
            C
          </div>
          <div className="flex-1 bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-cyan-400">
                Can (Ürün Yöneticisi)
              </span>
              <span className="text-[11px] text-slate-500">00:04:18</span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">
              Harika! Toplantı biter bitmez yerel Llama 3 modeliyle otomatik
              özeti alıp, ses kesitini FLAC formatında dışa aktarabiliriz.
            </p>
          </div>
        </div>
      </div>

      {/* Floating Audio Waveform HUD Bar */}
      <div className="p-4 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="w-1 h-3 bg-indigo-500 rounded-full animate-pulse"></span>
            <span className="w-1 h-6 bg-cyan-400 rounded-full animate-pulse"></span>
            <span className="w-1 h-4 bg-indigo-400 rounded-full animate-pulse"></span>
            <span className="w-1 h-7 bg-indigo-500 rounded-full animate-pulse"></span>
            <span className="w-1 h-2 bg-slate-600 rounded-full"></span>
          </div>
          <span className="text-xs text-slate-300 font-mono">
            Canlı Akış Dinleniyor... (0.12x Gerçek Zamanlı)
          </span>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>Sıfır Bulut Bağımlılığı</span>
        </div>
      </div>
    </div>
  );
}

// 2. Executive Summary & Analytics View Mock
function SummaryReportView() {
  return (
    <div className="flex-1 p-6 space-y-5 overflow-y-auto">
      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-base font-bold text-slate-100 mb-1">
            🎯 Q3 Ürün Lansmanı & Metal Hızlandırma • Toplantı Raporu
          </h1>
          <p className="text-xs text-slate-400">
            Toplantı Süresi: 42 Dakika • 3 Katılımcı • Ollama Yerel Özet Motoru
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5">
            <Download size={13} />
            <span>PDF / Markdown İndir</span>
          </button>
        </div>
      </div>

      {/* Grid: Goals & Decisions */}
      <div className="grid grid-cols-2 gap-4">
        {/* Goals */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Sparkles size={14} /> Toplantı Amacı & Hedefi
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            Whisper.cpp Apple Metal GPU performansını doğrulamak, istemci tarafı
            DLP kurallarını test etmek ve Q3 lansman tarihini netleştirmek.
          </p>
        </div>

        {/* Decisions */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-2">
            <CheckCircle2 size={14} /> Alınan Kritik Kararlar
          </h3>
          <ul className="text-xs text-slate-300 space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-emerald-400">✔</span>
              <span>
                Whisper Medium modeli varsayılan yerel model olarak seçildi.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400">✔</span>
              <span>
                Luhn kredi kartı ve TCKN maskelemesi varsayılan aktif kılındı.
              </span>
            </li>
          </ul>
        </div>
      </div>

      {/* Action Items List */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <CheckSquare size={14} /> Yapılacak Görevler & Aksiyon Maddeleri
        </h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/50">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                defaultChecked
                className="rounded text-indigo-500"
              />
              <span className="text-xs text-slate-200">
                macOS DMG ve Windows NSIS kurulum paketlerini derle
              </span>
            </div>
            <span className="text-[11px] font-semibold text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/40">
              Selin (Tamamlandı)
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/50">
            <div className="flex items-center gap-2.5">
              <input type="checkbox" className="rounded text-indigo-500" />
              <span className="text-xs text-slate-200">
                Product Hunt lansman tanıtım metnini hazırla
              </span>
            </div>
            <span className="text-[11px] font-semibold text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800/40">
              Can (Devam Ediyor)
            </span>
          </div>
        </div>
      </div>

      {/* Speaker Analytics Bar */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <BarChart3 size={14} className="text-amber-400" /> Konuşmacı Katılım
            Dengesi
          </h3>
          <span className="text-[11px] text-slate-400">
            Denge Skoru: %88 (Mükemmel)
          </span>
        </div>
        <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden flex gap-1 mb-2">
          <div
            style={{ width: "55%" }}
            className="bg-indigo-500 rounded-l-full"
            title="Ahmet %55"
          ></div>
          <div
            style={{ width: "30%" }}
            className="bg-emerald-500"
            title="Selin %30"
          ></div>
          <div
            style={{ width: "15%" }}
            className="bg-cyan-500 rounded-r-full"
            title="Can %15"
          ></div>
        </div>
        <div className="flex justify-between text-[11px] text-slate-400">
          <span>Ahmet (%55)</span>
          <span>Selin (%30)</span>
          <span>Can (%15)</span>
        </div>
      </div>
    </div>
  );
}

// 3. Cross-Meeting Semantic Memory View Mock
function SemanticMemoryView() {
  return (
    <div className="flex-1 p-6 space-y-4 overflow-y-auto">
      <div className="bg-slate-900/80 border border-indigo-500/40 rounded-xl p-4 shadow-xl">
        <div className="flex items-center gap-2 mb-2 text-xs font-bold text-indigo-400 uppercase tracking-wider">
          <Sparkles size={15} /> Toplantılar Arası Semantik Hafıza Asistanı
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value="Geçen ay bütçe ve donanım hızlandırma için ne konuşulmuştu?"
            className="flex-1 bg-slate-950 border border-indigo-500/30 rounded-lg px-3 py-2 text-xs text-slate-100 font-medium"
          />
          <button className="px-4 py-2 bg-indigo-600 rounded-lg text-xs font-semibold text-white">
            Sorgula
          </button>
        </div>
      </div>

      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
        ↳ 3 Farklı Toplantıdan 3 Alıntı & Ses Kesiti Bulundu
      </div>

      <div className="space-y-3">
        {/* Citation 1 */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-cyan-400">
              📅 14 Mayıs • Yıllık Bütçe Toplantısı (00:24:10)
            </span>
            <button className="px-2 py-1 rounded bg-slate-800 text-[11px] text-indigo-300 hover:bg-slate-700 flex items-center gap-1">
              <Play size={10} /> <span>Sesi Çal (25s Kesit)</span>
            </button>
          </div>
          <p className="text-xs text-slate-300 italic">
            "Selin: Yerel Whisper motoruyla bulut transkripsiyon maliyetini
            sıfıra indirdik, sunucu bütçesini %40 düşürebiliriz."
          </p>
        </div>

        {/* Citation 2 */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-emerald-400">
              📅 22 Haziran • Güvenlik & Sıfır-Güven (00:12:05)
            </span>
            <button className="px-2 py-1 rounded bg-slate-800 text-[11px] text-indigo-300 hover:bg-slate-700 flex items-center gap-1">
              <Play size={10} /> <span>Sesi Çal (40s Kesit)</span>
            </button>
          </div>
          <p className="text-xs text-slate-300 italic">
            "Ahmet: Tüm toplantı verileri diskte AES-256 ile şifreli kalacak ve
            BYOK modeliyle API anahtarları istemcide saklanacak."
          </p>
        </div>
      </div>
    </div>
  );
}

// 4. Hardware & Settings View Mock
function HardwareSettingsView() {
  return (
    <div className="flex-1 p-6 space-y-5 overflow-y-auto">
      <div className="border-b border-slate-800 pb-3">
        <h2 className="text-sm font-bold text-slate-100">
          ⚡ Donanım Farkındalıklı Model Merkezi & Hızlandırma
        </h2>
        <p className="text-xs text-slate-400">
          Sisteminizdeki GPU ve CPU çekirdeklerine göre optimize edilmiş Whisper
          modelleri.
        </p>
      </div>

      {/* Hardware Detected Box */}
      <div className="bg-slate-900/80 border border-emerald-500/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Cpu size={18} className="text-emerald-400" />
            <span className="text-xs font-bold text-slate-200">
              Algılanan Donanım: Apple M3 Max (36 GB Birleşik Bellek)
            </span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold">
            Metal GPU Aktif (0.12x Hız)
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg">
            <div className="text-[11px] text-slate-400">Metal Hızlandırıcı</div>
            <div className="text-xs font-bold text-emerald-400">
              Apple Metal 3 (Destekleniyor)
            </div>
          </div>
          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg">
            <div className="text-[11px] text-slate-400">NVIDIA CUDA</div>
            <div className="text-xs font-bold text-slate-500">
              Kullanılamıyor (macOS)
            </div>
          </div>
          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg">
            <div className="text-[11px] text-slate-400">Vektör Motoru</div>
            <div className="text-xs font-bold text-cyan-400">
              Apple Neural Engine (ANE)
            </div>
          </div>
        </div>
      </div>

      {/* Model Selection Cards */}
      <div className="space-y-3">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Kullanılabilir Whisper Modelleri
        </div>

        <div className="p-3.5 rounded-xl bg-indigo-600/15 border border-indigo-500/40 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-100">
                Whisper Medium.en / Small.multilingual
              </span>
              <span className="px-2 py-0.5 rounded bg-indigo-500/30 text-indigo-300 text-[10px] font-bold">
                ÖNERİLEN
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              1.5 GB VRAM • Yüksek Doğruluk • 0.15x Gerçek Zamanlı
              Transkripsiyon
            </div>
          </div>
          <span className="text-xs font-bold text-emerald-400">
            ✔ Yüklü & Aktif
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-slate-300">
              Whisper Large-v3 (FP16)
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              3.1 GB VRAM • Maksimum Doğruluk • 0.25x Gerçek Zamanlı
            </div>
          </div>
          <button className="px-3 py-1 rounded bg-slate-800 text-slate-300 text-xs hover:bg-slate-700">
            Modeli İndir (1.5 GB)
          </button>
        </div>
      </div>
    </div>
  );
}
