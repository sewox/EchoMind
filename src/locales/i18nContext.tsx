import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  ReactNode,
} from "react";
import { TranslationKeys, SupportedLanguage, LanguageOption } from "./types";
import { tr } from "./tr";
import { en } from "./en";
import { de } from "./de";
import { fr } from "./fr";
import { es } from "./es";

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "tr", name: "Türkçe", nativeName: "Türkçe", flag: "🇹🇷" },
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "de", name: "Deutsch", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "fr", name: "Français", nativeName: "Français", flag: "🇫🇷" },
  { code: "es", name: "Español", nativeName: "Español", flag: "🇪🇸" },
];

const dictionaries: Record<SupportedLanguage, TranslationKeys> = {
  tr,
  en,
  de,
  fr,
  es,
};

type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object
    ? `${Key}.${NestedKeyOf<ObjectType[Key]>}`
    : `${Key}`;
}[keyof ObjectType & (string | number)];

export type TranslationKeyPath = NestedKeyOf<TranslationKeys>;

interface I18nContextProps {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (
    path: TranslationKeyPath | string,
    params?: Record<string, string | number>,
  ) => string;
  languages: LanguageOption[];
  currentLanguageOption: LanguageOption;
}

const I18nContext = createContext<I18nContextProps | undefined>(undefined);

const STORAGE_KEY = "echomind_app_language";

export const I18nProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (
        saved &&
        (saved === "tr" ||
          saved === "en" ||
          saved === "de" ||
          saved === "fr" ||
          saved === "es")
      ) {
        return saved as SupportedLanguage;
      }
    } catch {
      // Ignore localStorage errors
    }
    return "tr";
  });

  const setLanguage = (lang: SupportedLanguage) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Ignore localStorage errors
    }
  };

  const currentDict = useMemo(() => {
    return dictionaries[language] || tr;
  }, [language]);

  const t = useMemo(() => {
    return (path: string, params?: Record<string, string | number>): string => {
      const parts = path.split(".");

      // Try active language first
      let current: any = currentDict;
      for (const part of parts) {
        if (current && typeof current === "object" && part in current) {
          current = current[part];
        } else {
          current = undefined;
          break;
        }
      }

      // Fallback to Turkish if not found
      if (current === undefined) {
        let fallback: any = tr;
        for (const part of parts) {
          if (fallback && typeof fallback === "object" && part in fallback) {
            fallback = fallback[part];
          } else {
            fallback = undefined;
            break;
          }
        }
        current = fallback !== undefined ? fallback : path;
      }

      if (typeof current !== "string") {
        return String(current ?? path);
      }

      // Parameter replacement ({count}, {name}, etc.)
      if (params) {
        return Object.entries(params).reduce((str, [k, v]) => {
          return str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }, current);
      }

      return current;
    };
  }, [currentDict]);

  const currentLanguageOption = useMemo(() => {
    return (
      SUPPORTED_LANGUAGES.find((l) => l.code === language) ||
      SUPPORTED_LANGUAGES[0]
    );
  }, [language]);

  return (
    <I18nContext.Provider
      value={{
        language,
        setLanguage,
        t,
        languages: SUPPORTED_LANGUAGES,
        currentLanguageOption,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextProps => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
};
