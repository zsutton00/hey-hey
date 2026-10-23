import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Import translation files
import { en } from "./locales/en";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";

// Export KEYS and translation resources for parent app consumption
export { KEYS } from "./keys";
export { en } from "./locales/en";
export { default as es } from "./locales/es.json";
export { default as fr } from "./locales/fr.json";
export { default as ja } from "./locales/ja.json";

// Export utility modules
export * from "./compose";
export * from "./terminology";
export * from "./hooks";
export * from "./types";

const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  ja: { translation: ja },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    debug: false, // Disable debug logging entirely

    // Language detection options
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
    },

    interpolation: {
      escapeValue: false, // React already escapes values
    },

    // Namespace options
    defaultNS: "translation",
    ns: ["translation"],

    // Disable missing key logging completely
    saveMissing: false,
    missingKeyHandler: () => {
      // Silent handler - do nothing when keys are missing
    },

    // React specific options
    react: {
      useSuspense: false, // Disable suspense for now
    },
  });

export default i18n;
