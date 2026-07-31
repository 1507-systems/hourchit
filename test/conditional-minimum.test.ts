import { describe, expect, it } from 'vitest';
import { billableSeconds, minimumMinutesFor, type BillingTerms } from '../src/domain/billing';
import { assertValidTimeZone, isLocalWeekend, localWeekday } from '../src/domain/localtime';

/**
 * Shaped on Matt's A/V SOW 3.3, which is the case a flat minimum cannot express:
 * four hours for an event beginning Saturday or Sunday, none Monday to Friday.
 */
const SPLIT: BillingTerms = {
  incrementMinutes: 15,
  minimumCallOutMinutes: { weekday: 0, weekend: 240 },
  weekendDays: [0, 6],
  timezone: 'America/New_York',
};

const MIN = 60;

describe('localWeekday', () => {
  it('reads the LOCAL day, not the UTC one', () => {
    // 2026-07-31T23:00Z is Friday in UTC but already 19:00 Friday in New York.
    expect(localWeekday('2026-07-31T23:00:00Z', 'America/New_York')).toBe(5);
    // 2026-08-01T02:00Z is Saturday in UTC but still 22:00 FRIDAY in New York.
    expect(localWeekday('2026-08-01T02:00:00Z', 'America/New_York')).toBe(5);
    expect(localWeekday('2026-08-01T02:00:00Z', 'UTC')).toBe(6);
  });

  it('respects the zone offset on the actual date, across DST', () => {
    // Standard time in January, daylight time in July: an hour that is Sunday
    // in one is not necessarily Sunday in the other.
    expect(localWeekday('2026-01-04T04:30:00Z', 'America/New_York')).toBe(6); // Sat 23:30
    expect(localWeekday('2026-07-05T03:30:00Z', 'America/New_York')).toBe(6); // Sat 23:30
  });

  it('throws on an unparseable instant rather than guessing a day', () => {
    expect(() => localWeekday('not-a-date', 'America/New_York')).toThrow();
  });
});

describe('isLocalWeekend', () => {
  it('uses the configured weekend days', () => {
    expect(isLocalWeekend('2026-08-01T16:00:00Z', 'America/New_York', [0, 6])).toBe(true);
    expect(isLocalWeekend('2026-07-31T16:00:00Z', 'America/New_York', [0, 6])).toBe(false);
    // A tenant whose weekend is Friday/Saturday gets a different answer for the
    // same instant, which is the point of it being configuration.
    expect(isLocalWeekend('2026-07-31T16:00:00Z', 'America/New_York', [5, 6])).toBe(true);
  });
});

describe('minimumMinutesFor', () => {
  it('keeps a plain number working unchanged', () => {
    const flat: BillingTerms = { ...SPLIT, minimumCallOutMinutes: 60 };
    expect(minimumMinutesFor(flat, '2026-08-01T16:00:00Z')).toBe(60);
    expect(minimumMinutesFor(flat)).toBe(60);
  });

  it('applies the weekend minimum to a Saturday start', () => {
    expect(minimumMinutesFor(SPLIT, '2026-08-01T16:00:00Z')).toBe(240);
  });

  it('applies no minimum to a weekday start', () => {
    expect(minimumMinutesFor(SPLIT, '2026-07-30T20:00:00Z')).toBe(0);
  });

  it('does NOT treat a Friday evening as the weekend', () => {
    // THE BUG THIS PREVENTS. Friday 22:00 in Connecticut is Saturday 02:00 UTC.
    // Resolving the split off the UTC weekday would bill a four hour weekend
    // minimum for a Friday evening job -- silently, and only on evening work,
    // which for an A/V business is most of it.
    expect(minimumMinutesFor(SPLIT, '2026-08-01T02:00:00Z')).toBe(0);
  });

  it('takes the larger side when no start instant is supplied', () => {
    // A caller that forgot the time must not be handed the cheaper answer:
    // under-billing a weekend minimum is what costs money, because a cancelled
    // weekend booking is payable AT the minimum under MSA 1.6(b).
    expect(minimumMinutesFor(SPLIT)).toBe(240);
  });
});

describe('billableSeconds with a split minimum', () => {
  it('bills a short Saturday attendance at four hours', () => {
    expect(billableSeconds(20 * MIN, SPLIT, '2026-08-01T16:00:00Z')).toBe(240 * MIN);
  });

  it('bills a short weekday attendance at actual time in the increment', () => {
    expect(billableSeconds(20 * MIN, SPLIT, '2026-07-30T20:00:00Z')).toBe(30 * MIN);
    expect(billableSeconds(1, SPLIT, '2026-07-30T20:00:00Z')).toBe(15 * MIN);
  });

  it('bills a long Saturday attendance at actual time once past the minimum', () => {
    expect(billableSeconds(300 * MIN, SPLIT, '2026-08-01T16:00:00Z')).toBe(300 * MIN);
  });

  it('judges by the START, so a job crossing midnight is one weekend attendance', () => {
    // Saturday 22:00 local, running three hours into Sunday. The SOW's
    // determinant is when the event is SCHEDULED TO BEGIN, so this is a single
    // weekend attendance rather than a boundary case.
    expect(billableSeconds(180 * MIN, SPLIT, '2026-08-02T02:00:00Z')).toBe(240 * MIN);
  });

  it('still bills nothing for a zero-length entry, on either side', () => {
    expect(billableSeconds(0, SPLIT, '2026-08-01T16:00:00Z')).toBe(0);
    expect(billableSeconds(0, SPLIT, '2026-07-30T20:00:00Z')).toBe(0);
  });
});

describe('assertValidTimeZone', () => {
  it('accepts a real IANA zone and rejects nonsense', () => {
    expect(() => assertValidTimeZone('America/New_York')).not.toThrow();
    expect(() => assertValidTimeZone('UTC')).not.toThrow();
    expect(() => assertValidTimeZone('Mars/Olympus')).toThrow(/Invalid IANA timezone/);
    expect(() => assertValidTimeZone('')).toThrow();
  });
});
