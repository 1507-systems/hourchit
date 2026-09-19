import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import type { Env } from '../../src/env';

/** Executes production SQL against the real schema; batch matches D1 rollback semantics. */
export function sqliteEnv() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync('migrations')
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    sql.exec(readFileSync(`migrations/${name}`, 'utf8'));
  }
  let beforeBatch: (() => void) | undefined;
  const db = {
    prepare(query: string) {
      let values: any[] = [];
      const statement = {
        bind(...args: any[]) {
          values = args;
          return statement;
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async all() {
          return { results: sql.prepare(query).all(...values) };
        },
        async run() {
          const result = sql.prepare(query).run(...values);
          return {
            success: true,
            meta: {
              last_row_id: Number(result.lastInsertRowid),
              changes: Number(result.changes),
            },
          };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      beforeBatch?.();
      beforeBatch = undefined;
      sql.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return {
    sql,
    env: {
      DB: db,
      ACCESS_TOKEN: 'test-token',
      TENANT_PROFILE: 'core',
    } as unknown as Env,
    beforeBatch(fn: () => void) {
      beforeBatch = fn;
    },
  };
}

export function seedBilling(sql: DatabaseSync) {
  sql.exec(`
    INSERT INTO customers (id, name, invoice_delivery_mode) VALUES (1, 'College', 'mail_app'), (2, 'Other', 'hosted');
    INSERT INTO tasks (id, customer_id, name, rate_cents_per_hour) VALUES (1, 1, 'Tech', 12500), (2, 2, 'Foreign', 9000);
    INSERT INTO time_entries (id, task_id, started_at, stopped_at, note) VALUES
      (1, 1, '2026-09-14T10:00:00Z', '2026-09-14T11:00:00Z', 'Series'),
      (2, 1, '2026-09-15T10:00:00Z', '2026-09-15T11:00:00Z', 'Series'),
      (3, 2, '2026-09-14T10:00:00Z', '2026-09-14T11:00:00Z', 'Other'),
      (4, 1, '2026-09-16T10:00:00Z', NULL, 'Running');
    INSERT INTO mileage_entries (id, customer_id, occurred_local, miles, billable, rate_cents_per_mile)
      VALUES (1, 1, '2026-09-14T10:00', 10, 1, 70), (2, 1, '2026-09-15T10:00', 20, 1, 70);
  `);
}
