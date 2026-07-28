/**
 * A tenant profile is the ONLY place client-specific facts live. The core code
 * is generic; a profile specializes a deployment (branding, rates, the mileage
 * rule, and optional seed data). New client = new profile + new D1, no core edits.
 */
import { hhmmToMinutes, MileageRule } from '../domain/mileage';

export interface ProfileBusiness {
  name: string;
  address: string;
  email: string;
  phone: string;
}

export interface ProfileSettings {
  currency: string; // ISO 4217, e.g. "USD"
  mileageRateCentsPerMile: number; // e.g. 70 => $0.70/mi
  afterHoursStart: string; // "HH:MM" local cutoff
  weekendDays: number[]; // 0=Sun..6=Sat
  invoicePrefix: string; // e.g. "INV"
}

export interface SeedCustomer {
  name: string;
  address: string;
  email: string;
}

export interface SeedTask {
  name: string;
  description: string;
  rateDollarsPerHour: number; // human-friendly in the profile; converted on seed
}

export interface SeedRoute {
  label: string;
  fromAddress: string;
  toAddress: string;
  oneWayMiles: number;
}

export interface TenantProfile {
  key: string; // "core" | "mk-llc" | ...
  business: ProfileBusiness;
  settings: ProfileSettings;
  /** Optional starter data. The clean "core" profile ships none. */
  seed?: {
    customer?: SeedCustomer;
    tasks?: SeedTask[];
    routes?: SeedRoute[];
  };
}

/** Derive the runtime mileage rule from a profile's settings. */
export function mileageRuleFromSettings(s: ProfileSettings): MileageRule {
  return {
    afterHoursStartMinutes: hhmmToMinutes(s.afterHoursStart),
    weekendDays: s.weekendDays,
  };
}
