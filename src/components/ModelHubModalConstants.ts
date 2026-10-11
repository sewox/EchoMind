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

/** Gemini model used when none is chosen. */
export const GEMINI_DEFAULT_MODEL = "gemini-3.6-flash";

/**
 * The Gemini model to use. Google shut down Gemini 1.x and 2.0, so a model
 * saved back then (or none at all) falls back to the default.
 */
export const currentGeminiModel = (
  saved: string | null | undefined,
): string => {
  const model = saved?.trim();
  return !model || /^gemini-(1\.|2\.0)/.test(model)
    ? GEMINI_DEFAULT_MODEL
    : model;
};

export const GEMINI_MODELS = [
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    tag: "recommendedSmart",
    desc: "En dengeli hız ve çok dilli anlama",
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    tag: "fastEconomic",
    desc: "En hızlı ve en ekonomik seçenek",
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    tag: "highestIntel",
    desc: "En gelişmiş Flash modeli",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    desc: "Önceki nesil (yalnızca eski hesaplar)",
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    desc: "Önceki nesil (yalnızca eski hesaplar)",
  },
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
