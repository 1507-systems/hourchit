/**
 * Turning elapsed time into billable time.
 *
 * WHY THIS EXISTS. Before it, HourChit billed raw elapsed seconds, and a one
 * second entry invoiced as quantity 0.00 hr at $125/hr for $0.03. Two separate
 * problems in one line:
 *
 *   1. No minimum call-out and no increment, so a trip that cost somebody their
 *      evening could bill pennies.
 *   2. The line DID NOT MULTIPLY OUT. Quantity was rounded to two decimals for
 *      display while the amount was computed from raw seconds, so 5 minutes read
 *      "0.08 hr x $125.00 = $10.42" when 0.08 x 125 is $10.00. An invoice whose
 *      arithmetic is visibly wrong is one accounts payable stops to query, and a
 *      query is a month.
 *
 * Rounding to an increment fixes both, because quantity and amount then derive
 * from the SAME rounded number and always reconcile.
 *
 * ROUNDING IS UP, NOT NEAREST. The "7 minute rule" (1-7 down, 8-14 up) is a
 * PAYROLL convention: it exists under the FLSA so that rounding an employee's
 * hours stays neutral over time. Billing a client carries no such neutrality
 * requirement, and rounding up to the increment is the trade norm. It also
 * matches the 1507 Systems break-fix card, which bills $25 per 15 minute
 * increment, and Matt's A/V SOW 3.2, which reads "increments of 15 minutes,
 * rounded up to the next increment".
 *
 * THE MINIMUM APPLIES PER ATTENDANCE, NOT PER INVOICE. MSA 1.5 reads "each
 * confirmed attendance is billable at the minimum". Three separate twenty minute
 * visits are three attendances and three minimums, so the minimum is applied to
 * each time entry before anything is summed. Applying it once to the aggregate
 * would quietly undercharge for every visit after the first.
 */

export interface BillingTerms {
  /** Increment in minutes; billable time rounds UP to a multiple of this. */
  incrementMinutes: number;
  /** Minimum billable minutes per attendance. 0 means no minimum. */
  minimumCallOutMinutes: number;
}

/**
 * Billable seconds for ONE attendance (one time entry).
 *
 * Zero stays zero: an entry with no elapsed time is not an attendance, and
 * charging a minimum for it would bill for a mis-click.
 */
export function billableSeconds(rawSeconds: number, terms: BillingTerms): number {
  if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) return 0;

  const increment = Math.max(1, Math.round(terms.incrementMinutes)) * 60;
  const minimum = Math.max(0, Math.round(terms.minimumCallOutMinutes)) * 60;

  const rounded = Math.ceil(rawSeconds / increment) * increment;

  // The minimum is itself rounded up to the increment, so a minimum that is not
  // a whole number of increments can never produce an un-billable quantity.
  const flooredMinimum = minimum > 0 ? Math.ceil(minimum / increment) * increment : 0;

  return Math.max(rounded, flooredMinimum);
}

/** Billable seconds across many attendances, each rounded on its own. */
export function billableSecondsTotal(rawSecondsPerEntry: number[], terms: BillingTerms): number {
  return rawSecondsPerEntry.reduce((sum, s) => sum + billableSeconds(s, terms), 0);
}

/**
 * Hours for an invoice line, exact rather than rounded for display.
 *
 * Because billable seconds are always a whole number of increments, this is
 * always a clean multiple (0.25, 0.5, ...) for the common 15 minute case, and
 * quantity x rate reconciles to the amount exactly. That is the property the
 * old code lacked.
 */
export function billableHours(seconds: number): number {
  return seconds / 3600;
}

/**
 * The money for a line, computed FROM THE QUANTITY rather than alongside it.
 *
 * Deliberately not `seconds / 3600 * rate` computed independently: that is how
 * the quantity and the amount drifted apart in the first place.
 */
export function amountCentsFor(seconds: number, rateCentsPerHour: number): number {
  return Math.round(billableHours(seconds) * rateCentsPerHour);
}
