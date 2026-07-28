import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requireAuth, timingSafeEqual } from '../src/auth';
import type { Env } from '../src/env';

/**
 * Build a minimal app gated exactly the way src/index.ts gates the real routes,
 * so these tests exercise the middleware rather than a stand-in for it.
 */
function gatedApp(env: Partial<Env>) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requireAuth);
  app.get('/', (c) => c.text('BILLING DATA'));
  return (headers: Record<string, string> = {}) =>
    app.request('/', { headers }, env as Env);
}

describe('requireAuth', () => {
  // This is the regression guard for the fail-open bug: an unconfigured deploy
  // used to hand a real client's billing data to anyone with the URL.
  it('fails closed when ACCESS_TOKEN is unset', async () => {
    const res = await gatedApp({})();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('BILLING DATA');
  });

  it('fails closed when ACCESS_TOKEN is empty', async () => {
    const res = await gatedApp({ ACCESS_TOKEN: '' })();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('BILLING DATA');
  });

  it('serves the request when the cookie matches the token', async () => {
    const res = await gatedApp({ ACCESS_TOKEN: 's3cret' })({
      Cookie: 'hourchit_session=s3cret',
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('BILLING DATA');
  });

  it('redirects to /login when the cookie is wrong', async () => {
    const res = await gatedApp({ ACCESS_TOKEN: 's3cret' })({
      Cookie: 'hourchit_session=wrong',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('redirects to /login when no cookie is sent', async () => {
    const res = await gatedApp({ ACCESS_TOKEN: 's3cret' })();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  // A prefix of the real token must not be accepted, which a naive
  // length-tolerant comparison could allow.
  it('rejects a cookie that is a prefix of the token', async () => {
    const res = await gatedApp({ ACCESS_TOKEN: 's3cret' })({
      Cookie: 'hourchit_session=s3c',
    });
    expect(res.status).toBe(302);
  });
});

describe('timingSafeEqual', () => {
  it('matches identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('rejects different strings of equal length', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });

  it('rejects prefixes and different lengths', () => {
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
    expect(timingSafeEqual('ab', 'abc')).toBe(false);
    expect(timingSafeEqual('abc', '')).toBe(false);
  });

  it('handles multi-byte characters without false positives', () => {
    expect(timingSafeEqual('café', 'café')).toBe(true);
    expect(timingSafeEqual('café', 'cafe')).toBe(false);
  });
});
