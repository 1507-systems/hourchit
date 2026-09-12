import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { renderMailList } from '../src/ui/mail';
import { layout } from '../src/ui/layout';

const favicon = '<link rel="icon" type="image/svg+xml" href="https://hourchit.app/icon-mark.svg">';

describe('shared HourChit favicon', () => {
  it('appears in the authenticated application shell', () => {
    const html = layout({ title: 'Dashboard', business: 'Example', body: '' });
    expect(html).toContain(favicon);
  });

  it('appears on the unauthenticated login shell', async () => {
    const response = await app.request('/login');
    const html = await response.text();
    expect(html).toContain(favicon);
  });

  it('appears in the standalone mail shell', () => {
    const html = renderMailList([]);
    expect(html).toContain(favicon);
  });
});
