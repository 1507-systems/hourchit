import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_MODULES,
  moveDashboardModule,
  moveDashboardModuleSkipping,
  sanitizeDashboardPreferences,
  setDashboardModuleHidden,
} from '../src/domain/dashboard-preferences';
import { getDashboardPreferences, saveDashboardPreferences } from '../src/db';
import type { Env } from '../src/env';

describe('dashboard preferences', () => {
  it('uses the current module registry as the default order', () => {
    expect(sanitizeDashboardPreferences(null)).toEqual({
      order: [...DASHBOARD_MODULES],
      hidden: [],
    });
  });

  it('drops unknown and duplicate ids and appends newly introduced modules', () => {
    expect(
      sanitizeDashboardPreferences({
        order: ['invoices', 'timer', 'timer', 'retired-widget'],
        hidden: ['mail', 'mail', 'retired-widget'],
      }),
    ).toEqual({
      order: ['invoices', 'timer', 'manual-hours', 'mileage', 'mail', 'unbilled', 'recent-mileage'],
      hidden: ['mail'],
    });
  });

  it('recovers from invalid persisted JSON shapes', () => {
    expect(sanitizeDashboardPreferences({ order: 'timer', hidden: 42 })).toEqual({
      order: [...DASHBOARD_MODULES],
      hidden: [],
    });
  });

  it('moves a module one position without crossing a boundary', () => {
    const defaults = sanitizeDashboardPreferences(null);
    expect(moveDashboardModule(defaults, 'manual-hours', 'up').order.slice(0, 3)).toEqual([
      'manual-hours', 'timer', 'mileage',
    ]);
    expect(moveDashboardModule(defaults, 'timer', 'up')).toEqual(defaults);
    expect(moveDashboardModule(defaults, 'recent-mileage', 'down')).toEqual(defaults);
  });

  it('moves across an unavailable module in one visible step', () => {
    const preferences = sanitizeDashboardPreferences({
      order: ['timer', 'recent-mileage', 'manual-hours'],
      hidden: [],
    });
    expect(
      moveDashboardModuleSkipping(preferences, 'manual-hours', 'up', ['recent-mileage']).order.slice(0, 3),
    ).toEqual(['manual-hours', 'recent-mileage', 'timer']);
  });

  it('hides and shows only known modules', () => {
    const defaults = sanitizeDashboardPreferences(null);
    const hidden = setDashboardModuleHidden(defaults, 'timer', true);
    expect(hidden.hidden).toEqual(['timer']);
    expect(setDashboardModuleHidden(hidden, 'timer', false).hidden).toEqual([]);
    expect(setDashboardModuleHidden(defaults, 'retired-widget', true)).toEqual(defaults);
  });
});

describe('dashboard preference persistence', () => {
  it('sanitizes JSON loaded for one normalized user key', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const env = preferenceEnv(calls, {
      module_order: '["invoices","timer","retired"]',
      hidden_modules: '["mail"]',
    });

    const preferences = await getDashboardPreferences(env, ' Bryce@Example.org ');

    expect(calls[0].values).toEqual(['bryce@example.org']);
    expect(preferences.order.slice(0, 2)).toEqual(['invoices', 'timer']);
    expect(preferences.hidden).toEqual(['mail']);
  });

  it('upserts only sanitized preference JSON for the normalized user key', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const env = preferenceEnv(calls, null);

    await saveDashboardPreferences(env, ' Bryce@Example.org ', {
      order: ['timer', 'timer', 'mail', 'retired-widget'],
      hidden: ['mail', 'retired-widget'],
    } as never);

    expect(calls[0].sql).toContain('ON CONFLICT(user_key) DO UPDATE');
    expect(calls[0].values).toEqual([
      'bryce@example.org',
      JSON.stringify(['timer', 'mail', 'manual-hours', 'mileage', 'invoices', 'unbilled', 'recent-mileage']),
      JSON.stringify(['mail']),
    ]);
  });
});

function preferenceEnv(
  calls: Array<{ sql: string; values: unknown[] }>,
  row: { module_order: string; hidden_modules: string } | null,
): Env {
  return {
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        const statement = {
          bind(...bound: unknown[]) {
            values = bound;
            calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
            return statement;
          },
          async first() { return row; },
          async run() { return { meta: { changes: 1 } }; },
        };
        return statement;
      },
    },
  } as unknown as Env;
}
