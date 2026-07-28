import { TenantProfile } from './profile';
import core from '../../profiles/core.json';
import mkllc from '../../profiles/mk-llc.json';

// Profiles are bundled at build time. To add a client, drop in a new
// profiles/<key>.json, register it here, and point a wrangler env at it.
const PROFILES: Record<string, TenantProfile> = {
  core: core as TenantProfile,
  'mk-llc': mkllc as TenantProfile,
};

export function loadProfile(key: string): TenantProfile {
  const profile = PROFILES[key];
  if (!profile) {
    throw new Error(
      `Unknown TENANT_PROFILE ${JSON.stringify(key)}. Known: ${Object.keys(PROFILES).join(', ')}`,
    );
  }
  return profile;
}
