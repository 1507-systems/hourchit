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

  /**
   * Billing increment in MINUTES. Billable time rounds UP to a multiple of it.
   *
   * REQUIRED, and validated at load rather than defaulted. A default here would
   * be a silent decision about what a client owes, and worse, it would let one
   * tenant's terms leak into another's simply by being the fallback. Matt's A/V
   * SOW 3.2 and the 1507 break-fix card both use 15.
   */
  billingIncrementMinutes: number;

  /**
   * Minimum billable MINUTES per confirmed attendance. 0 means no minimum.
   *
   * REQUIRED for the same reason, and it must be stated even when it is zero,
   * so that "no minimum" is a decision somebody made rather than a field nobody
   * filled in. Applied PER ATTENDANCE per MSA 1.5, not once per invoice.
   */
  minimumCallOutMinutes: number | { weekday: number; weekend: number };

  /**
   * Days of written notice the contract requires before terms may change.
   *
   * REQUIRED, and stated even when it is zero, for the same reason as the
   * minimum call-out: "no notice period was agreed" is a decision, and a field
   * nobody filled in is not. Matt's A/V MSA and most service agreements carry
   * thirty; 30 is the value to reach for absent a specific term.
   *
   * The app uses it to refuse an effective date sooner than notice allows, so a
   * rate change cannot be backdated into work already performed. It CANNOT know
   * whether notice was actually served -- only that the date leaves room for it.
   * That gap is why recording terms produces a notice letter to send.
   *
   * Tenant-wide rather than per-customer. Terms themselves are tenant-wide in
   * this schema today; when a customer needs its own terms, its own notice
   * period follows them there.
   */
  termsNoticeDays: number;

  /**
   * IANA timezone the work happens in, e.g. "America/New_York". REQUIRED.
   *
   * Time entries are stored as UTC, but every rule that cares about "which day"
   * means the LOCAL day. A Friday 20:00 job in Connecticut is 00:00 SATURDAY in
   * UTC, so a weekend minimum resolved off UTC would bill a weekend rate for a
   * Friday evening -- silently, and only on evening jobs, which for an A/V
   * business is most of them. There is no safe default: UTC mis-bills every US
   * tenant, and a Worker's own zone is wherever the request happened to land.
   */
  timezone: string;
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
