/**
 * Non-secret user preferences kept in localStorage. Spoken languages feed Muse Voice's languageBias hint;
 * leaving the list empty lets the model auto-detect.
 */

const KEY = 'group_os_spoken_languages';
export const DEFAULT_SPOKEN_LANGUAGES = ['English', 'Telugu', 'Hindi'];

export function parseLanguages(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,\n]/)
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => l.charAt(0).toUpperCase() + l.slice(1).toLowerCase())
    )
  ).slice(0, 6);
}

export function getSpokenLanguages(): string[] {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? DEFAULT_SPOKEN_LANGUAGES : parseLanguages(stored);
  } catch {
    return DEFAULT_SPOKEN_LANGUAGES;
  }
}

export function setSpokenLanguages(text: string): void {
  try {
    localStorage.setItem(KEY, parseLanguages(text).join(', '));
  } catch {
    /* storage blocked: the default applies */
  }
}
