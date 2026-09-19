import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { sqliteEnv, seedBilling } from './helpers/sqlite-env';
const databases: ReturnType<typeof sqliteEnv>[] = [];
afterEach(() => databases.splice(0).forEach((d) => d.sql.close()));
function setup() {
  const d = sqliteEnv();
  seedBilling(d.sql);
  databases.push(d);
  return d;
}
const headers = {
  cookie: 'hourchit_session=test-token',
  'content-type': 'application/x-www-form-urlencoded',
};
describe('tenant pending billing display', () => {
  it.each(['task_description', 'task', 'description'])(
    'persists %s and displays separate selectable entries',
    async (mode) => {
      const d = setup();
      const res = await app.request(
        '/settings/pending-billing',
        { method: 'POST', headers, body: `pendingBillingDisplay=${mode}` },
        d.env,
      );
      expect(res.status).toBe(302);
      expect(
        d.sql.prepare("SELECT value FROM settings WHERE key = 'pending_billing_display'").get()
          ?.value,
      ).toBe(mode);
      const html = await (await app.request('/', { headers }, d.env)).text();
      expect(html).toContain('name="timeEntryIds[]" value="1"');
      expect(html).toContain('name="timeEntryIds[]" value="2"');
      const pending = html.split('id="pending-billing"')[1]?.split('</form>')[0] ?? '';
      if (mode !== 'task') expect(pending).toContain('Series');
      if (mode === 'task') expect(pending).not.toContain('Series');
      if (mode === 'description') expect(pending).not.toContain('Tech');
      expect(html).toContain('Add to invoice');
    },
  );
  it('rejects an invalid mode without storing it', async () => {
    const d = setup();
    const res = await app.request(
      '/settings/pending-billing',
      { method: 'POST', headers, body: 'pendingBillingDisplay=bogus' },
      d.env,
    );
    expect(res.headers.get('location')).toContain('err=');
    expect(
      d.sql.prepare("SELECT * FROM settings WHERE key = 'pending_billing_display'").all(),
    ).toHaveLength(0);
  });
});
