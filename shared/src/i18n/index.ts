/**
 * Localization runtime.
 *
 * English is the source language; see docs/LOCALIZATION.md for the glossary
 * and the rules every catalog entry must follow.
 *
 * Lookup order: current locale -> English -> the key itself. A missing English
 * entry is a bug, not a fallback path.
 */
import { EN } from './locales/en/index.js';
import { ZH } from './locales/zh/index.js';

export type Locale = 'en' | 'zh';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh'] as const;
export const DEFAULT_LOCALE: Locale = 'en';

/** Human-readable names, each written in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
};

export type Catalog = Record<string, string>;
export type TParams = Record<string, string | number>;

const CATALOGS: Record<Locale, Catalog> = { en: EN, zh: ZH };

let currentLocale: Locale = DEFAULT_LOCALE;

type Listener = (locale: Locale) => void;
const listeners = new Set<Listener>();

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Set the active locale and notify subscribers. No-op if unchanged. */
export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  for (const listener of listeners) listener(locale);
}

/**
 * Subscribe to locale changes. Canvas renderers must use this to redraw and to
 * drop any cached text measurements. Returns an unsubscribe function.
 */
export function onLocaleChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Pick the best supported locale for a browser language list. */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'zh') return 'zh';
    if (base === 'en') return 'en';
  }
  return DEFAULT_LOCALE;
}

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

function lookup(key: string): string | undefined {
  return CATALOGS[currentLocale][key] ?? CATALOGS.en[key];
}

/**
 * Translate a key.
 *
 * Pass a `count` param to select a plural form: `key_one` / `key_other` are
 * tried before the bare key. Chinese resolves to `_other` for every count,
 * which is correct — it has no plural inflection.
 */
export function t(key: string, params?: TParams): string {
  if (params && typeof params.count === 'number') {
    const suffix = currentLocale === 'en' && params.count === 1 ? '_one' : '_other';
    const plural = lookup(key + suffix);
    if (plural !== undefined) return interpolate(plural, params);
  }
  const entry = lookup(key);
  if (entry === undefined) {
    if (typeof console !== 'undefined') console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  return interpolate(entry, params);
}

/** True when the key resolves in the active locale or in English. */
export function hasKey(key: string): boolean {
  return lookup(key) !== undefined;
}

export * from './helpers.js';
