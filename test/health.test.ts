import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Env } from '../src/env';

const env = (over: Partial<Env> = {}) =>
  ({ TENANT_PROFILE: 'core', ...over }) as Env;

describe('/health', () => {
  // Deploy pipelines read this back to prove the deploy took effect, so it has
  // to answer without credentials.
  it('answers without authentication', async () => {
    const res = await app.request('/health', {}, env());
    expect(res.status).toBe(200);
  });

  it('reports the tenant and a build identity', async () => {
    const res = await app.request('/health', {}, env({ TENANT_PROFILE: 'example' }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.tenant).toBe('example');
    expect(typeof body.version).toBe('string');
    expect(body.version).not.toBe('');
  });

  // A managed tenant deploy builds two repos: this core, plus the private repo
  // that pinned it. The field must always be present so a drift check can tell
  // "built from the core directly" ('') from "built by a config repo" — an
  // absent key would be indistinguishable from an old build.
  it('always reports a config identity field', async () => {
    const body = (await (await app.request('/health', {}, env())).json()) as Record<
      string,
      unknown
    >;
    expect(body).toHaveProperty('config');
    expect(typeof body.config).toBe('string');
  });

  it('reports whether ACCESS_TOKEN is configured', async () => {
    const missing = await (await app.request('/health', {}, env())).json();
    expect((missing as Record<string, unknown>).configured).toBe(false);

    const set = await (
      await app.request('/health', {}, env({ ACCESS_TOKEN: 'x' }))
    ).json();
    expect((set as Record<string, unknown>).configured).toBe(true);
  });

  // The endpoint is public, so it must not leak the profile it loaded.
  it('does not expose profile contents', async () => {
    const res = await app.request('/health', {}, env());
    const text = await res.text();
    expect(text).not.toMatch(/address|email|phone|rate/i);
  });
});
