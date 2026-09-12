import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { hashSecret } from '../src/domain/otp';

function preferenceDb(session?: { hash: string; email: string }) {
  const writes: Array<unknown[]> = [];
  return {
    writes,
    db: {
      prepare(sql: string) {
        let values: unknown[] = [];
        const statement = {
          bind(...bound: unknown[]) {
            values = bound;
            return statement;
          },
          async first() {
            if (sql.includes('dashboard_preferences')) return null;
            if (session && sql.includes('FROM sessions') && values[0] === session.hash) {
              return { email: session.email };
            }
            return null;
          },
          async all() {
            return { results: [] };
          },
          async run() {
            if (sql.includes('INSERT INTO dashboard_preferences')) writes.push(values);
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    },
  };
}

function request(body: string, db: unknown, token = 'test-token') {
  return app.request('/dashboard/preferences', {
    method: 'POST',
    headers: {
      cookie: `hourchit_session=${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  }, { ACCESS_TOKEN: 'test-token', DB: db, TENANT_PROFILE: 'core' } as Env);
}

describe('dashboard preference route', () => {
  it('persists an allowlisted change for the signed-in identity', async () => {
    const state = preferenceDb();
    const response = await request('moduleId=manual-hours&action=move-up', state.db);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/?customize=1');
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0][0]).toBe('__break_glass__');
    expect(JSON.parse(String(state.writes[0][1])).slice(0, 2)).toEqual(['manual-hours', 'timer']);
  });

  it('rejects unknown actions without writing', async () => {
    const state = preferenceDb();
    const response = await request('moduleId=mail&action=delete', state.db);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('Unknown%20dashboard%20action');
    expect(state.writes).toHaveLength(0);
  });

  it('isolates writes under each normal session email', async () => {
    const firstToken = 'a'.repeat(64);
    const secondToken = 'b'.repeat(64);
    const first = preferenceDb({ hash: await hashSecret(firstToken), email: 'first@example.org' });
    const second = preferenceDb({ hash: await hashSecret(secondToken), email: 'second@example.org' });
    await request('moduleId=mail&action=hide', first.db, firstToken);
    await request('moduleId=mail&action=hide', second.db, secondToken);
    expect(first.writes[0][0]).toBe('first@example.org');
    expect(second.writes[0][0]).toBe('second@example.org');
  });
});
