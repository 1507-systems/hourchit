import { describe, expect, it } from 'vitest';
import {
  formatCents,
  mileageAmountCents,
  parseDollarsToCents,
  roundHalfAwayFromZero,
  timeAmountCents,
} from '../src/domain/money';

describe('money', () => {
  it('rounds ties away from zero', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
  });

  it('bills time by the second at an hourly rate', () => {
    expect(timeAmountCents(3600, 9500)).toBe(9500); // 1 hr @ $95
    expect(timeAmountCents(5400, 9500)).toBe(14250); // 1.5 hr
    expect(timeAmountCents(0, 9500)).toBe(0);
    expect(timeAmountCents(1800, 10000)).toBe(5000); // 30 min @ $100
  });

  it('bills mileage per mile with fractional distances', () => {
    expect(mileageAmountCents(36.8, 70)).toBe(2576); // 36.8 * 70 = 2576
    expect(mileageAmountCents(10, 70)).toBe(700);
  });

  it('formats and parses dollars', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(parseDollarsToCents('95')).toBe(9500);
    expect(parseDollarsToCents('$1,234.56')).toBe(123456);
    expect(() => parseDollarsToCents('abc')).toThrow();
  });
});
