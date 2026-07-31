import { describe, expect, it } from 'vitest';
import {
  amountCentsFor,
  billableHours,
  billableSeconds,
  billableSecondsTotal,
  type BillingTerms,
} from '../src/domain/billing';

/** Tarnsby's terms: 15 minute increments, one hour minimum call-out. */
const T: BillingTerms = { incrementMinutes: 15, minimumCallOutMinutes: 60 };
/** Increments only, no minimum. */
const INC_ONLY: BillingTerms = { incrementMinutes: 15, minimumCallOutMinutes: 0 };

const MIN = 60;
const HOUR = 3600;

describe('billableSeconds', () => {
  it('bills the minimum call-out for a trivially short attendance', () => {
    // The bug this fixes: one second used to invoice as $0.03.
    expect(billableSeconds(1, T)).toBe(HOUR);
    expect(billableSeconds(45 * MIN, T)).toBe(HOUR);
  });

  it('rounds UP to the increment once past the minimum', () => {
    expect(billableSeconds(61 * MIN, T)).toBe(75 * MIN);
    expect(billableSeconds(75 * MIN, T)).toBe(75 * MIN);
    expect(billableSeconds(76 * MIN, T)).toBe(90 * MIN);
  });

  it('rounds up rather than to nearest, so 1 minute is a full increment', () => {
    // Explicitly NOT the payroll 7-minute rule: that is an FLSA convention for
    // paying employees, where rounding must stay neutral. Billing a client
    // rounds up, per Matt's A/V SOW 3.2 and the 1507 break-fix card.
    expect(billableSeconds(1 * MIN, INC_ONLY)).toBe(15 * MIN);
    expect(billableSeconds(7 * MIN, INC_ONLY)).toBe(15 * MIN);
    expect(billableSeconds(8 * MIN, INC_ONLY)).toBe(15 * MIN);
    expect(billableSeconds(16 * MIN, INC_ONLY)).toBe(30 * MIN);
  });

  it('leaves an exact increment alone rather than pushing to the next', () => {
    // An off-by-one with Math.ceil would bill 15 minutes as 30.
    expect(billableSeconds(15 * MIN, INC_ONLY)).toBe(15 * MIN);
    expect(billableSeconds(HOUR, INC_ONLY)).toBe(HOUR);
  });

  it('bills nothing for a zero or negative entry', () => {
    // A mis-click is not an attendance, so the minimum must not apply to it.
    expect(billableSeconds(0, T)).toBe(0);
    expect(billableSeconds(-5, T)).toBe(0);
    expect(billableSeconds(NaN, T)).toBe(0);
  });

  it('rounds a minimum that is not a whole number of increments up to one', () => {
    const odd: BillingTerms = { incrementMinutes: 15, minimumCallOutMinutes: 20 };
    expect(billableSeconds(60, odd)).toBe(30 * MIN);
  });

  it('supports other increments, including tenths of an hour', () => {
    const tenths: BillingTerms = { incrementMinutes: 6, minimumCallOutMinutes: 0 };
    expect(billableSeconds(1, tenths)).toBe(6 * MIN);
    expect(billableSeconds(13 * MIN, tenths)).toBe(18 * MIN);
  });
});

describe('billableSecondsTotal', () => {
  it('applies the minimum PER ATTENDANCE, not once across the invoice', () => {
    // MSA 1.5: "each confirmed attendance is billable at the minimum". Three
    // separate twenty minute visits are three call-outs. Summing raw seconds
    // first and rounding once would bill one hour instead of three.
    const three = [20 * MIN, 20 * MIN, 20 * MIN];
    expect(billableSecondsTotal(three, T)).toBe(3 * HOUR);
  });

  it('does not let a zero-length entry earn a minimum', () => {
    expect(billableSecondsTotal([0, 20 * MIN], T)).toBe(HOUR);
  });

  it('sums independently rounded attendances', () => {
    expect(billableSecondsTotal([16 * MIN, 16 * MIN], INC_ONLY)).toBe(60 * MIN);
  });
});

describe('invoice lines reconcile', () => {
  it('quantity times rate always equals the amount', () => {
    // THE REGRESSION GUARD. Previously quantity was rounded to 2dp for display
    // while the amount came from raw seconds, so 5 minutes printed as
    // "0.08 hr x $125.00 = $10.42" -- arithmetic a client can see is wrong.
    const rate = 12500;
    for (const raw of [1, 60, 300, 450, 480, 900, 3600, 5000, 7300]) {
      const secs = billableSeconds(raw, T);
      const qty = billableHours(secs);
      const amount = amountCentsFor(secs, rate);
      expect(Math.round(qty * rate)).toBe(amount);
    }
  });

  it('produces clean quarter-hour quantities for a 15 minute increment', () => {
    for (const raw of [1, 300, 3700, 5000]) {
      const qty = billableHours(billableSeconds(raw, T));
      expect(Number.isInteger(qty * 4)).toBe(true);
    }
  });

  it('bills the documented example correctly', () => {
    // 0:01 on Event Management at $125/hr, which started this: it must be one
    // hour at $125.00, not 0.00 hr at $0.03.
    const secs = billableSeconds(1, T);
    expect(billableHours(secs)).toBe(1);
    expect(amountCentsFor(secs, 12500)).toBe(12500);
  });
});
