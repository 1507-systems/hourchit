import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { createInvoiceForCustomer } from '../src/db';
import { sqliteEnv, seedBilling } from './helpers/sqlite-env';
const databases: ReturnType<typeof sqliteEnv>[] = [];
afterEach(() => databases.splice(0).forEach((d) => d.sql.close()));
const headers = {
  cookie: 'hourchit_session=test-token',
  'content-type': 'application/x-www-form-urlencoded',
};
async function setup() {
  const d = sqliteEnv();
  seedBilling(d.sql);
  databases.push(d);
  await createInvoiceForCustomer(
    d.env,
    1,
    'INV',
    'USD',
    true,
    {
      incrementMinutes: 15,
      minimumCallOutMinutes: 0,
      weekendDays: [0, 6],
      timezone: 'UTC',
    },
    { timeEntryIds: [1], mileageIds: [] },
  );
  return d;
}
describe('manual send lifecycle', () => {
  it('preview, compose and PDF downloads never mark sent', async () => {
    const d = await setup();
    d.env.BROWSER = {
      async quickAction() {
        return new Response('%PDF-1.4 test');
      },
    } as never;
    for (const path of [
      '/invoices/1/mail-app',
      '/invoices/1/mail-app/compose',
      '/invoices/1/pdf',
    ]) {
      expect((await app.request(path, { headers }, d.env)).status).toBe(200);
    }
    expect(d.sql.prepare('SELECT status, sent_at FROM invoices').get()).toMatchObject({
      status: 'draft',
      sent_at: null,
    });
  });
  it('serves an attachment for explicit download and keeps the ordinary preview inline', async () => {
    const d = await setup();
    d.env.BROWSER = { async quickAction() { return new Response('%PDF-1.4 test'); } } as never;
    const download = await app.request('/invoices/1/pdf?download=1', { headers }, d.env);
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="Invoice-INV-0001.pdf"');
    const preview = await app.request('/invoices/1/pdf', { headers }, d.env);
    expect(preview.headers.get('content-disposition')).toContain('inline;');
  });
  it('shows PDF failure as an error, never an attachment or a sent invoice', async () => {
    const d = await setup();
    const response = await app.request('/invoices/1/pdf?download=1', { headers }, d.env);
    expect(response.status).toBe(502);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(d.sql.prepare('SELECT status FROM invoices').get()?.status).toBe('draft');
  });
  it('records manual send once and refuses an unconfirmed duplicate', async () => {
    const d = await setup();
    await app.request(
      '/invoices/1/send',
      { method: 'POST', headers, body: 'method=mail_app' },
      d.env,
    );
    const first = d.sql.prepare('SELECT sent_at, sent_method FROM invoices').get();
    expect(first?.sent_method).toBe('mail_app');
    const res = await app.request(
      '/invoices/1/send',
      { method: 'POST', headers, body: 'method=mail_app' },
      d.env,
    );
    expect(res.headers.get('location')).toContain('err=');
    expect(d.sql.prepare('SELECT sent_at, sent_method FROM invoices').get()).toEqual(first);
  });
  it.each(['paid', 'canceled'])('refuses preview and confirmation for %s', async (status) => {
    const d = await setup();
    d.sql.prepare('UPDATE invoices SET status = ?').run(status);
    for (const [path, method, body] of [
      ['mail-app', 'GET', undefined],
      ['send', 'POST', 'method=mail_app'],
    ] as const) {
      expect(
        (await app.request(`/invoices/1/${path}`, { headers, method, body }, d.env)).headers.get(
          'location',
        ),
      ).toContain('err=');
    }
    expect(d.sql.prepare('SELECT sent_at FROM invoices').get()?.sent_at).toBeNull();
  });
  it('does not overwrite a sent record created between reading and updating the invoice', async () => {
    const d = await setup();
    const prepare = d.env.DB.prepare.bind(d.env.DB);
    d.env.DB.prepare = (sql: string) => {
      if (sql.includes("UPDATE invoices SET status = 'sent'")) {
        d.sql.exec(
          "UPDATE invoices SET status = 'sent', sent_at = '2026-09-18T12:00:00Z', sent_method = 'email' WHERE id = 1",
        );
      }
      return prepare(sql);
    };
    const res = await app.request(
      '/invoices/1/send',
      { method: 'POST', headers, body: 'method=mail_app' },
      d.env,
    );
    expect(res.headers.get('location')).toContain('err=');
    expect(d.sql.prepare('SELECT sent_at, sent_method FROM invoices').get()).toMatchObject({
      sent_at: '2026-09-18T12:00:00Z',
      sent_method: 'email',
    });
  });
});

describe('manual-send content boundaries', () => {
  it('keeps missing-recipient instructions and a blank mailto recipient', async () => {
    const d = await setup();
    d.sql.exec("UPDATE customers SET email = '' WHERE id = 1");
    const html = await (await app.request('/invoices/1/mail-app', { headers }, d.env)).text();
    expect(html).toContain('no billing email address on file');
    expect(html).toContain('href="mailto:?subject=');
  });
  it('escapes invoice text in the visible body and hidden rich clipboard source', async () => {
    const d = await setup();
    d.sql.prepare('UPDATE invoice_lines SET detail = ?').run('</textarea><script>alert(1)</script>');
    const html = await (await app.request('/invoices/1/mail-app', { headers }, d.env)).text();
    expect(html).not.toContain('</textarea><script>alert(1)</script>');
    expect(html).toContain('&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp;lt;/textarea&amp;gt;');
  });
  it('requires authentication for preview and confirmation', async () => {
    const d = await setup();
    for (const [path, method] of [['mail-app', 'GET'], ['send', 'POST']] as const) {
      const response = await app.request(`/invoices/1/${path}`, { method }, d.env);
      expect(response.headers.get('location')).toBe('/login');
    }
    expect(d.sql.prepare('SELECT status FROM invoices').get()?.status).toBe('draft');
  });
});
