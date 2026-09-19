import { afterEach, describe, expect, it } from 'vitest';
import { createInvoiceForCustomer } from '../src/db';
import { app } from '../src/index';
import { sqliteEnv, seedBilling } from './helpers/sqlite-env';
const terms = {
  incrementMinutes: 15,
  minimumCallOutMinutes: 0,
  weekendDays: [0, 6],
  timezone: 'UTC',
};
const databases: ReturnType<typeof sqliteEnv>[] = [];
afterEach(() => databases.splice(0).forEach((d) => d.sql.close()));
function setup() {
  const d = sqliteEnv();
  seedBilling(d.sql);
  databases.push(d);
  return d;
}
function create(d: ReturnType<typeof setup>, timeEntryIds: number[], mileageIds: number[] = []) {
  return createInvoiceForCustomer(d.env, 1, 'INV', 'USD', true, terms, {
    timeEntryIds,
    mileageIds,
  });
}
describe('selected-entry invoices using real SQL', () => {
  it('invoices only checked time and mileage, leaving the series remainder unbilled', async () => {
    const d = setup();
    const invoice = await create(d, [1], [2]);
    expect(invoice.total_cents).toBe(13900);
    expect(invoice.number).toBe('INV-0001');
    expect(
      d.sql.prepare('SELECT invoice_id FROM time_entries WHERE id = 2').get()?.invoice_id,
    ).toBeNull();
    expect(
      d.sql.prepare('SELECT invoice_id FROM mileage_entries WHERE id = 1').get()?.invoice_id,
    ).toBeNull();
    expect(d.sql.prepare('SELECT * FROM invoice_lines').all()).toHaveLength(2);
  });
  it.each([[], [3], [4], [999], [1, 1], [-1], [1.5]].map((ids) => ({ ids })))(
    'rejects invalid selection $ids without writes',
    async ({ ids }) => {
      const d = setup();
      await expect(create(d, ids)).rejects.toThrow();
      expect(d.sql.prepare('SELECT * FROM invoices').all()).toHaveLength(0);
    },
  );
  it('rejects repeat billing', async () => {
    const d = setup();
    await create(d, [1]);
    await expect(create(d, [1])).rejects.toThrow();
    expect(d.sql.prepare('SELECT * FROM invoices').all()).toHaveLength(1);
  });
  it('rolls back the entire invoice if an entry changes between preview and transaction', async () => {
    const d = setup();
    d.beforeBatch(() =>
      d.sql.exec("UPDATE time_entries SET voided_at = '2026-09-19' WHERE id = 1"),
    );
    await expect(create(d, [1])).rejects.toThrow();
    expect(d.sql.prepare('SELECT * FROM invoices').all()).toHaveLength(0);
    expect(d.sql.prepare('SELECT * FROM invoice_lines').all()).toHaveLength(0);
  });
  it('rolls back invoice and source links if saving a line fails', async () => {
    const d = setup();
    d.sql.exec(
      "CREATE TRIGGER test_failure BEFORE INSERT ON invoice_lines BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    await expect(create(d, [1])).rejects.toThrow();
    expect(d.sql.prepare('SELECT * FROM invoices').all()).toHaveLength(0);
    expect(
      d.sql.prepare('SELECT invoice_id FROM time_entries WHERE id = 1').get()?.invoice_id,
    ).toBeNull();
  });
  it('POST without checkbox fields fails closed rather than invoicing everything', async () => {
    const d = setup();
    const res = await app.request(
      '/invoices',
      {
        method: 'POST',
        headers: {
          cookie: 'hourchit_session=test-token',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'customerId=1',
      },
      d.env,
    );
    expect(res.headers.get('location')).toContain('err=');
    expect(d.sql.prepare('SELECT * FROM invoices').all()).toHaveLength(0);
  });
});

describe('selection edge cases', () => {
  it('supports mileage-only invoicing', async () => {
    const d = setup();
    const invoice = await create(d, [], [1]);
    expect(invoice.total_cents).toBe(700);
    expect(
      d.sql.prepare('SELECT invoice_id FROM time_entries WHERE id = 1').get()?.invoice_id,
    ).toBeNull();
  });
  it('rejects mileage on a tenant that does not bill it', async () => {
    const d = setup();
    await expect(
      createInvoiceForCustomer(d.env, 1, 'INV', 'USD', false, terms, {
        timeEntryIds: [1],
        mileageIds: [1],
      }),
    ).rejects.toThrow('not billable');
    expect(d.sql.prepare('SELECT * FROM invoices').all()).toHaveLength(0);
  });
  it('uses historical rates and minimums, identically in dashboard preview and invoice', async () => {
    const d = setup();
    d.sql.exec(`INSERT INTO task_rate_versions (task_id, effective_from, rate_cents_per_hour) VALUES
      (1, '2026-09-01T00:00:00Z', 10000), (1, '2026-09-15T00:00:00Z', 20000);
      INSERT INTO term_versions (effective_from, billing_increment_minutes, minimum_callout, mileage_rate_cents, mileage_billable)
      VALUES ('2026-09-01T00:00:00Z', 15, '120', 70, 1);`);
    const html = await (
      await app.request('/', { headers: { cookie: 'hourchit_session=test-token' } }, d.env)
    ).text();
    expect(html).toMatch(
      /name="timeEntryIds\[\]" value="1" data-seconds="3600" data-cents="20000"/,
    );
    expect(html).toMatch(
      /name="timeEntryIds\[\]" value="2" data-seconds="3600" data-cents="40000"/,
    );
    expect((await create(d, [1, 2])).total_cents).toBe(60000);
  });
  it('POST accepts multiple checked entries and excludes unchecked mileage', async () => {
    const d = setup();
    const res = await app.request(
      '/invoices',
      {
        method: 'POST',
        headers: {
          cookie: 'hourchit_session=test-token',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'customerId=1&timeEntryIds%5B%5D=1&timeEntryIds%5B%5D=2',
      },
      d.env,
    );
    expect(res.headers.get('location')).toBe('/invoices/1');
    expect(d.sql.prepare('SELECT total_cents FROM invoices').get()?.total_cents).toBe(25000);
    expect(
      d.sql.prepare('SELECT invoice_id FROM mileage_entries WHERE id = 1').get()?.invoice_id,
    ).toBeNull();
  });
});
