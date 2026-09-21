import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import type { InvoiceDeliveryMode } from '../src/domain/invoice-delivery';

/**
 * The web fallback for "send with your mail app": a GET that hands over a
 * mailto: draft and a PDF link, and a confirm step that reuses the existing
 * generic mark-sent route. Nothing here should ever call sendMail -- that is
 * the whole point of the mode.
 */

const INVOICE = {
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
  sent_at: null as string | null,
  sent_method: null as string | null,
};

const CUSTOMER = {
  id: 1,
  name: 'Grandvale College',
  address: '800 Founders Way',
  email: 'client@example.invalid',
  archived: 0,
  workdrive_folder_id: null,
  notes: '',
  notice_days: 60,
  invoice_delivery_mode: 'mail_app' as InvoiceDeliveryMode,
};

const LINES = [
  {
    id: 1,
    invoice_id: 8,
    kind: 'time',
    description: 'Event Tech Management',
    quantity: 1.5,
    unit: 'hr',
    rate_cents: 12500,
    amount_cents: 18750,
    sort_order: 0,
  },
];

function fakeDb(over: { invoice?: typeof INVOICE; customer?: typeof CUSTOMER } = {}) {
  const writes: string[] = [];
  const invoice = over.invoice ?? INVOICE;
  const customer = over.customer === undefined ? CUSTOMER : over.customer;

  const db = {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        async first() {
          if (/FROM invoices/i.test(sql)) return invoice;
          if (/FROM customers/i.test(sql)) return customer;
          return null;
        },
        async all() {
          if (/FROM invoice_lines/i.test(sql)) return { results: LINES };
          return { results: [] };
        },
        async run() {
          writes.push(sql.replace(/\s+/g, ' ').trim());
          return { meta: { last_row_id: 1, changes: 1 } };
        },
      };
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql.replace(/\s+/g, ' ').trim());
      return stmt;
    },
  };
  return { db, writes };
}

function env(over: Partial<Env> = {}, dbOver = {}) {
  const { db, writes } = fakeDb(dbOver);
  return {
    e: { TENANT_PROFILE: 'core', ACCESS_TOKEN: 'test-token', DB: db, ...over } as unknown as Env,
    writes,
  };
}

const AUTH = { headers: { cookie: 'hourchit_session=test-token' } };

describe('GET /invoices/:id/mail-app', () => {
  it('renders the mailto draft and PDF link for a client in mail_app mode', async () => {
    const { e } = env();
    const res = await app.request('/invoices/8/mail-app', { method: 'GET', ...AUTH }, e);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('mailto:client%40example.invalid');
    expect(html).toContain('/invoices/8/pdf');
    expect(html).toContain('Mark as sent manually');
    expect(html).toContain('Copy body');
    expect(html).toContain('TOTAL DUE');
    expect(html).toContain('Event Tech Management');
    expect(html).not.toContain('&amp;body=');
    expect(html).toContain('Paste');
  });

  it('refuses with 403 for a client in hosted mode', async () => {
    const { e } = env({}, { customer: { ...CUSTOMER, invoice_delivery_mode: 'hosted' } });
    const res = await app.request('/invoices/8/mail-app', { method: 'GET', ...AUTH }, e);
    expect(res.status).toBe(403);
  });

  it('refuses with 403 for a client in disabled mode', async () => {
    const { e } = env({}, { customer: { ...CUSTOMER, invoice_delivery_mode: 'disabled' } });
    const res = await app.request('/invoices/8/mail-app', { method: 'GET', ...AUTH }, e);
    expect(res.status).toBe(403);
  });

  it('never sends mail -- only the operator confirming afterward marks it sent', async () => {
    const { e, writes } = env();
    await app.request('/invoices/8/mail-app', { method: 'GET', ...AUTH }, e);
    expect(writes.some((w) => /UPDATE invoices SET status = 'sent'/.test(w))).toBe(false);
  });
});

describe('GET /invoices/:id/mail-app/compose', () => {
  it('returns the full hosted-quality composition for a client in mail_app mode', async () => {
    const { e } = env();
    const res = await app.request('/invoices/8/mail-app/compose', { method: 'GET', ...AUTH }, e);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      to: string;
      subject: string;
      html: string;
      pdfUrl: string;
      pdfFilename: string;
    };
    expect(body.to).toBe('client@example.invalid');
    expect(body.subject).toContain('TBY-0008');
    expect(body.html).toContain('Event Tech Management');
    expect(body.html).toContain('Total due'); // the line-item table, not the narrow mailto draft
    expect(body.pdfUrl).toBe('/invoices/8/pdf');
    expect(body.pdfFilename).toContain('TBY-0008');
  });

  it('never mentions HourChit -- this is not sent over HourChit transport', async () => {
    const { e } = env();
    const res = await app.request('/invoices/8/mail-app/compose', { method: 'GET', ...AUTH }, e);
    const body = (await res.json()) as { html: string };
    expect(body.html).not.toContain('HourChit');
  });

  it('refuses with 403 for a client in hosted mode', async () => {
    const { e } = env({}, { customer: { ...CUSTOMER, invoice_delivery_mode: 'hosted' } });
    const res = await app.request('/invoices/8/mail-app/compose', { method: 'GET', ...AUTH }, e);
    expect(res.status).toBe(403);
  });

  it('refuses with 403 for a client in disabled mode', async () => {
    const { e } = env({}, { customer: { ...CUSTOMER, invoice_delivery_mode: 'disabled' } });
    const res = await app.request('/invoices/8/mail-app/compose', { method: 'GET', ...AUTH }, e);
    expect(res.status).toBe(403);
  });
});

describe('confirming a mail-app send', () => {
  it('POST /invoices/:id/send with method=mail_app marks it sent and records that method', async () => {
    const { e, writes } = env();
    const res = await app.request(
      '/invoices/8/send',
      {
        method: 'POST',
        ...AUTH,
        headers: { ...AUTH.headers, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'method=mail_app',
      },
      e,
    );
    expect(res.status).toBe(302);
    expect(writes.some((w) => /UPDATE invoices SET status = 'sent'/.test(w))).toBe(true);
  });
});

it('returns a private full plain body alongside HTML without sending', async () => {
 const { e, writes } = env();
 const res = await app.request('/invoices/8/mail-app/compose', AUTH, e);
 expect(res.headers.get('cache-control')).toBe('private, no-store');
 const draft = await res.json() as {body:string};
 expect(draft.body).toContain('TOTAL DUE');
 expect(draft.body).toContain('Event Tech Management');
 expect(writes).toEqual([]);
});
