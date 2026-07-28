/**
 * Mileage classification — the "smarts".
 *
 * The rule (configurable per tenant): a trip on a known route between the
 * owner's home and a client site is billable business travel when it happens
 * OUTSIDE normal daytime hours — i.e. at/after an after-hours cutoff (default
 * 16:30) OR on a weekend. Ordinary daytime commuting is not billed.
 *
 * Trips are classified on their LOCAL wall-clock time. We parse the naive
 * "YYYY-MM-DDTHH:MM" the user entered directly, with no timezone conversion,
 * so the cutoff means what the owner's wristwatch said.
 */

export interface MileageRule {
  /** Minutes past local midnight at/after which a trip counts as after-hours. */
  afterHoursStartMinutes: number;
  /** Local weekday indices (0=Sun..6=Sat) that count as the weekend. */
  weekendDays: number[];
}

export const DEFAULT_MILEAGE_RULE: MileageRule = {
  afterHoursStartMinutes: 16 * 60 + 30, // 16:30
  weekendDays: [0, 6], // Sunday, Saturday
};

export interface LocalDateTimeParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  minutesOfDay: number; // 0-1439
  weekday: number; // 0=Sun..6=Sat
}

/** Parse a naive local "YYYY-MM-DDTHH:MM" (or with seconds) into parts. */
export function parseLocalDateTime(local: string): LocalDateTimeParts {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) {
    throw new Error(`parseLocalDateTime: expected "YYYY-MM-DDTHH:MM", got ${JSON.stringify(local)}`);
  }
  const [, y, mo, d, hh, mm] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  // Date.UTC gives a stable weekday for the calendar date with no TZ drift.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, minutesOfDay: Number(hh) * 60 + Number(mm), weekday };
}

export interface Classification {
  billable: boolean;
  reason: 'weekend' | 'after-hours' | 'daytime-weekday';
}

/** Decide whether a trip at the given local time is billable under the rule. */
export function classifyTrip(
  localDateTime: string,
  rule: MileageRule = DEFAULT_MILEAGE_RULE,
): Classification {
  const parts = parseLocalDateTime(localDateTime);
  if (rule.weekendDays.includes(parts.weekday)) {
    return { billable: true, reason: 'weekend' };
  }
  if (parts.minutesOfDay >= rule.afterHoursStartMinutes) {
    return { billable: true, reason: 'after-hours' };
  }
  return { billable: false, reason: 'daytime-weekday' };
}

/** "16:30" <-> minutes-of-day helpers for reading/writing config. */
export function hhmmToMinutes(hhmm: string): number {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`hhmmToMinutes: expected "HH:MM", got ${JSON.stringify(hhmm)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Distance provider seam. Round one resolves distance from the route table
 * (a stored one-way mileage). A future provider (Google Maps Distance Matrix)
 * can implement this same interface without touching callers or schema.
 */
export interface DistanceProvider {
  /** Round-trip miles for a named route. */
  roundTripMiles(route: { oneWayMiles: number }): number;
}

export const routeTableDistance: DistanceProvider = {
  roundTripMiles: (route) => route.oneWayMiles * 2,
};
