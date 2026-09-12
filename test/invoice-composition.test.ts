import { describe, expect, it } from 'vitest';
import { invoiceMailAppDraft, mailtoHref } from '../src/mail/invoice-composition';
import type { Invoice } from '../src/db';

const invoice: Invoice = {
  id: 8,
  customer_id: 1,
  number: 'TBY-0008',
  status: 'draft',
  period_start: '2026-08-15',
  period_end: '2026-09-15',
  time_subtotal_cents: 18750,
  mileage_subtotal_cents: 0,
  total_cents: 18750,
  currency: 'USD',
  created_at: '2026-07-31T14:00:00.000Z',
  sent_at: null,
  sent_method: null,
};

const business = { name: 'Tarnsby A/V Services LLC' };
const customer = { name: 'Grandvale College' };

describe('invoiceMailAppDraft', () => {
  it('carries the same subject convention as the hosted send, so both modes read the same in a mailbox', () => {
    const draft = invoiceMailAppDraft({ invoice, business, customer, to: 'ap@grandvale.example' });
    expect(draft.subject).toBe('Invoice TBY-0008 from Tarnsby A/V Services LLC — $187.50');
  });

  it('does not attempt to include the invoice line items, only a short note', () => {
    // A mailto: body has no reliable length guarantee and cannot carry a PDF at
    // all -- overclaiming what fits here is exactly what the web fallback must
    // not do.
    const draft = invoiceMailAppDraft({ invoice, business, customer, to: 'ap@grandvale.example' });
    expect(draft.body).not.toContain('TOTAL DUE');
    expect(draft.body.length).toBeLessThan(300);
  });

  it('passes the recipient through as given, including null when there is none on file', () => {
    expect(invoiceMailAppDraft({ invoice, business, customer, to: null }).to).toBeNull();
    expect(invoiceMailAppDraft({ invoice, business, customer, to: 'x@example.invalid' }).to).toBe(
      'x@example.invalid',
    );
  });
});

describe('mailtoHref', () => {
  it('encodes subject and body with plain percent-encoding, not form "+ for space"', () => {
    // RFC 6068 mailto hfields are pct-encoded like any other URI component;
    // "+" has no special meaning there, and a mail client that took it
    // literally would hand the client an email reading "please+find".
    const href = mailtoHref({ to: 'ap@grandvale.example', subject: 'A & B', body: 'line one\nline two' });
    expect(href).toMatch(/^mailto:ap%40grandvale\.example\?/);
    expect(href).toContain('subject=A%20%26%20B');
    expect(href).toContain('body=line%20one%0Aline%20two');
    expect(href).not.toContain('+');
  });

  it('leaves the recipient blank rather than inventing one', () => {
    const href = mailtoHref({ to: null, subject: 'S', body: 'B' });
    expect(href.startsWith('mailto:?')).toBe(true);
  });
});
