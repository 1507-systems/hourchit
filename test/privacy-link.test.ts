import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { renderMailList } from '../src/ui/mail';
import { layout } from '../src/ui/layout';
import { PRIVACY_POLICY_URL, brandFooter } from '../src/ui/theme';

// App Store Review Guideline 5.1.1(i): the policy link has to be reachable
// inside the app, so it rides on every page shell the iOS shell can show.
const link = `<a href="${PRIVACY_POLICY_URL}" rel="noopener">Privacy</a>`;

describe('privacy policy link', () => {
  it('targets the policy published on hourchit.app', () => {
    expect(PRIVACY_POLICY_URL).toBe('https://hourchit.app/privacy');
  });

  it('appears in the authenticated application shell', () => {
    const html = layout({ title: 'Dashboard', business: 'Example', body: '' });
    expect(html).toContain(link);
  });

  it('appears on the unauthenticated login shell', async () => {
    const response = await app.request('/login');
    const html = await response.text();
    expect(html).toContain(link);
  });

  it('appears in the standalone mail shell', () => {
    expect(renderMailList([])).toContain(link);
  });

  it('opens in the same window, which the iOS shell can hand off', () => {
    expect(brandFooter()).not.toContain('target=');
  });
});
