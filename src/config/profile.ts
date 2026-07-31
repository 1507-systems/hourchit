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

  /**
   * Whether the client reimburses travel. REQUIRED — there is no default.
   *
   * Deliberately not optional. A defaulted billing flag is a silent decision,
   * and the wrong silent decision here puts a charge on an invoice that the
   * client has already refused. Every profile must say which it is, so setting
   * up a tenant forces someone to have actually asked.
   *
   * SETTING THIS FALSE DOES NOT STOP MILEAGE BEING RECORDED. Trips are still
   * logged in full, because unreimbursed business mileage is precisely the
   * mileage that matters for the operator's own deduction — it is deductible to
   * them BECAUSE nobody paid it back. What the flag controls is narrower: those
   * trips never become invoice lines.
   */
  mileageBillable: boolean;

  /**
   * Extra addresses allowed to sign in, beyond `business.email`.
   *
   * Optional, and empty for a one-person business, which is the design target.
   * It exists so a second operator can be added without a schema change, and it
   * is an ALLOWLIST rather than a table: who may sign in to a client's billing
   * application is a deployment decision, not something the running app should
   * be able to extend on its own.
   */
  loginEmails?: string[];
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
