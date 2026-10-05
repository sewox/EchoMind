import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookText } from "lucide-react";
import { useI18n } from "../locales/i18nContext";

/**
 * Settings card: the user's own words (names, products, technical terms)
 * that speech recognition should expect. Short, specific lists work best.
 */
export const GlossaryCard: React.FC = () => {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    invoke<string>("get_glossary")
      .then((v) => setText(typeof v === "string" ? v : ""))
      .catch(() => {});
  }, []);

  const save = async () => {
    try {
      const saved = await invoke<string>("set_glossary", { terms: text });
      if (typeof saved === "string") setText(saved);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  const count = text.split("\n").filter((l) => l.trim()).length;

  return (
    <div
      className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3"
      data-testid="glossary-card"
    >
      <label
        htmlFor="glossary-terms"
        className="text-slate-200 font-semibold flex items-center gap-2"
      >
        <BookText className="w-4 h-4 text-cyan-400" />
        <span>{t("glossary.title")}</span>
      </label>
      <p className="text-slate-400 text-xs leading-relaxed">
        {t("glossary.desc")}
      </p>
      <textarea
        id="glossary-terms"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus("idle");
        }}
        rows={5}
        placeholder={t("glossary.placeholder")}
        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-200 placeholder-slate-500 font-mono text-xs focus:outline-none focus:border-cyan-500/70"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-slate-500">
          {t("glossary.count", { count })}
        </span>
        <div className="flex items-center gap-3">
          {status === "saved" && (
            <span className="text-[11px] text-emerald-300">
              {t("glossary.saved")}
            </span>
          )}
          {status === "error" && (
            <span role="alert" className="text-[11px] text-rose-300">
              {t("glossary.error")}
            </span>
          )}
          <button
            type="button"
            onClick={save}
            className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
          >
            {t("glossary.save")}
          </button>
        </div>
      </div>
    </div>
  );
};
