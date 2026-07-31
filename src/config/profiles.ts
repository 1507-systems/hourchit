import { TenantProfile } from './profile';
// Built from profiles/*.json by scripts/generate-profiles.mjs. If your editor
// flags this as missing, run `npm run profiles`.
import { PROFILES } from './profiles.generated';

export function loadProfile(key: string): TenantProfile {
  const profile = PROFILES[key];
  if (!profile) {
    throw new Error(
      `Unknown TENANT_PROFILE ${JSON.stringify(key)}. Known: ${Object.keys(PROFILES).join(', ')}`,
    );
  }
  assertBillingTermsStated(profile, key);
  return profile;
}

/**
 * Refuse to run a tenant whose billing terms are not stated.
 *
 * TypeScript cannot help here: profiles are JSON loaded at runtime, so a missing
 * field is `undefined` rather than a compile error. Failing loudly is the point
 * -- the alternative is a deployment that quietly bills on whatever the code
 * happens to default to, which is how one tenant's terms end up applied to
 * another's invoices.
 */
function assertBillingTermsStated(profile: TenantProfile, key: string): void {
  const s = profile.settings as Partial<typeof profile.settings>;
  const missing: string[] = [];
  if (typeof s.billingIncrementMinutes !== 'number') missing.push('billingIncrementMinutes');
  if (typeof s.minimumCallOutMinutes !== 'number') missing.push('minimumCallOutMinutes');
  if (missing.length > 0) {
    throw new Error(
      `Tenant profile ${JSON.stringify(key)} does not state ${missing.join(' and ')}. ` +
        'Billing terms are per-tenant and must be set explicitly; there is no default, ' +
        'because a default would silently apply one client\'s terms to another.',
    );
  }
}

/** Every profile bundled into this build. Used by tests and tooling. */
export function knownProfileKeys(): string[] {
  return Object.keys(PROFILES);
}
