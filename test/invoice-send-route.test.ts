import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';

/**
 * The send route, exercised against a fake D1 and a fake mail binding.
 *
 * What is worth testing here is not that a happy send works -- it is the three
 * ways a send can go wrong and leave the books lying: sending to nobody,
 * sending twice, and marking an invoice sent when the mail never left.
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
  email: 'grandvale@bpsmail.net',
  archived: 0,
  workdrive_folder_id: null,
  notes: '',
  notice_days: 60,
};

const LINES = [
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

/** A D1 stand-in that answers by matching the SQL it is handed. */
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
          if (/INSERT INTO threads/i.test(sql)) return { id: 7 };
          if (/INSERT INTO messages/i.test(sql)) return { id: 11 };
          return null;
        },
        async all() {
          if (/FROM invoice_lines/i.test(sql)) return { results: LINES };
          return { results: [] };
        },
        async run() {
          writes.push(sql.replace(/\s+/g, ' ').trim());
          return { meta: { last_row_id: 1 } };
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
    e: {
      TENANT_PROFILE: 'core',
      ACCESS_TOKEN: 'test-token',
      DB: db,
      ...over,
    } as unknown as Env,
    writes,
  };
}

const AUTH = { headers: { cookie: 'hourchit_session=test-token' } };

/** A Browser Run stand-in returning a few plausible PDF bytes. */
function fakeBrowser() {
  return {
    async quickAction() {
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]), {
        status: 200,
      });
    },
  };
}

/** A mail binding that records what it was asked to send. */
function recordingMail() {
  const sent: Array<{
    to: string;
    from: string;
    subject: string;
    html?: string;
    attachments?: Array<{ filename: string; type: string }>;
  }> = [];
  return {
    sent,
    binding: {
      async send(m: {
        to: string;
        from: string;
        subject: string;
        html?: string;
        attachments?: Array<{ filename: string; type: string }>;
      }) {
        sent.push(m);
        return { messageId: '<generated@hosted.hourchit.app>' };
      },
    },
  };
}

describe('POST /invoices/:id/email', () => {
  it('refuses when the client has no billing address, rather than sending to nowhere', async () => {
    const mail = recordingMail();
    const { e } = env(
      { EMAIL: mail.binding as never, HOSTED_MAIL_DOMAIN: 'hosted.hourchit.app' },
      { customer: { ...CUSTOMER, email: '  ' } },
    );
    const res = await app.request('/invoices/8/email', { method: 'POST', ...AUTH }, e);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('no%20billing%20email');
    expect(mail.sent).toHaveLength(0);
  });

  it('refuses a resend without an explicit acknowledgement', async () => {
    // A second copy of the SAME invoice number reads as a duplicate charge or a
    // chase depending on who opens it, and AP treat those very differently.
    const mail = recordingMail();
    const { e } = env(
      { EMAIL: mail.binding as never },
      { invoice: { ...INVOICE, status: 'sent', sent_at: '2026-07-30T10:00:00.000Z', sent_method: 'email' } },
    );
    const res = await app.request('/invoices/8/email', { method: 'POST', ...AUTH }, e);
    expect(res.headers.get('location')).toContain('already%20sent');
    expect(mail.sent).toHaveLength(0);
  });

  it('allows the resend once acknowledged', async () => {
    const mail = recordingMail();
    const { e } = env(
      { EMAIL: mail.binding as never, BROWSER: fakeBrowser() as never },
      { invoice: { ...INVOICE, status: 'sent', sent_at: '2026-07-30T10:00:00.000Z', sent_method: 'email' } },
    );
    const res = await app.request(
      '/invoices/8/email',
      {
        method: 'POST',
        ...AUTH,
        headers: { ...AUTH.headers, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'confirmResend=1',
      },
      e,
    );
    expect(res.headers.get('location')).toContain('Sent%20to');
    expect(mail.sent).toHaveLength(1);
  });

  it('does NOT mark the invoice sent when the mail throws', async () => {
    // The failure that matters most. An invoice recorded as sent that never
    // left is worse than one that failed loudly: the operator stops chasing it,
    // and the first anyone notices is when payment does not arrive.
    const failing = {
      async send() {
        throw new Error('sender address is not onboarded');
      },
    };
    const { e, writes } = env({ EMAIL: failing as never, BROWSER: fakeBrowser() as never });
    const res = await app.request('/invoices/8/email', { method: 'POST', ...AUTH }, e);
    expect(res.headers.get('location')).toContain('Not%20sent');
    expect(writes.some((w) => /UPDATE invoices SET status = 'sent'/.test(w))).toBe(false);
  });

  it('sends from the TENANT address, not the HourChit apex', async () => {
    // The invoice is Matt's A/V billing their client, not HourChit talking to
    // Matt. Sending it from noreply@hourchit.app puts a vendor the client has
    // never heard of on a demand for money.
    const mail = recordingMail();
    const { e } = env({ EMAIL: mail.binding as never, BROWSER: fakeBrowser() as never, TENANT_PROFILE: 'core' });
    await app.request('/invoices/8/email', { method: 'POST', ...AUTH }, e);
    expect(mail.sent[0].from).toBe('core@hosted.hourchit.app');
    expect(mail.sent[0].from).not.toContain('noreply@');
  });

  it('marks it sent and logs it outbound on success', async () => {
    const mail = recordingMail();
    const { e, writes } = env({ EMAIL: mail.binding as never, BROWSER: fakeBrowser() as never });
    await app.request('/invoices/8/email', { method: 'POST', ...AUTH }, e);
    expect(mail.sent[0].to).toBe('grandvale@bpsmail.net');
    expect(writes.some((w) => /INSERT INTO messages/.test(w))).toBe(true);
    expect(writes.some((w) => /UPDATE invoices SET status = 'sent'/.test(w))).toBe(true);
  });
});

describe('the PDF attachment', () => {
  it('refuses to send at all when the PDF cannot be rendered', async () => {
    // Bryce: "there needs to be a PDF attached." Sending without it would leave
    // the operator believing a document went out that did not, and they would
    // find out when the client asked for one. The refusal is recoverable; a
    // quietly incomplete invoice is discovered by the client.
    const mail = recordingMail();
    const { e, writes } = env({ EMAIL: mail.binding as never }); // no BROWSER binding
    const res = await app.request('/invoices/8/email', { method: 'POST', ...AUTH }, e);
    expect(res.headers.get('location')).toContain('PDF%20could%20not%20be%20rendered');
    expect(mail.sent).toHaveLength(0);
    expect(writes.some((w) => /UPDATE invoices SET status = 'sent'/.test(w))).toBe(false);
  });

  it('does not send when Browser Run errors', async () => {
    const mail = recordingMail();
    const broken = {
      async quickAction() {
        return new Response('browser unavailable', { status: 503 });
      },
    };
    const { e } = env({ EMAIL: mail.binding as never, BROWSER: broken as never });
    const res = await app.request('/invoices/8/email', { method: 'POST', ...AUTH }, e);
    expect(res.headers.get('location')).toContain('503');
    expect(mail.sent).toHaveLength(0);
  });

  it('sends the PDF with the invoice number in the filename', async () => {
    const mail = recordingMail();
    const { e } = env({ EMAIL: mail.binding as never, BROWSER: fakeBrowser() as never });
    await app.request('/invoices/8/email', { method: 'POST', ...AUTH }, e);
    expect(mail.sent[0].attachments).toHaveLength(1);
    expect(mail.sent[0].attachments![0].filename).toBe('Invoice-TBY-0008.pdf');
    expect(mail.sent[0].attachments![0].type).toBe('application/pdf');
  });
});
