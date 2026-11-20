// Texts in the browser's language (_locales/de, _locales/en): t('key') in scripts; in HTML,
// data-i18n sets the text and data-i18n-title the tooltip.
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs) || key;
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
