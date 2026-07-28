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
  return profile;
}

/** Every profile bundled into this build. Used by tests and tooling. */
export function knownProfileKeys(): string[] {
  return Object.keys(PROFILES);
}
