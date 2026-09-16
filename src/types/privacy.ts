export type PrivacyMode = "paranoid" | "balanced" | "max_intelligence";

export interface PrivacyModeConfig {
  id: PrivacyMode;
  iconName: "ShieldAlert" | "ShieldCheck" | "Zap";
  colorClass: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  allowCloud: boolean;
  forceLocalOnly: boolean;
  strictDlp: boolean;
}

export const PRIVACY_PROFILES: Record<PrivacyMode, PrivacyModeConfig> = {
  paranoid: {
    id: "paranoid",
    iconName: "ShieldAlert",
    colorClass: "purple",
    badgeBg: "bg-purple-950/60",
    badgeBorder: "border-purple-500/40",
    badgeText: "text-purple-300",
    allowCloud: false,
    forceLocalOnly: true,
    strictDlp: true,
  },
  balanced: {
    id: "balanced",
    iconName: "ShieldCheck",
    colorClass: "emerald",
    badgeBg: "bg-emerald-950/60",
    badgeBorder: "border-emerald-500/40",
    badgeText: "text-emerald-300",
    allowCloud: true,
    forceLocalOnly: false,
    strictDlp: true,
  },
  max_intelligence: {
    id: "max_intelligence",
    iconName: "Zap",
    colorClass: "cyan",
    badgeBg: "bg-cyan-950/60",
    badgeBorder: "border-cyan-500/40",
    badgeText: "text-cyan-300",
    allowCloud: true,
    forceLocalOnly: false,
    strictDlp: true,
  },
};
