import { createContext, useContext, useState, type ReactNode } from "react";
import { en } from "../locales/en";
import { zh } from "../locales/zh";

type Locale = "zh" | "en";
type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  zh,
  en,
};

const I18nContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: "zh",
  setLocale: () => {},
});

export function I18nProvider({ children, locale: initial = "zh" }: { children: ReactNode; locale?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initial);
  return <I18nContext.Provider value={{ locale, setLocale }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const { locale, setLocale } = useContext(I18nContext);
  return {
    locale,
    setLocale,
    t: (key: keyof typeof zh | string, params?: Record<string, string | number>) => {
      const template = dictionaries[locale][key] ?? dictionaries.zh[key] ?? key;
      if (!params) return template;
      return Object.entries(params).reduce(
        (value, [name, replacement]) => value.split(`{${name}}`).join(String(replacement)),
        template,
      );
    },
  };
}

export function useFormatters() {
  const { t } = useI18n();
  return {
    statusLabel: (status?: string | null) => (status ? t(`common.status.${status}`) : "-"),
    mediaTypeLabel: (mediaType?: string | null) => (mediaType ? t(`common.media.${mediaType}`) : t("common.media.media")),
    errorLabel: (error?: string | null) => (error ? t(`common.error.${error}`) : "-"),
    triggerLabel: (trigger?: string | null) => (trigger ? t(`common.trigger.${trigger}`) : "-"),
  };
}
