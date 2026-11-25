export const PASTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_PASTE_CONTENT_LENGTH = 1_000_000;
export const MAX_PASTE_NAME_LENGTH = 240;
export const MAX_REGEX_PATTERN_LENGTH = 120;

// Rejects nested quantifiers like (a+)+, (.*)*, ([a-z]+){2,} that trigger catastrophic backtracking (ReDoS).
const NESTED_QUANTIFIER_PATTERN = /(\([^()]*[+*?\}][^()]*\))\s*(?:[+*?]|\{\d+,?\d*\})/;

export function isValidPasteId(id: unknown): id is string {
  return typeof id === 'string' && PASTE_ID_PATTERN.test(id);
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && EMAIL_PATTERN.test(email.trim());
}

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function isSafeRegexPattern(pattern: string): boolean {
  if (!pattern || pattern.length > MAX_REGEX_PATTERN_LENGTH) return false;
  if (NESTED_QUANTIFIER_PATTERN.test(pattern)) return false;
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

export function compileSafeRegex(pattern: string): RegExp | null {
  if (!isSafeRegexPattern(pattern)) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}
