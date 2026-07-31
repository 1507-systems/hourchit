/**
 * Effective-dated commercial terms.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: terms are resolved against the
 * moment the WORK WAS PERFORMED, never against the moment an invoice is
 * created. Bryce, 2026-07-31: "old rate (this is why we version and
 * timestamp)". Work done in August bills at August's rate even if the invoice
 * is raised in September and the rate rose on the 1st, because the work was
 * performed under the terms in force at the time and billing it at a rate the
 * client never agreed to is what gets an invoice disputed.
 *
 * Resolving against invoice date is the obvious implementation and it is
 * exactly backwards -- it silently reprices every uninvoiced hour each time a
 * rate moves. Persisting invoice lines (migration 0006) already protects
 * invoices ALREADY ISSUED; this protects the gap that remained, which is work
 * performed but not yet billed when the terms change.
 */
import type { BillingTerms, MinimumCallOut } from './billing';
import { localDateString, zonedWallTimeToUtc } from './localtime';

export interface TermVersion {
  id: number;
  effective_from: string;
  billing_increment_minutes: number;
  /** Minutes as a number, or JSON `{"weekday":n,"weekend":n}`. */
  minimum_callout: string;
  mileage_rate_cents: number;
  mileage_billable: number;
  recorded_at: string;
  recorded_by: string;
  note: string;
}

export interface TaskRateVersion {
  id: number;
  task_id: number;
  effective_from: string;
  rate_cents_per_hour: number;
  effective_note?: string;
}

/**
 * The version in force at `instant`.
 *
 * Versions are assumed sorted newest-first, which is how the index returns
 * them. Returns the newest whose effective_from is at or before the instant.
 *
 * RETURNS NULL WHEN THE INSTANT PRECEDES EVERY VERSION, and that is the
 * important case. The caller then falls back to the TENANT PROFILE, which is
 * the implicit version zero -- the terms that were in force before anyone
 * recorded one.
 *
 * Falling back to the OLDEST VERSION instead would be a trap, and this was
 * written that way first: with a single version effective 1 September, work
 * performed in August would resolve to September's terms. Recording a term
 * version would retroactively reprice every hour that came before it, which is
 * the exact failure this whole feature exists to prevent. Caught by testing
 * against real data rather than by reading the code.
 */
export function versionAt<T extends { effective_from: string }>(
  versionsNewestFirst: T[],
  instant: string,
): T | null {
  for (const v of versionsNewestFirst) {
    if (v.effective_from <= instant) return v;
  }
  return null;
}

/**
 * Parse the stored minimum, which is either a plain number of minutes or a
 * day-split object.
 *
 * Stored as TEXT precisely so the split form survives. Flattening it to a
 * single number would silently destroy a term like Matt's A/V SOW 3.3 -- four
 * hours for an event beginning Saturday or Sunday, none Monday to Friday --
 * and the failure would be invisible until an invoice came out wrong.
 */
export function parseMinimumCallOut(stored: string): MinimumCallOut {
  const trimmed = stored.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { weekday?: unknown }).weekday === 'number' &&
      typeof (parsed as { weekend?: unknown }).weekend === 'number'
    ) {
      return parsed as { weekday: number; weekend: number };
    }
  } catch {
    // fall through to the error below
  }
  throw new Error(
    `Unreadable minimum call-out ${JSON.stringify(stored)}. Expected a number of ` +
      'minutes or {"weekday":n,"weekend":n}.',
  );
}

/** Serialize back, so a round trip through the settings form is lossless. */
export function serializeMinimumCallOut(m: MinimumCallOut): string {
  return typeof m === 'number' ? String(m) : JSON.stringify(m);
}

/**
 * Build the BillingTerms in force when a piece of work was performed.
 *
 * weekendDays and timezone come from the profile rather than the version:
 * which days are the weekend, and where the business operates, are facts about
 * the tenant rather than commercial terms that get renegotiated. Splitting
 * them out keeps a term version to the things a client actually agrees to.
 */
export function termsForInstant(
  versionsNewestFirst: TermVersion[],
  instant: string,
  tenant: { weekendDays: number[]; timezone: string },
): BillingTerms | null {
  const v = versionAt(versionsNewestFirst, instant);
  if (!v) return null;
  return {
    incrementMinutes: v.billing_increment_minutes,
    minimumCallOutMinutes: parseMinimumCallOut(v.minimum_callout),
    weekendDays: tenant.weekendDays,
    timezone: tenant.timezone,
  };
}

