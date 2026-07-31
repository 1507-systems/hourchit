import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requireAuth } from '../src/auth';
import type { Env } from '../src/env';
import { hashSecret } from '../src/domain/otp';

/**
 * A D1 stand-in that answers exactly the one query requireAuth makes, so these
 * tests exercise the middleware's decision rather than SQLite's behaviour.
 *
 * The stub is told which token hash is currently live. The live/expired/revoked
 * distinction is SQL in the real query, and is covered end-to-end against real
 * D1 rather than re-implemented here, where a stub agreeing with itself would
 * prove nothing.
 */
function dbWithLiveSession(liveHash: string | null) {
  return {
    prepare(_sql: string) {
      const stmt = {
        bind(hash: string) {
          return {
            first: async () => (liveHash !== null && hash === liveHash ? { email: 'op@x.test' } : null),
          };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function gated(env: Partial<Env>) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requireAuth);
  app.get('/', (c) => c.text('BILLING DATA'));
  return (cookie?: string) =>
    app.request('/', { headers: cookie ? { Cookie: `hourchit_session=${cookie}` } : {} }, env as Env);
}

describe('session cookie auth', () => {
  it('admits a cookie whose hash matches a live session', async () => {
    const token = 'a'.repeat(64);
    const res = await gated({ ACCESS_TOKEN: 'break-glass', DB: dbWithLiveSession(await hashSecret(token)) })(token);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('BILLING DATA');
  });

  it('denies a cookie with no matching session', async () => {
    const res = await gated({ ACCESS_TOKEN: 'break-glass', DB: dbWithLiveSession(null) })('b'.repeat(64));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('stores only the hash, so the raw cookie is never what is compared', async () => {
    // Guards against a refactor that "simplifies" by storing the token itself:
    // a session row must not be usable by whoever can read the table.
    const token = 'c'.repeat(64);
    const res = await gated({ ACCESS_TOKEN: 'break-glass', DB: dbWithLiveSession(token) })(token);
    expect(res.status).toBe(302);
  });

  it('still admits the break-glass token when sessions exist', async () => {
    const res = await gated({ ACCESS_TOKEN: 'break-glass', DB: dbWithLiveSession(null) })('break-glass');
    expect(res.status).toBe(200);
  });

  it('fails closed when the session store throws', async () => {
    const exploding = {
      prepare() {
        throw new Error('D1 unavailable');
      },
    } as unknown as D1Database;
    const res = await gated({ ACCESS_TOKEN: 'break-glass', DB: exploding })('d'.repeat(64));
    expect(res.status).toBe(302);
    expect(await res.text()).not.toContain('BILLING DATA');
  });
});
