/**
 * Reduce an HTML mail body to readable plain text.
 *
 * This exists because a phone reply is usually HTML and nothing else, so
 * without it the stored text is empty and the classifier downstream has no
 * words to work with. It is a FALLBACK, not a renderer: the result is recorded
 * with body_is_derived = 1 precisely so nobody later mistakes it for what the
 * sender typed.
 *
 * Deliberately dependency-free and deliberately not a parser. A full HTML
 * parser in the mail path is a much larger attack surface, and this output is
 * never rendered as markup -- it is stored as text and read by a classifier or
 * a human, so the failure mode of getting it slightly wrong is a slightly ugly
 * string rather than an injection.
 */

const BLOCK_END = /<\/(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;

/** Entities common enough in real mail to be worth decoding by hand. */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

export function htmlToText(html: string): string {
  if (!html) return '';

  let s = html;

  // Drop anything whose CONTENT is not prose. style and script in particular
  // would otherwise dump CSS rules and code into the middle of the message.
  s = s.replace(/<(script|style|head|title)[\s\S]*?<\/\1\s*>/gi, ' ');

  // Comments, including the conditional comments Outlook scatters everywhere.
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // Turn structure into newlines BEFORE stripping tags, otherwise every block
  // runs together into a single unreadable line.
  s = s.replace(LINE_BREAK, '\n');
  s = s.replace(BLOCK_END, '\n');

  // Remaining tags.
  s = s.replace(/<[^>]+>/g, '');

  // Named entities we know, then numeric ones.
  for (const [entity, char] of Object.entries(ENTITIES)) {
    s = s.split(entity).join(char);
  }
  s = s.replace(/&#(\d+);/g, (_, code) => safeFromCodePoint(Number(code)));
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, code) => safeFromCodePoint(parseInt(code, 16)));

  // Normalize whitespace: trim each line, collapse runs of blank lines to one,
  // and drop leading/trailing blank space. Mail HTML is full of indentation
  // that means nothing once the tags are gone.
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return s;
}

/**
 * An out-of-range code point would throw and take the whole mail handler with
 * it, which would turn a malformed entity into lost mail.
 */
function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Choose what to store as the message's plain text.
 *
 * Prefers a real text/plain part; falls back to a rendering of the HTML. The
 * boolean is what gets recorded in body_is_derived.
 */
export function resolveBodyText(
  text: string | undefined | null,
  html: string | undefined | null,
): { bodyText: string; derived: boolean } {
  const plain = (text ?? '').trim();
  if (plain) return { bodyText: text as string, derived: false };
  const fromHtml = htmlToText(html ?? '');
  if (fromHtml) return { bodyText: fromHtml, derived: true };
  return { bodyText: '', derived: false };
}
