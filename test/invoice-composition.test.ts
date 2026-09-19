import { describe, expect, it } from 'vitest';
import { invoiceMailAppDraft, mailtoHref } from '../src/mail/invoice-composition';
import { invoiceEmailText, invoiceEmailHtml } from '../src/mail/invoice-email';
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

const business = {
  name: 'Tarnsby A/V Services LLC',
  address: '1 Main St',
  email: 'billing@example.test',
  phone: '555-0100',
};
const lines = [
  {
    id: 1,
    invoice_id: 8,
    kind: 'time' as const,
    description: 'Event Tech',
    detail: 'Awards Ceremony',
    service_date: '2026-09-14',
    quantity: 1.5,
    unit: 'hr' as const,
    rate_cents: 12500,
    amount_cents: 18750,
    sort_order: 0,
  },
];
const customer = { name: 'Grandvale College' };

describe('invoiceMailAppDraft', () => {
  it('carries the same subject convention as the hosted send, so both modes read the same in a mailbox', () => {
    const draft = invoiceMailAppDraft({
      invoice,
      business,
      customer,
      lines,
      viaHourChit: true,
      to: 'ap@grandvale.example',
    });
    expect(draft.subject).toBe('Invoice TBY-0008 from Tarnsby A/V Services LLC — $187.50');
  });

  it('uses the full shared text and HTML email renderers without hosted-transport disclosure', () => {
    const draft = invoiceMailAppDraft({
      invoice,
      business,
      customer,
      lines,
      viaHourChit: true,
      to: 'ap@grandvale.example',
    });
    const view = { invoice, business, customer, lines, viaHourChit: false };
    expect(draft.body).toBe(invoiceEmailText(view));
    expect(draft.html).toBe(invoiceEmailHtml(view));
    expect(draft.body).toContain('TOTAL DUE');
    expect(draft.body).toContain('Awards Ceremony');
    expect(draft.body).not.toContain('HourChit');
  });

  it('passes the recipient through as given, including null when there is none on file', () => {
    expect(
      invoiceMailAppDraft({
        invoice,
        business,
        customer,
        lines,
        viaHourChit: true,
        to: null,
      }).to,
    ).toBeNull();
    expect(
      invoiceMailAppDraft({
        invoice,
        business,
        customer,
        lines,
        viaHourChit: true,
        to: 'x@example.invalid',
      }).to,
    ).toBe('x@example.invalid');
  });
});

describe('mailtoHref', () => {
  it('encodes subject but omits body so a long invoice cannot truncate the mailto', () => {
    // RFC 6068 mailto hfields are pct-encoded like any other URI component;
    // "+" has no special meaning there, and a mail client that took it
    // literally would hand the client an email reading "please+find".
    const href = mailtoHref({ to: 'ap@grandvale.example', subject: 'A & B', body: 'line one\nline two' });
    expect(href).toMatch(/^mailto:ap%40grandvale\.example\?/);
    expect(href).toContain('subject=A%20%26%20B');
    expect(href).not.toContain('body=');
    expect(href).not.toContain('+');
  });

  it('leaves the recipient blank rather than inventing one', () => {
    const href = mailtoHref({ to: null, subject: 'S', body: 'B' });
    expect(href.startsWith('mailto:?')).toBe(true);
  });
});
