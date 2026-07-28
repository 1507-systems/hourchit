import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Run the generator against a profile written into the real profiles/
 * directory, then clean it up. The script resolves profiles relative to its
 * own location, so the file has to live there.
 */
function generate(key: string, profile: unknown): { ok: boolean; stdout: string; stderr: string } {
  const path = join(ROOT, 'profiles', `${key}.json`);
  writeFileSync(path, JSON.stringify(profile, null, 2));
  try {
    const stdout = execFileSync('node', [join(ROOT, 'seed', 'generate.mjs'), key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (err: any) {
    return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  } finally {
    rmSync(path, { force: true });
  }
}

const filled = {
  key: 'zz-test',
  business: { name: 'T', address: 'A', email: 'e@x.test', phone: '1' },
  settings: {
    currency: 'USD',
    mileageRateCentsPerMile: 70,
    afterHoursStart: '16:30',
    weekendDays: [0, 6],
    invoicePrefix: 'T',
  },
  seed: {
    customer: { name: 'Client', address: 'Somewhere', email: 'ap@client.test' },
    tasks: [{ name: 'Work', description: 'd', rateDollarsPerHour: 95 }],
    routes: [{ label: 'Home ↔ Site', fromAddress: 'a', toAddress: 'b', oneWayMiles: 12.4 }],
  },
};

describe('seed generator', () => {
  it('emits SQL for a fully filled profile', () => {
    const res = generate('zz-test', filled);
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain('INSERT INTO customers');
    expect(res.stdout).toContain('INSERT INTO tasks');
    expect(res.stdout).toContain('INSERT INTO routes');
  });

  // Seeding a TODO-filled profile writes placeholder text onto a real invoice.
  it('refuses a profile with TODO placeholders', () => {
    const res = generate('zz-test', {
      ...filled,
      seed: { ...filled.seed, customer: { ...filled.seed.customer, name: 'TODO: client name' } },
    });
    expect(res.ok).toBe(false);
    expect(res.stderr).toMatch(/placeholder/i);
    expect(res.stdout).not.toContain('INSERT INTO');
  });

  // Zero mileage is the quiet one: the app appears to work and under-bills
  // every single trip.
  it('refuses a route with zero one-way miles', () => {
    const res = generate('zz-test', {
      ...filled,
      seed: { ...filled.seed, routes: [{ ...filled.seed.routes[0], oneWayMiles: 0 }] },
    });
    expect(res.ok).toBe(false);
    expect(res.stderr).toMatch(/zero miles/i);
    expect(res.stdout).not.toContain('INSERT INTO');
  });

  it('escapes single quotes so a name like O\'Brien cannot break the SQL', () => {
    const res = generate('zz-test', {
      ...filled,
      seed: { ...filled.seed, customer: { ...filled.seed.customer, name: "O'Brien & Sons" } },
    });
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("'O''Brien & Sons'");
  });

  it('leaves no test profile behind', () => {
    expect(existsSync(join(ROOT, 'profiles', 'zz-test.json'))).toBe(false);
  });
});
