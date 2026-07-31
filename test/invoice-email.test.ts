import { describe, expect, it } from 'vitest';
import {
  invoiceEmailHtml,
  invoiceEmailSubject,
  invoiceEmailText,
  type InvoiceEmailView,
} from '../src/mail/invoice-email';
import type { Invoice, InvoiceLine } from '../src/db';

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

const lines: InvoiceLine[] = [
  {
    id: 1,
    invoice_id: 8,
    kind: 'time',
    description: 'Event Management',
    quantity: 1.5,
    unit: 'hr',
    rate_cents: 12500,
    amount_cents: 18750,
    sort_order: 0,
  },
];

const view = (over: Partial<InvoiceEmailView> = {}): InvoiceEmailView => ({
  invoice,
  lines,
  business: {
    name: 'Tarnsby A/V Services LLC',
    address: '12 Harrow Bend\nTarnsby, CT 06701',
    email: 'tarnsby@bpsmail.net',
    phone: '(203) 555-0142',
  },
  customer: { name: 'Grandvale College' },
  ...over,
});

describe('the invoice email subject', () => {
  it('leads with the invoice number, which is how AP files and searches', () => {
    expect(invoiceEmailSubject(view())).toBe(
      'Invoice TBY-0008 from Tarnsby A/V Services LLC — $187.50',
    );
  });
});

describe('the invoice email body', () => {
  it('carries the whole invoice, not a link to it', () => {
    // Bryce, on linking to a hosted copy: "I LIKE the link to invoice but that
    // also feels phishy." An unexpected email with an amount and a link to an
    // unfamiliar domain is what invoice fraud looks like, and AP departments
    // are trained to distrust exactly that.
    const t = invoiceEmailText(view());
    expect(t).toContain('INVOICE TBY-0008');
    expect(t).toContain('Event Management');
    expect(t).toContain('TOTAL DUE  $187.50');
    expect(t).not.toMatch(/https?:\/\//);
    expect(invoiceEmailHtml(view())).not.toMatch(/https?:\/\//);
  });

  it('always has a plain text part', () => {
    // Some AP systems ingest text only, and a message with no text/plain part
    // scores worse with spam filters. An invoice in the junk folder does not
    // get paid.
    expect(invoiceEmailText(view()).length).toBeGreaterThan(50);
  });

  it('styles the HTML inline, because clients discard <head>', () => {
    const html = invoiceEmailHtml(view());
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<head');
    expect(html).toContain('style="');
  });

  it('leaves quantity and rate blank on a line that has no rate', () => {
    // A mileage line reading "1 x $0.00" is noise that invites a question.
    const free: InvoiceLine = { ...lines[0], description: 'Mileage', rate_cents: 0, amount_cents: 0 };
    const t = invoiceEmailText(view({ lines: [free], invoice: { ...invoice, total_cents: 18750 } }));
    expect(t).toContain('Mileage');
    expect(t).not.toContain('@ $0.00');
  });

  it('escapes client-controlled text rather than injecting it', () => {
    const html = invoiceEmailHtml(view({ customer: { name: '<script>alert(1)</script>' } }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('states the service period when the invoice has one', () => {
    expect(invoiceEmailText(view())).toContain('2026-08-15 – 2026-09-15');
  });

  it('does not print a range when the work was all one day', () => {
    const oneDay = { ...invoice, period_start: '2026-08-15', period_end: '2026-08-15' };
    expect(invoiceEmailText(view({ invoice: oneDay }))).toContain('Service period 2026-08-15');
    expect(invoiceEmailText(view({ invoice: oneDay }))).not.toContain('–');
  });
});
