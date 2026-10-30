import messages from '../electron/locales.json';
import en from './welcome.en.md?raw';
import ko from './welcome.md?raw';
import zhHans from './welcome.zh-Hans.md?raw';
import zhHant from './welcome.zh-Hant.md?raw';
import ja from './welcome.ja.md?raw';

export const languages = { en: 'English', ko: '한국어', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文', ja: '日本語' };
export const welcomeDocuments = { en, ko, 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja };
let language = 'en';
export const getLanguage = () => language;
export function setLanguage(value) { language = Object.hasOwn(languages, value) ? value : 'en'; }
export function t(key, values = {}) {
  return (messages[language][key] ?? messages.en[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}
export function translateUI() {
  document.documentElement.lang = language;
  for (const attribute of ['text', 'title', 'aria-label', 'placeholder']) {
    const data = attribute === 'text' ? 'data-i18n' : `data-i18n-${attribute}`;
    document.querySelectorAll(`[${data}]`).forEach(element => {
      const value = t(element.getAttribute(data));
      if (attribute === 'text') element.textContent = value;
      else element.setAttribute(attribute, value);
    });
  }
}
