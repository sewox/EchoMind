export const GROQ_MODELS = [
  {
    id: "whisper-large-v3-turbo",
    name: "Whisper Large v3 Turbo",
    tag: "recommendedFast",
    desc: "Ultra hızlı ve yüksek hassasiyet",
  },
  {
    id: "whisper-large-v3",
    name: "Whisper Large v3",
    tag: "maxAccuracy",
    desc: "Detaylı ve karmaşık sesler için",
  },
  {
    id: "distil-whisper-large-v3-en",
    name: "Distil Whisper Large v3",
    tag: "englishOnly",
    desc: "İngilizce toplantılar için optimize",
  },
  {
    id: "custom",
    name: "➕ Özel Model İsmi Gir...",
    tag: "customModel",
    desc: "Groq üzerindeki herhangi bir modeli manuel yazın",
  },
];

export const GEMINI_MODELS = [
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    tag: "recommendedSmart",
    desc: "En dengeli hız ve çok dilli anlama",
  },
  {
    id: "gemini-1.5-flash-8b",
    name: "Gemini 1.5 Flash 8B",
    tag: "ultraLight",
    desc: "Düşük gecikmeli ve son derece hızlı",
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    tag: "deepReasoning",
    desc: "Karmaşık teknik toplantılar ve detaylı analiz",
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    tag: "nextGenSpeed",
    desc: "Ultra düşük gecikme ve yüksek zeka",
  },
  {
    id: "gemini-2.0-flash-lite",
    name: "Gemini 2.0 Flash Lite",
    tag: "fastEconomic",
    desc: "Yeni nesil hafif multimodal model",
  },
  {
    id: "gemini-2.0-pro-exp-02-05",
    name: "Gemini 2.0 Pro Experimental",
    tag: "highestIntel",
    desc: "Deneysel en gelişmiş muhakeme modeli",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    desc: "Gelişmiş Flash sürümü",
  },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", desc: "Gelişmiş Pro sürümü" },
  {
    id: "custom",
    name: "➕ Özel Model İsmi Gir...",
    tag: "customModel",
    desc: "Google AI üzerindeki herhangi bir modeli manuel yazın",
  },
];

export const OPENAI_MODELS = [
  {
    id: "whisper-1",
    name: "Whisper-1",
    tag: "globalStandardAsr",
    desc: "OpenAI orijinal konuşma tanıma modeli",
  },
  {
    id: "gpt-4o-audio-preview",
    name: "GPT-4o Audio Preview",
    tag: "multimodalAudio",
    desc: "Native ses anlama ve çözümleme",
  },
  {
    id: "gpt-4o-mini-audio-preview",
    name: "GPT-4o Mini Audio Preview",
    desc: "Hafif native ses işleme",
  },
  {
    id: "custom",
    name: "➕ Özel Model İsmi Gir...",
    tag: "customModel",
    desc: "OpenAI üzerindeki herhangi bir modeli manuel yazın",
  },
];

type ModelOption = { id: string; name: string; tag?: string; desc: string };

/** Localized dropdown label: model names stay as-is, descriptive tags go through i18n. */
export const modelLabel = (
  m: ModelOption,
  t: (path: string) => string,
): string => {
  if (!m.tag) return m.name;
  if (m.tag === "customModel") return t("ui.models.customModel");
  return `${m.name} (${t(`ui.models.${m.tag}`)})`;
};