/** The hourly rate for a task at the moment the work was performed. */
export function taskRateForInstant(
  versionsNewestFirst: TaskRateVersion[],
  instant: string,
  fallbackCents: number,
): number {
  const v = versionAt(versionsNewestFirst, instant);
  return v ? v.rate_cents_per_hour : fallbackCents;
}

/**
 * The soonest a change may take effect, given the notice the contract requires.
 *
 * NOTICE PERIOD PLUS ONE DAY, counted in local calendar days.
 *
 * THE PLUS-ONE IS THE OPERATOR'S BUFFER FOR ACTUALLY SENDING IT, not an extra
 * day for the client. Bryce, 2026-07-31: "if I change terms NOW the earliest
 * effective is 30 days (full days) and I still have to send it out. If I set it
 * to 8/31 that means I have 4 business hours to send it (likely done but the +1
 * is safe and costs us basically nothing)."
 *
 * The contract's clock starts when notice is SERVED, and serving it is a
 * physical act that has not happened at the moment a version is recorded.
 * Dating a change exactly notice-period-away silently assumes the letter goes
 * out today. Usually it does. The day of slack removes the assumption for free.
 *
 * Returns midnight LOCAL on that date as a UTC instant, because a term boundary
 * has to be comparable with the stored work instants. A zero-day notice period
 * still yields tomorrow -- terms can never take effect today or in the past,
 * whatever the contract says, since work already performed today would reprice
 * mid-day.
 *
 * This is a floor the app enforces. It does NOT mean notice was given; nothing
 * here can know that. See the notice letter the settings page produces.
 */
export function earliestEffectiveFrom(
  nowIso: string,
  noticeDays: number,
  timeZone: string,
): string {
  const today = localDateString(nowIso, timeZone);
  const [y, m, d] = today.split('-').map(Number);
  // Calendar arithmetic in UTC space, then read back as plain Y-M-D. Adding
  // days to a UTC midnight cannot drift, whereas adding 24h to a local instant
  // lands an hour out across a DST boundary.
  const shifted = new Date(Date.UTC(y, m - 1, d) + (Math.max(0, Math.floor(noticeDays)) + 1) * 86_400_000);
  return zonedWallTimeToUtc(`${shifted.toISOString().slice(0, 10)}T00:00`, timeZone);
}

/**
 * The notice a TENANT-WIDE term change owes, across every client it touches.
 *
 * THE LONGEST ONE WINS, and that is the whole reason this function exists. The
 * clause being implemented -- Matt's A/V MSA section 3.3 -- governs "standard
 * rate updates applicable across Provider's client base": one change, every
 * client, each under their own separately negotiated notice period. Satisfying
 * the shortest of them breaches all the others, silently, and the breach is
 * only discoverable by reading each SOW back against the date served.
 *
 * A client whose notice period is UNSTATED is reported rather than skipped.
 * Treating null as zero would let one unread SOW quietly shorten the floor for
 * everybody; treating it as "ask somebody" is the honest reading, because
 * nobody has said what this client agreed to.
 *
 * Archived clients are excluded by the caller: a change cannot owe notice to an
 * engagement that has ended.
 */
export function noticeDaysForTenantChange(
  clients: Array<{ id: number; name: string; notice_days: number | null }>,
): { days: number; longestFrom: string | null; unstated: Array<{ id: number; name: string }> } {
  const unstated = clients
    .filter((c) => c.notice_days === null || !Number.isFinite(c.notice_days))
    .map((c) => ({ id: c.id, name: c.name }));

  let days = 0;
  let longestFrom: string | null = null;
  for (const c of clients) {
    if (c.notice_days === null || !Number.isFinite(c.notice_days)) continue;
    if (c.notice_days > days) {
      days = c.notice_days;
      longestFrom = c.name;
    }
  }
  return { days, longestFrom, unstated };
}

/**
 * Whether a proposed effective date would rewrite history.
 *
 * A term version dated before work that has ALREADY BEEN INVOICED would change
 * what that period was billed at. The invoice itself is safe -- its lines are
 * frozen (migration 0006) -- but the disagreement between the stored invoice
 * and what the terms now say is exactly the kind of thing that surfaces two
 * years later during a dispute and cannot be explained.
 *
 * Returns the conflicting boundary so the caller can say WHICH invoice is in
 * the way, rather than refusing with a vague error.
 */
export function conflictsWithInvoicedWork(
  effectiveFrom: string,
  latestInvoicedWorkAt: string | null,
): { conflicts: boolean; latestInvoicedWorkAt: string | null } {
  if (!latestInvoicedWorkAt) return { conflicts: false, latestInvoicedWorkAt: null };
  return {
    conflicts: effectiveFrom <= latestInvoicedWorkAt,
    latestInvoicedWorkAt,
  };
}
