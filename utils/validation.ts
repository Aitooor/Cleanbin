// Shared validation rules for paste identifiers and payload size.

export const PASTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const MAX_PASTE_CONTENT_LENGTH = Number(
  process.env.MAX_PASTE_CONTENT_LENGTH || 1_000_000
);

export function isValidPasteId(id: unknown): id is string {
  return typeof id === 'string' && PASTE_ID_PATTERN.test(id);
}
