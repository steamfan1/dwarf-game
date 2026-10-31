/**
 * UI text lookup. Every player-visible string goes through `t()` so the game can be
 * translated later by adding another JSON table next to src/data/strings/en.json.
 *
 *   t('title.build', { milestone: 3 })  ->  "Milestone 3 build"
 *
 * Placeholders are written `{name}`. Unknown keys fall back to the key itself, so a
 * missing translation is visible rather than blank.
 */
import en from '../data/strings/en.json';

export type StringKey = keyof typeof en;
export type StringParams = Record<string, string | number>;

let table: Readonly<Record<string, string>> = en;

export function t(key: StringKey, params?: StringParams): string {
  const template = table[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/** Swap the active table (for a future language picker, and for tests). Missing keys fall back to English. */
export function setStringTable(next: Readonly<Record<string, string>>): void {
  table = { ...en, ...next };
}

export function resetStringTable(): void {
  table = en;
}
