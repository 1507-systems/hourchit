import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { renderDashboard, type DashboardData } from '../src/ui/dashboard';

function recordingDb() {
  const inserts: Array<{ sql: string; values: unknown[] }> = [];
  return {
    inserts,
    db: {
      prepare(sql: string) {
        let values: unknown[] = [];
        const stmt = {
          bind(...bound: unknown[]) {
            values = bound;
            return stmt;
          },
          async first() {
            return null;
          },
          async run() {
            if (/INSERT INTO time_entries/i.test(sql)) inserts.push({ sql, values });
            return { meta: { last_row_id: 1 } };
          },
        };
        return stmt;
      },
    },
  };
}

function env(db: unknown): Env {
  return { TENANT_PROFILE: 'core', ACCESS_TOKEN: 'test-token', DB: db } as Env;
}

const auth = { cookie: 'hourchit_session=test-token', 'content-type': 'application/x-www-form-urlencoded' };

describe('event name entry', () => {
  it('requires an event name before starting a timer', async () => {
    const { db, inserts } = recordingDb();
    const res = await app.request(
      '/timer/start',
      { method: 'POST', headers: auth, body: 'taskId=1&eventName=+++' },
      env(db),
    );

    expect(res.headers.get('location')).toContain('Enter%20an%20event%20name');
    expect(inserts).toHaveLength(0);
  });

  it('stores the normalized event name on a running timer', async () => {
    const { db, inserts } = recordingDb();
    await app.request(
      '/timer/start',
      { method: 'POST', headers: auth, body: 'taskId=1&eventName=++Awards+++Ceremony++&chargeCode=++GL+++5678++' },
      env(db),
    );

    expect(inserts[0].values[2]).toBe('Awards Ceremony');
    expect(inserts[0].values[3]).toBe('GL 5678');
  });

  it('stores an omitted charge code as null', async () => {
    const { db, inserts } = recordingDb();
    await app.request(
      '/timer/start',
      { method: 'POST', headers: auth, body: 'taskId=1&eventName=Awards+Ceremony&chargeCode=+++' },
      env(db),
    );

    expect(inserts[0].values[3]).toBeNull();
  });

  it('stores the normalized event name on manually logged hours', async () => {
    const { db, inserts } = recordingDb();
    await app.request(
      '/timer/manual',
      {
        method: 'POST',
        headers: auth,
        body: 'taskId=1&eventName=++Awards+++Ceremony++&chargeCode=++GL+++5678++&startedLocal=2026-09-09T10%3A00&duration=2%3A00',
      },
      env(db),
    );

    expect(inserts[0].values[3]).toBe('Awards Ceremony');
    expect(inserts[0].values[4]).toBe('GL 5678');
  });
});

describe('event entry interface', () => {
  it('requires an event name in both time-entry forms', () => {
    const data: DashboardData = {
      business: 'Example',
      currency: 'USD',
      mileageRateCentsPerMile: 76,
      afterHoursStart: '16:30',
      customer: null,
      tasks: [{ id: 1, name: 'Event Tech Management', rateCentsPerHour: 12500, unbilledSeconds: 0 }],
      running: null,
      routes: [],
      recentMileage: [],
      invoices: [],
      unbilledTotalCents: 0,
    };

    const html = renderDashboard(data);
    expect(html.match(/name="eventName"/g)).toHaveLength(2);
    expect(html.match(/name="eventName"[^>]*required/g)).toHaveLength(2);
    expect(html.match(/name="chargeCode"/g)).toHaveLength(2);
    expect(html).toContain('<label>Event description</label>');
    expect(html).toContain('<label>GL charge code (optional)</label>');
    expect(html).toContain('type="datetime-local" name="startedLocal"');
  });

  it('shows the event name while its timer is running', () => {
    const data: DashboardData = {
      business: 'Example', currency: 'USD', mileageRateCentsPerMile: 76, afterHoursStart: '16:30',
      customer: null, tasks: [], routes: [], recentMileage: [], invoices: [], unbilledTotalCents: 0,
      running: { taskName: 'Event Tech Management', eventName: 'Awards Ceremony', startedAtMs: 0 },
    };

    const html = renderDashboard(data);
    expect(html).toContain('On the clock: Event Tech Management · Awards Ceremony');
  });
});
