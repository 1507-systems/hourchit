import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
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
  // "built from the core directly" ('') from "built by a config repo", an
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

describe('/health reports the applied schema', () => {
  const withDb = (name: string | null) =>
    env({
      DB: {
        prepare: () => ({
          first: async () => (name === null ? null : { name }),
        }),
      },
    } as unknown as Partial<Env>);

  it('names the newest applied migration', async () => {
    // A matching git SHA proves the CODE is live and says nothing about the
    // SCHEMA. On 2026-07-31 migration 0009's code shipped, /health reported the
    // right commit, and the column did not exist -- so a validation rule
    // silently did not fire and every signal still read as success.
    const body = (await (
      await app.request('/health', {}, withDb('0010_term_version_basis.sql'))
    ).json()) as Record<string, unknown>;
    expect(body.schema).toBe('0010_term_version_basis.sql');
  });

  it('reports null rather than throwing when D1 is unreachable', async () => {
    // The verifier treats null as a mismatch. Health must still answer, because
    // it is also how a pipeline learns the Worker is up at all.
    const broken = env({
      DB: {
        prepare: () => {
          throw new Error('no such table: d1_migrations');
        },
      },
    } as unknown as Partial<Env>);
    const res = await app.request('/health', {}, broken);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).schema).toBeNull();
  });

  it('reports null when no migration has ever been applied', async () => {
    const body = (await (await app.request('/health', {}, withDb(null))).json()) as Record<
      string,
      unknown
    >;
    expect(body.schema).toBeNull();
  });
});
