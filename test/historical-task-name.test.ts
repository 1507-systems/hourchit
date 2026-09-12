import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('historical fallback invoice labels', () => {
  it('snapshots the old task label before the live service is renamed', () => {
    const migration = readFileSync('migrations/0012_invoice_line_event_details.sql', 'utf8');
    const snapshot = migration.indexOf('legacy_invoice_name');
    const rename = migration.indexOf("UPDATE tasks SET name = 'Event Tech Management'");

    expect(snapshot).toBeGreaterThanOrEqual(0);
    expect(rename).toBeGreaterThan(snapshot);
  });

  it('uses the snapshot when rendering invoices without frozen lines', () => {
    const dbSource = readFileSync('src/db.ts', 'utf8');
    expect(dbSource).toContain('COALESCE(t.legacy_invoice_name, t.name) AS task_name');
  });
});
