export const defaults = Object.freeze({ui: 'en', language: 'en', mode: 'conservative', mixedLanguage: true});
export function normalizeSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return {
    ui: ['en', 'de'].includes(value.ui) ? value.ui : defaults.ui,
    language: ['en', 'de'].includes(value.language) ? value.language : defaults.language,
    mode: ['conservative', 'balanced'].includes(value.mode) ? value.mode : defaults.mode,
    mixedLanguage: typeof value.mixedLanguage === 'boolean' ? value.mixedLanguage : defaults.mixedLanguage
  };
}
export async function readSettings(api) {
  return normalizeSettings(await api.storage.local.get(['ui', 'language', 'mode', 'mixedLanguage']));
}
