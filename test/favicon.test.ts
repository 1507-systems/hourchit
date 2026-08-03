import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { FAVICON_32_PNG_BASE64, FAVICON_48_PNG_BASE64 } from '../src/favicon';
import type { Env } from '../src/env';

const env = (over: Partial<Env> = {}) => ({ TENANT_PROFILE: 'core', ...over }) as Env;

// PNG signature, ISO/IEC 15948:2003 section 5.2 -- the first 8 bytes of every
// valid PNG file, regardless of size or color type.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function pngBytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

describe('favicon', () => {
  // A browser requests these before any login happens, same reason /health
  // has to answer without credentials.
  it.each([
    ['/favicon-32.png', FAVICON_32_PNG_BASE64],
    ['/favicon-48.png', FAVICON_48_PNG_BASE64],
    ['/favicon.ico', FAVICON_32_PNG_BASE64],
  ])('serves %s without authentication', async (path, base64) => {
    const res = await app.request(path, {}, env());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');

    const bytes = await pngBytes(res);
    expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_MAGIC);
    expect(bytes.length).toBe(atob(base64).length);
  });

  it('serves the 48px favicon as a larger file than the 32px one', async () => {
    const small = await pngBytes(await app.request('/favicon-32.png', {}, env()));
    const large = await pngBytes(await app.request('/favicon-48.png', {}, env()));
    expect(large.length).toBeGreaterThan(small.length);
  });
});
