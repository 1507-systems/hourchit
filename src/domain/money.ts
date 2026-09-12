/**
 * Money is always stored and moved around as an integer number of cents.
 * Never use floating-point dollars for arithmetic, round once, at the edges.
 */

/** Round to the nearest integer, ties away from zero (standard invoice rounding). */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Amount in cents for time worked.
 * @param seconds  duration worked
 * @param rateCentsPerHour  billing rate, in cents per hour (e.g. $95/hr => 9500)
 */
export function timeAmountCents(seconds: number, rateCentsPerHour: number): number {
  return roundHalfAwayFromZero((seconds / 3600) * rateCentsPerHour);
}

/**
 * Amount in cents for mileage.
 * @param miles  distance (may be fractional, e.g. 36.8)
 * @param rateCentsPerMile  reimbursement rate in cents per mile (e.g. $0.70 => 70)
 */
export function mileageAmountCents(miles: number, rateCentsPerMile: number): number {
  return roundHalfAwayFromZero(miles * rateCentsPerMile);
}

/** Format integer cents as a human string, e.g. 123456 => "$1,234.56". */
export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/** Parse a dollar string ("95", "95.50", "$1,234.56") into integer cents. */
export function parseDollarsToCents(input: string): number {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (cleaned === '' || !/^-?\d*(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Not a valid dollar amount: ${JSON.stringify(input)}`);
  }
  return roundHalfAwayFromZero(parseFloat(cleaned) * 100);
}
