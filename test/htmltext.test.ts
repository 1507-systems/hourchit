import { describe, expect, it } from 'vitest';
import { htmlToText, resolveBodyText } from '../src/domain/htmltext';

describe('htmlToText', () => {
  it('keeps block structure as line breaks instead of running text together', () => {
    expect(htmlToText('<p>First</p><p>Second</p>')).toBe('First\nSecond');
    expect(htmlToText('one<br>two')).toBe('one\ntwo');
    expect(htmlToText('<div>a</div><div>b</div>')).toBe('a\nb');
  });

  it('drops style and script CONTENT, not just their tags', () => {
    // The failure this guards: stripping tags alone dumps the whole stylesheet
    // into the middle of the message, which is what mail HTML is mostly made of.
    const html = '<style>p{color:red}</style><p>Hello</p><script>alert(1)</script>';
    const out = htmlToText(html);
    expect(out).toBe('Hello');
    expect(out).not.toContain('color');
    expect(out).not.toContain('alert');
  });

  it('drops comments, including the conditional ones Outlook emits', () => {
    expect(htmlToText('<!--[if mso]><p>junk</p><![endif]--><p>Real</p>')).toBe('Real');
  });

  it('decodes the entities that actually show up in mail', () => {
    expect(htmlToText('<p>Tom&nbsp;&amp;&nbsp;Jerry</p>')).toBe('Tom & Jerry');
    expect(htmlToText('<p>&lt;not a tag&gt;</p>')).toBe('<not a tag>');
    expect(htmlToText('<p>caf&#233;</p>')).toBe('café');
    expect(htmlToText('<p>caf&#xe9;</p>')).toBe('café');
  });

  it('survives a malformed numeric entity rather than throwing', () => {
    // A throw here would take the mail handler down and lose the message.
    expect(() => htmlToText('<p>&#1114112;</p>')).not.toThrow();
    expect(() => htmlToText('<p>&#999999999999;</p>')).not.toThrow();
  });

  it('collapses the whitespace mail HTML is padded with', () => {
    expect(htmlToText('<p>   lots     of    space   </p>')).toBe('lots of space');
    expect(htmlToText('<p>a</p><p></p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });

  it('handles an empty or tagless input', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText('just words')).toBe('just words');
  });

  it('reads a realistic phone reply with a signature', () => {
    // Shaped like the message that exposed this bug: HTML only, quoted original,
    // and a signature block. All of it must survive as readable text.
    const html = `<html><head><style>.sig{font-size:9pt}</style></head><body>
      <div>Sounds good, confirmed for Saturday.</div><br>
      <div class="sig">Bryce<br>1507 Systems</div>
      <blockquote><p>On Jul 30, Tarnsby wrote:</p><p>Reply to this message</p></blockquote>
      </body></html>`;
    const out = htmlToText(html);
    expect(out).toContain('Sounds good, confirmed for Saturday.');
    expect(out).toContain('1507 Systems');
    expect(out).not.toContain('font-size');
    expect(out).not.toContain('<div');
  });
});

describe('resolveBodyText', () => {
  it('prefers a real text/plain part and marks it authored', () => {
    expect(resolveBodyText('typed words', '<p>markup</p>')).toEqual({
      bodyText: 'typed words',
      derived: false,
    });
  });

  it('falls back to the HTML and flags the text as derived', () => {
    // The actual bug: an iPhone reply is HTML only, and storing email.text
    // alone recorded an empty body for a message that plainly had words in it.
    expect(resolveBodyText(undefined, '<p>Confirmed</p>')).toEqual({
      bodyText: 'Confirmed',
      derived: true,
    });
  });

  it('treats a whitespace-only text part as absent', () => {
    // Some clients emit an empty text/plain alongside the real HTML. Trusting
    // it would reintroduce the empty-body bug while looking like it worked.
    expect(resolveBodyText('   \n  ', '<p>Real content</p>')).toEqual({
      bodyText: 'Real content',
      derived: true,
    });
  });

  it('reports nothing rather than pretending, when there is nothing', () => {
    expect(resolveBodyText('', '')).toEqual({ bodyText: '', derived: false });
    expect(resolveBodyText(null, null)).toEqual({ bodyText: '', derived: false });
  });

  it('does not mark a derived body as authored when HTML has only markup', () => {
    expect(resolveBodyText('', '<div><span></span></div>')).toEqual({
      bodyText: '',
      derived: false,
    });
  });
});
