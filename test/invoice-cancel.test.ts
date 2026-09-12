import { describe, expect, it } from 'vitest';
import { cancelInvoice, unbilledMileage, unbilledTimeEntries, type Invoice } from '../src/db';
import type { Env } from '../src/env';

function invoice(status: string): Invoice {
  return {
    id: 8,
    customer_id: 1,
    number: 'TBY-0008',
    status,
    period_start: '2026-09-09',
    period_end: '2026-09-09',
    time_subtotal_cents: 12500,
    mileage_subtotal_cents: 0,
    total_cents: 12500,
    currency: 'USD',
    created_at: '2026-09-09T12:00:00Z',
    sent_at: null,
    sent_method: null,
    lines_frozen: 1,
  };
}

function fakeEnv(status = 'draft', linesFrozen = 1, cancelTransitionChanges = 1) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async first() {
          return /FROM invoices/i.test(sql) ? { ...invoice(status), lines_frozen: linesFrozen } : null;
        },
        async run() {
          writes.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
          const isCancelTransition = /UPDATE invoices SET status = 'canceled'/i.test(sql);
          return { meta: { changes: isCancelTransition ? cancelTransitionChanges : 1 } };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  return { env: { DB: db } as unknown as Env, writes };
}

describe('invoice cancellation', () => {
  it('retains the invoice and releases its source entries for reinvoicing', async () => {
    const { env, writes } = fakeEnv();
    await cancelInvoice(env, 8);

    expect(writes.map((write) => write.sql)).toContain(
      "UPDATE invoices SET status = 'canceled' WHERE id = ? AND status IN ('draft', 'sent')",
    );
    expect(writes.some(({ sql }) => sql.startsWith('UPDATE time_entries SET invoice_id = NULL'))).toBe(true);
    expect(writes.some(({ sql }) => sql.startsWith('UPDATE mileage_entries SET invoice_id = NULL'))).toBe(true);
    expect(writes.some(({ sql }) => /DELETE FROM invoices|DELETE FROM invoice_lines/.test(sql))).toBe(false);
    expect(writes[0].sql).toContain("UPDATE time_entries SET invoice_id = NULL");
    expect(writes[0].sql).toContain("status IN ('draft', 'sent')");
    expect(writes[2].sql).toContain("UPDATE invoices SET status = 'canceled'");
  });

  it('voids source entries instead of physically deleting or returning them', async () => {
    const { env, writes } = fakeEnv();
    await cancelInvoice(env, 8, 'delete', '2026-09-10T20:00:00.000Z');

    const time = writes.find(({ sql }) => sql.startsWith('UPDATE time_entries SET voided_at'));
    const mileage = writes.find(({ sql }) => sql.startsWith('UPDATE mileage_entries SET voided_at'));
    expect(time?.values).toEqual(['2026-09-10T20:00:00.000Z', 8, 8]);
    expect(mileage?.values).toEqual(['2026-09-10T20:00:00.000Z', 8, 8]);
    expect(writes.some(({ sql }) => sql.includes('SET invoice_id = NULL'))).toBe(false);
    expect(writes.some(({ sql }) => /^DELETE/i.test(sql))).toBe(false);
  });

  it('rejects an unknown source-entry disposition', async () => {
    const { env, writes } = fakeEnv();
    await expect(cancelInvoice(env, 8, 'archive' as 'return')).rejects.toThrow(
      'Choose whether to return or delete',
    );
    expect(writes).toHaveLength(0);
  });

  it('rejects a stale cancellation whose guarded status transition lost a race', async () => {
    const { env, writes } = fakeEnv('draft', 1, 0);

    await expect(cancelInvoice(env, 8, 'return')).rejects.toThrow(
      'changed before cancellation completed',
    );
    expect(writes[2].sql).toContain("UPDATE invoices SET status = 'canceled'");
  });

  it.each(['paid', 'canceled'])('refuses to cancel a %s invoice', async (status) => {
    const { env, writes } = fakeEnv(status);
    await expect(cancelInvoice(env, 8)).rejects.toThrow('cannot be canceled');
    expect(writes).toHaveLength(0);
  });

  it('refuses to detach the only detail source from a legacy invoice', async () => {
    const { env, writes } = fakeEnv('draft', 0);
    await expect(cancelInvoice(env, 8)).rejects.toThrow('predates frozen line items');
    expect(writes).toHaveLength(0);
  });

  it('allows a modern invoice whose intentionally frozen line set is empty', async () => {
    const { env, writes } = fakeEnv('draft', 1);
    await cancelInvoice(env, 8);
    expect(writes.some(({ sql }) => sql.includes("status = 'canceled'"))).toBe(true);
  });
});

describe('voided source entries', () => {
  it('excludes voided time and mileage from unbilled queries', async () => {
    const queries: string[] = [];
    const db = {
      prepare(sql: string) {
        queries.push(sql.replace(/\s+/g, ' ').trim());
        const statement = {
          bind: () => statement,
          async all() { return { results: [] }; },
        };
        return statement;
      },
    };
    const env = { DB: db } as unknown as Env;

    await unbilledTimeEntries(env, 1);
    await unbilledMileage(env, 1);

    expect(queries).toHaveLength(2);
    expect(queries.every((sql) => sql.includes('voided_at IS NULL'))).toBe(true);
  });
});
