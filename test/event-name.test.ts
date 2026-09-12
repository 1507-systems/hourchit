import { describe, expect, it } from 'vitest';
import { aggregateInvoiceTime, normalizeChargeCode, normalizeEventName } from '../src/domain/invoicing';
import { splitBillableSecondsByLocalDate } from '../src/domain/localtime';

describe('event names', () => {
  it('requires a non-empty event name', () => {
    expect(() => normalizeEventName('   ')).toThrow('Enter an event name.');
  });

  it('trims and collapses whitespace for stable invoice grouping', () => {
    expect(normalizeEventName('  Awards   Ceremony  ')).toBe('Awards Ceremony');
  });
});

describe('charge codes', () => {
  it('normalizes a supplied free-text charge code', () => {
    expect(normalizeChargeCode('  GL   5678  ')).toBe('GL 5678');
  });

  it('represents a blank charge code as null', () => {
    expect(normalizeChargeCode('   ')).toBeNull();
  });
});

describe('invoice time grouping', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    taskId: 1,
    taskName: 'Event Tech Management',
    eventName: 'Awards Ceremony',
    chargeCode: 'GL 5678',
    serviceDate: '2026-09-09',
    rateCentsPerHour: 12500,
    termsKey: '15|0/240|America/New_York',
    seconds: 3600,
    ...over,
  });

  it('keeps every source attendance as a separate invoice line', () => {
    const grouped = aggregateInvoiceTime([
      entry(),
      entry({ seconds: 1800 }),
      entry({ serviceDate: '2026-09-10', seconds: 7200 }),
    ]);

    expect(grouped).toHaveLength(3);
    expect(grouped.map((line) => line.seconds)).toEqual([3600, 1800, 7200]);
  });

  it('preserves each line event, charge code, rate, and terms', () => {
    const grouped = aggregateInvoiceTime([
      entry(),
      entry({ eventName: 'Fall Concert' }),
      entry({ chargeCode: 'GL 9999' }),
      entry({ rateCentsPerHour: 15000 }),
      entry({ termsKey: '30|0/240|America/New_York' }),
    ]);

    expect(grouped).toHaveLength(5);
    expect(grouped[2].chargeCode).toBe('GL 9999');
  });
});

describe('actual local work dates', () => {
  it('splits one attendance at local midnight without changing its billed total', () => {
    expect(
      splitBillableSecondsByLocalDate(
        '2026-09-10T05:30:00.000Z',
        '2026-09-10T06:30:00.000Z',
        'America/Denver',
        3600,
      ),
    ).toEqual([
      { serviceDate: '2026-09-09', seconds: 1800 },
      { serviceDate: '2026-09-10', seconds: 1800 },
    ]);
  });

  it('allocates a per-attendance minimum across dates only once', () => {
    const parts = splitBillableSecondsByLocalDate(
      '2026-09-10T05:50:00.000Z',
      '2026-09-10T06:10:00.000Z',
      'America/Denver',
      3600,
    );

    expect(parts).toEqual([
      { serviceDate: '2026-09-09', seconds: 1800 },
      { serviceDate: '2026-09-10', seconds: 1800 },
    ]);
    expect(parts.reduce((sum, part) => sum + part.seconds, 0)).toBe(3600);
  });

});
