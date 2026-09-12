import { describe, expect, it } from 'vitest';
import { knownProfileKeys, loadProfile } from '../src/config/profiles';
import { mileageRuleFromSettings } from '../src/config/profile';

describe('profile registry', () => {
  it('always bundles the generic core profile', () => {
    expect(knownProfileKeys()).toContain('core');
  });

  it('throws a helpful error for an unknown TENANT_PROFILE', () => {
    // A typo'd env var should stop the deploy loudly rather than silently
    // serving another tenant's branding.
    expect(() => loadProfile('nope')).toThrow(/Unknown TENANT_PROFILE "nope"/);
  });

  it('exposes a usable mileage rule for every bundled profile', () => {
    for (const key of knownProfileKeys()) {
      const rule = mileageRuleFromSettings(loadProfile(key).settings);
      expect(rule.afterHoursStartMinutes).toBeGreaterThanOrEqual(0);
      expect(rule.afterHoursStartMinutes).toBeLessThan(24 * 60);
      expect(rule.weekendDays.every((d) => d >= 0 && d <= 6)).toBe(true);
    }
  });

  it('keeps the public core profile free of real client data', () => {
    // The core repo is public. core.json is a template, so it must not grow
    // seed data pointing at a real customer.
    const core = loadProfile('core');
    expect(core.seed).toBeUndefined();
  });
});
