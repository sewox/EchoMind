export interface MeetingTemplate {
  id: string;
  name: string;
  description: string;
  icon: "Sparkles" | "UserCheck" | "Layers" | "TrendingUp" | "Lightbulb" | "Sliders";
  isCustom?: boolean;
  systemPrompt?: string;
}

export const BUILTIN_TEMPLATES: MeetingTemplate[] = [
  {
    id: "general",
    name: "Yönetici Özeti & Strateji",
    description: "Kapsamlı kararlar, aksiyonlar ve stratejik çıkarımlar",
    icon: "Sparkles",
  },
  {
    id: "one_on_one",
    name: "1-on-1 Birebir Görüşme",
    description: "Kariyer hedefleri, motivasyon, engeller ve geri bildirimler",
    icon: "UserCheck",
  },
  {
    id: "sprint_planning",
    name: "Sprint & Teknik Planlama",
    description: "Sprint hedefleri, kullanıcı hikayeleri, mimari kararlar ve blocker'lar",
    icon: "Layers",
  },
  {
    id: "sales_bant",
    name: "Satış & Müşteri (BANT)",
    description: "Bütçe, karar verici, temel ihtiyaç, takvim ve itirazlar",
    icon: "TrendingUp",
  },
  {
    id: "brainstorming",
    name: "Beyin Fırtınası & İnovasyon",
    description: "Üretilen fikirler, öne çıkan konseptler ve sonraki adımlar",
    icon: "Lightbulb",
  },
];
