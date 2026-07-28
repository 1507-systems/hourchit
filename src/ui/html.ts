/** Escape a value for safe interpolation into HTML text/attributes. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Convert "\n" in stored addresses to <br> (after escaping). */
export function nl2br(value: string): string {
  return esc(value).replace(/\n/g, '<br>');
}
