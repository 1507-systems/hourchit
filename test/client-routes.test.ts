import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import type { InvoiceDeliveryMode } from '../src/domain/invoice-delivery';

/**
 * Client create/edit routes, exercised against a fake D1.
 *
 * What matters here is not that a normal edit works -- it is the three ways
 * invoice-delivery policy could leak across boundaries: a new client created
 * without a tenant default set, an explicit per-client choice being silently
 * overridden by the tenant default, and editing one client reaching into
 * another client's row or the tenant-wide default.
 */

interface FakeCustomer {
  id: number;
  name: string;
  address: string;
  email: string;
  archived: number;
  workdrive_folder_id: string | null;
  notes: string;
  notice_days: number | null;
  invoice_delivery_mode: InvoiceDeliveryMode;
}

function fakeDb(opts: { tenantDefault?: InvoiceDeliveryMode | null; customers?: FakeCustomer[] } = {}) {
  const settings = new Map<string, string>();
  if (opts.tenantDefault) settings.set('invoice_delivery_default', opts.tenantDefault);
  const customers: FakeCustomer[] = opts.customers ?? [];
  let nextId = (customers.at(-1)?.id ?? 0) + 1;

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
          if (/SELECT \* FROM customers WHERE id = \?/i.test(sql)) {
            return customers.find((c) => c.id === Number(bound[0])) ?? null;
          }
          return null;
        },
        async all() {
          if (/FROM customers/i.test(sql)) return { results: customers };
          if (/FROM tasks/i.test(sql)) return { results: [] };
          if (/FROM routes/i.test(sql)) return { results: [] };
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO settings/i.test(sql)) {
            settings.set(String(bound[0]), String(bound[1]));
            return { meta: { last_row_id: 0 } };
          }
          if (/INSERT INTO customers/i.test(sql)) {
            const [name, address, email, notes, noticeDays, invoiceDeliveryMode] = bound as [
              string,
              string,
              string,
              string,
              number | null,
              InvoiceDeliveryMode,
            ];
            const row: FakeCustomer = {
              id: nextId++,
              name,
              address,
              email,
              archived: 0,
              workdrive_folder_id: null,
              notes,
              notice_days: noticeDays,
              invoice_delivery_mode: invoiceDeliveryMode,
            };
            customers.push(row);
            return { meta: { last_row_id: row.id } };
          }
          if (/UPDATE customers SET/i.test(sql)) {
            const [name, address, email, notes, workdriveFolderId, noticeDays, invoiceDeliveryMode, id] =
              bound as [string, string, string, string, string | null, number | null, InvoiceDeliveryMode, number];
            const row = customers.find((c) => c.id === Number(id));
            if (row) Object.assign(row, { name, address, email, notes, workdrive_folder_id: workdriveFolderId, notice_days: noticeDays, invoice_delivery_mode: invoiceDeliveryMode });
            return { meta: { last_row_id: 0 } };
          }
          return { meta: { last_row_id: 0 } };
        },
      };
      return stmt;
    },
  };
  return { db, settings, customers };
}

function env(opts: Parameters<typeof fakeDb>[0] = {}) {
  const { db, settings, customers } = fakeDb(opts);
  return {
    e: { TENANT_PROFILE: 'core', ACCESS_TOKEN: 'test-token', DB: db } as unknown as Env,
    settings,
    customers,
  };
}

const AUTH = { headers: { cookie: 'hourchit_session=test-token' } };
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

describe('POST /clients', () => {
  it('refuses to create a client when no tenant default is set', async () => {
    const { e, customers } = env({ tenantDefault: null });
    const res = await app.request(
      '/clients',
      { method: 'POST', headers: { ...AUTH.headers, ...FORM }, body: 'name=New+Client' },
      e,
    );
    expect(res.headers.get('location')).toContain('invoice%20delivery%20default');
    expect(customers).toHaveLength(0);
  });

  it('copies the tenant default when no mode is submitted', async () => {
    const { e, customers } = env({ tenantDefault: 'mail_app' });
    await app.request(
      '/clients',
      { method: 'POST', headers: { ...AUTH.headers, ...FORM }, body: 'name=New+Client' },
      e,
    );
    expect(customers[0].invoice_delivery_mode).toBe('mail_app');
  });

  it('an explicit submitted mode wins over the tenant default', async () => {
    const { e, customers } = env({ tenantDefault: 'hosted' });
    await app.request(
      '/clients',
      {
        method: 'POST',
        headers: { ...AUTH.headers, ...FORM },
        body: 'name=New+Client&invoiceDeliveryMode=disabled',
      },
      e,
    );
    expect(customers[0].invoice_delivery_mode).toBe('disabled');
  });

  it('falls back to the tenant default when the submitted mode is invalid', async () => {
    const { e, customers } = env({ tenantDefault: 'hosted' });
    await app.request(
      '/clients',
      {
        method: 'POST',
        headers: { ...AUTH.headers, ...FORM },
        body: 'name=New+Client&invoiceDeliveryMode=sms',
      },
      e,
    );
    expect(customers[0].invoice_delivery_mode).toBe('hosted');
  });
});

describe('POST /clients/:id', () => {
  const base: FakeCustomer = {
    id: 1,
    name: 'Existing Client',
    address: 'Somewhere',
    email: 'ap@existing.test',
    archived: 0,
    workdrive_folder_id: null,
    notes: '',
    notice_days: 30,
    invoice_delivery_mode: 'hosted',
  };
  const other: FakeCustomer = { ...base, id: 2, name: 'Other Client', invoice_delivery_mode: 'hosted' };

  it('refuses an invalid mode and writes nothing', async () => {
    const { e, customers } = env({ tenantDefault: 'hosted', customers: [{ ...base }, { ...other }] });
    const res = await app.request(
      '/clients/1',
      { method: 'POST', headers: { ...AUTH.headers, ...FORM }, body: 'name=Existing+Client&invoiceDeliveryMode=sms' },
      e,
    );
    expect(res.headers.get('location')).toContain('valid%20invoice%20delivery%20mode');
    expect(customers[0].invoice_delivery_mode).toBe('hosted');
  });

  it('updates only the targeted client, leaving other clients and the tenant default untouched', async () => {
    const { e, settings, customers } = env({ tenantDefault: 'hosted', customers: [{ ...base }, { ...other }] });
    await app.request(
      '/clients/1',
      {
        method: 'POST',
        headers: { ...AUTH.headers, ...FORM },
        body: 'name=Existing+Client&invoiceDeliveryMode=disabled',
      },
      e,
    );
    expect(customers.find((c) => c.id === 1)?.invoice_delivery_mode).toBe('disabled');
    expect(customers.find((c) => c.id === 2)?.invoice_delivery_mode).toBe('hosted');
    expect(settings.get('invoice_delivery_default')).toBe('hosted');
  });
});
