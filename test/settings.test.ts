import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';

/**
 * POST /settings/invoice-delivery, exercised against a fake D1.
 *
 * The tenant default only seeds NEW clients (see resolveNewClientMode), so
 * what matters here is that an invalid submission is refused and writes
 * nothing, rather than silently storing garbage a later client creation
 * would then inherit.
 */

function fakeDb() {
  const settings = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first() {
          if (/SELECT value FROM settings WHERE key = \?/i.test(sql)) {
            const value = settings.get(String(bound[0]));
            return value === undefined ? null : { value };
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO settings/i.test(sql)) {
            settings.set(String(bound[0]), String(bound[1]));
          }
          return { meta: { last_row_id: 0 } };
        },
      };
      return stmt;
    },
  };
  return { db, settings };
}

function env() {
  const { db, settings } = fakeDb();
  return {
    e: { TENANT_PROFILE: 'core', ACCESS_TOKEN: 'test-token', DB: db } as unknown as Env,
    settings,
  };
}

const AUTH = { headers: { cookie: 'hourchit_session=test-token' } };
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

describe('POST /settings/invoice-delivery', () => {
  it('refuses an invalid mode and writes nothing', async () => {
    const { e, settings } = env();
    const res = await app.request(
      '/settings/invoice-delivery',
      { method: 'POST', headers: { ...AUTH.headers, ...FORM }, body: 'invoiceDeliveryDefault=sms' },
      e,
    );
    expect(res.headers.get('location')).toContain('valid%20invoice%20delivery%20default');
    expect(settings.has('invoice_delivery_default')).toBe(false);
  });

  it('stores a valid mode and confirms existing clients are unaffected', async () => {
    const { e, settings } = env();
    const res = await app.request(
      '/settings/invoice-delivery',
      { method: 'POST', headers: { ...AUTH.headers, ...FORM }, body: 'invoiceDeliveryDefault=disabled' },
      e,
    );
    expect(settings.get('invoice_delivery_default')).toBe('disabled');
    expect(res.headers.get('location')).toContain('keep%20their%20own%20stored%20mode');
  });
});
