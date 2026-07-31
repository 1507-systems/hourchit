import { describe, expect, it } from 'vitest';
import { buildInvoice } from '../src/domain/invoicing';
import { billableSeconds, type BillingTerms } from '../src/domain/billing';

const TERMS: BillingTerms = {
  incrementMinutes: 15,
  minimumCallOutMinutes: 60,
  weekendDays: [0, 6],
  timezone: 'America/Denver',
};

/**
 * These pin the property that makes persisting lines worth a migration: the
 * numbers an invoice records are a function of the terms IN FORCE WHEN IT WAS
 * ISSUED, and those terms change over time.
 */
describe('an invoice is a record, not a live query', () => {
  it('produces different lines under different terms for the same work', () => {
    const raw = 20 * 60; // twenty minutes

    const asIssued = buildInvoice(
      [
        {
          taskId: 1,
          taskName: 'Event Management',
          rateCentsPerHour: 12500,
          seconds: billableSeconds(raw, TERMS, '2026-07-30T20:00:00Z'),
        },
      ],
      [],
      { mileageBillable: false },
    );

    const laterTerms: BillingTerms = { ...TERMS, minimumCallOutMinutes: 240 };
    const ifRecomputedLater = buildInvoice(
      [
        {
          taskId: 1,
          taskName: 'Event Management',
          rateCentsPerHour: 12500,
          seconds: billableSeconds(raw, laterTerms, '2026-07-30T20:00:00Z'),
        },
      ],
      [],
      { mileageBillable: false },
    );

    // One hour when issued, four hours if the minimum were later raised and the
    // document re-derived. Recomputing at render time would silently restate an
    // invoice that had already been sent, and possibly already paid.
    expect(asIssued.totalCents).toBe(12500);
    expect(ifRecomputedLater.totalCents).toBe(50000);
    expect(asIssued.totalCents).not.toBe(ifRecomputedLater.totalCents);
  });

  it('produces different lines when only the timezone changes', () => {
    // Friday 22:00 Mountain is Saturday 04:00 UTC. A tenant whose zone is
    // corrected later would see historic weekend minimums appear or vanish.
    const split: BillingTerms = {
      ...TERMS,
      minimumCallOutMinutes: { weekday: 0, weekend: 240 },
    };
    const started = '2026-08-01T04:00:00Z';
    const inMountain = billableSeconds(20 * 60, split, started);
    const inUtc = billableSeconds(20 * 60, { ...split, timezone: 'UTC' }, started);

    expect(inMountain).toBe(30 * 60); // Friday locally: no minimum
    expect(inUtc).toBe(240 * 60); // Saturday in UTC: four hour minimum
    expect(inMountain).not.toBe(inUtc);
  });

  it('emits one line per task with quantity, unit, rate and amount to persist', () => {
    const totals = buildInvoice(
      [
        { taskId: 1, taskName: 'Event Management', rateCentsPerHour: 12500, seconds: 3600 },
        { taskId: 2, taskName: 'A/V Systems Support', rateCentsPerHour: 9500, seconds: 1800 },
      ],
      [{ description: 'Mileage: 2026-08-01 (weekend)', miles: 37.2, rateCentsPerMile: 76 }],
      { mileageBillable: true },
    );

    expect(totals.lines).toHaveLength(3);
    for (const l of totals.lines) {
      expect(l.description.length).toBeGreaterThan(0);
      expect(l.unit === 'hr' || l.unit === 'mi').toBe(true);
      expect(Number.isFinite(l.quantity)).toBe(true);
      expect(Number.isInteger(l.amountCents)).toBe(true);
    }
    // And every time line reconciles, which is what gets frozen.
    for (const l of totals.lines.filter((x) => x.kind === 'time')) {
      expect(Math.round(l.quantity * l.rateCents)).toBe(l.amountCents);
    }
  });
});
