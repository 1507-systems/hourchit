import { describe, expect, it } from 'vitest';
import { describeDuration, formatDuration, parseDuration } from '../src/domain/duration';

describe('parseDuration', () => {
  it('reads h:mm', () => {
    expect(parseDuration('4:00')).toBe(240);
    expect(parseDuration('0:30')).toBe(30);
    expect(parseDuration('1:45')).toBe(105);
    expect(parseDuration('0:00')).toBe(0);
    expect(parseDuration('12:00')).toBe(720);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDuration('  2:15 ')).toBe(135);
  });

  it('REFUSES a bare number rather than guessing minutes or hours', () => {
    // The whole reason this module exists. Someone typing 4 for "four hours"
    // against a minutes field stores a four MINUTE minimum, the form accepts
    // it, and it surfaces months later as invoices that are quietly short.
    expect(() => parseDuration('4')).toThrow(/ambiguous/);
    expect(() => parseDuration('240')).toThrow(/ambiguous/);
  });

  it('says what both readings would have been, so the fix is obvious', () => {
    expect(() => parseDuration('4')).toThrow(/4 hours is 4:00, 4 minutes is 0:04/);
  });

  it('refuses minutes past 59, which is a typo rather than a long duration', () => {
    expect(() => parseDuration('1:60')).toThrow(/Unreadable duration/);
    expect(() => parseDuration('1:99')).toThrow(/Unreadable duration/);
  });

  it('refuses prose and empty input', () => {
    expect(() => parseDuration('four hours')).toThrow(/Unreadable duration/);
    expect(() => parseDuration('')).toThrow(/Unreadable duration/);
    expect(() => parseDuration('4h30')).toThrow(/Unreadable duration/);
  });
});

describe('formatDuration', () => {
  it('round-trips through the parser', () => {
    for (const minutes of [0, 15, 30, 60, 90, 105, 240, 480]) {
      expect(parseDuration(formatDuration(minutes))).toBe(minutes);
    }
  });

  it('pads the minutes so the pattern always matches', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(60)).toBe('1:00');
  });
});

describe('describeDuration', () => {
  it('calls zero "none", because it is the absence of a term', () => {
    expect(describeDuration(0)).toBe('none');
  });

  it('reads naturally for the shapes a call-out actually takes', () => {
    expect(describeDuration(240)).toBe('4 h');
    expect(describeDuration(30)).toBe('30 min');
    expect(describeDuration(90)).toBe('1 h 30 min');
  });
});
