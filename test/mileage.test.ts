import { describe, expect, it } from 'vitest';
import {
  classifyTrip,
  DEFAULT_MILEAGE_RULE,
  hhmmToMinutes,
  minutesToHhmm,
  parseLocalDateTime,
  routeTableDistance,
} from '../src/domain/mileage';

describe('mileage classification', () => {
  it('bills a weekday trip after the 16:30 cutoff', () => {
    // 2026-07-28 is a Tuesday.
    expect(classifyTrip('2026-07-28T17:05')).toEqual({ billable: true, reason: 'after-hours' });
    expect(classifyTrip('2026-07-28T16:30')).toEqual({ billable: true, reason: 'after-hours' });
  });

  it('does not bill an ordinary daytime weekday commute', () => {
    expect(classifyTrip('2026-07-28T09:00')).toEqual({ billable: false, reason: 'daytime-weekday' });
    expect(classifyTrip('2026-07-28T16:29')).toEqual({ billable: false, reason: 'daytime-weekday' });
  });

  it('bills weekend trips regardless of time', () => {
    // 2026-08-01 Saturday, 2026-08-02 Sunday.
    expect(classifyTrip('2026-08-01T08:00')).toEqual({ billable: true, reason: 'weekend' });
    expect(classifyTrip('2026-08-02T13:00')).toEqual({ billable: true, reason: 'weekend' });
  });

  it('honors a custom rule', () => {
    const rule = { afterHoursStartMinutes: hhmmToMinutes('18:00'), weekendDays: [0, 6] };
    expect(classifyTrip('2026-07-28T17:05', rule).billable).toBe(false);
    expect(classifyTrip('2026-07-28T18:00', rule).billable).toBe(true);
  });

  it('parses local datetime without timezone drift', () => {
    const p = parseLocalDateTime('2026-07-28T17:05');
    expect(p).toMatchObject({ year: 2026, month: 7, day: 28, minutesOfDay: 1025, weekday: 2 });
  });

  it('rejects malformed datetimes', () => {
    expect(() => classifyTrip('not-a-date')).toThrow();
  });

  it('round-trips a route distance', () => {
    expect(routeTableDistance.roundTripMiles({ oneWayMiles: 18.4 })).toBeCloseTo(36.8);
  });

  it('HH:MM <-> minutes', () => {
    expect(hhmmToMinutes('16:30')).toBe(990);
    expect(minutesToHhmm(990)).toBe('16:30');
    expect(DEFAULT_MILEAGE_RULE.afterHoursStartMinutes).toBe(990);
  });
});
