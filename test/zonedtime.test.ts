import { describe, expect, it } from 'vitest';
import { localDateString, utcToZonedWallTime, zonedWallTimeToUtc } from '../src/domain/localtime';
import { earliestEffectiveFrom, versionAt } from '../src/domain/terms';

describe('zonedWallTimeToUtc', () => {
  it('reads a wall time as LOCAL, not as UTC', () => {
    // THE BUG THIS FIXES. "Effective 1 September" typed by an operator in
    // Denver means midnight in Denver, which is 06:00 UTC. Storing the typed
    // string as though it were UTC puts the boundary six hours early, so work
    // performed in the small hours of the 1st resolves to the OLD terms in
    // Denver and the NEW terms in London -- from identical data.
    expect(zonedWallTimeToUtc('2026-09-01T00:00', 'America/Denver')).toBe('2026-09-01T06:00:00.000Z');
    expect(zonedWallTimeToUtc('2026-09-01T00:00', 'UTC')).toBe('2026-09-01T00:00:00.000Z');
    expect(zonedWallTimeToUtc('2026-09-01T00:00', 'Europe/London')).toBe('2026-08-31T23:00:00.000Z');
  });

  it('uses the offset in force on that date, not a fixed one', () => {
    // Denver is UTC-7 in summer and UTC-6 in winter. A fixed offset is wrong
    // for half the year, and wrong in the direction that shifts a term boundary
    // across midnight.
    expect(zonedWallTimeToUtc('2026-07-01T00:00', 'America/Denver')).toBe('2026-07-01T06:00:00.000Z');
    expect(zonedWallTimeToUtc('2026-12-01T00:00', 'America/Denver')).toBe('2026-12-01T07:00:00.000Z');
  });

  it('lands correctly right at a DST transition', () => {
    // 2026-11-01 02:00 local is the fall-back in US zones. The single-pass
    // version of this function reads the offset at the wrong instant and lands
    // an hour out exactly here, which is why it resolves twice.
    expect(zonedWallTimeToUtc('2026-11-01T03:00', 'America/Denver')).toBe('2026-11-01T10:00:00.000Z');
    expect(zonedWallTimeToUtc('2026-11-01T00:00', 'America/Denver')).toBe('2026-11-01T06:00:00.000Z');
    // Spring forward: 2026-03-08 02:00 local does not exist. Any answer is a
    // choice, but it must be a defined instant rather than NaN.
    expect(zonedWallTimeToUtc('2026-03-08T02:30', 'America/Denver')).toMatch(/^2026-03-08T\d\d:\d\d/);
  });

  it('accepts seconds and the space-separated form', () => {
    expect(zonedWallTimeToUtc('2026-09-01 00:00:00', 'UTC')).toBe('2026-09-01T00:00:00.000Z');
  });

  it('refuses something it cannot read rather than returning an epoch', () => {
    expect(() => zonedWallTimeToUtc('the first of September', 'UTC')).toThrow(/unreadable local time/);
  });
});

describe('utcToZonedWallTime', () => {
  it('is the inverse of zonedWallTimeToUtc', () => {
    for (const wall of ['2026-01-15T09:30', '2026-07-04T23:45', '2026-11-01T00:00']) {
      expect(utcToZonedWallTime(zonedWallTimeToUtc(wall, 'America/Denver'), 'America/Denver')).toBe(wall);
    }
  });

  it('gives the local calendar date, which can differ from the UTC one', () => {
    // 06:00 UTC on the 1st is still 23:00 on the 31st in Denver.
    expect(localDateString('2026-09-01T04:00:00.000Z', 'America/Denver')).toBe('2026-08-31');
    expect(localDateString('2026-09-01T04:00:00.000Z', 'UTC')).toBe('2026-09-01');
  });
});

describe('term boundaries compare against work instants', () => {
  it('resolves a same-day boundary by TIME, not by string luck', () => {
    // The format bug this replaced: effective_from was stored as
    // "2026-09-01 18:00:00" while work instants are "2026-09-01T09:00:00.000Z".
    // Comparing those as strings puts the space before the T, so the version
    // sorted as though it were already in force -- and work performed NINE
    // HOURS BEFORE the change resolved to the new terms.
    const versions = [{ effective_from: zonedWallTimeToUtc('2026-09-01T18:00', 'UTC') }];
    expect(versionAt(versions, '2026-09-01T09:00:00.000Z')).toBeNull();
    expect(versionAt(versions, '2026-09-01T19:00:00.000Z')).not.toBeNull();
  });
});

describe('earliestEffectiveFrom', () => {
  const tz = 'America/Denver';

  it('is notice period plus one day, at local midnight', () => {
    // 30 days' notice served on 31 July is not satisfied by a change on 30
    // August: day thirty is still a day the client is owed.
    expect(earliestEffectiveFrom('2026-07-31T18:00:00.000Z', 30, tz)).toBe('2026-08-31T06:00:00.000Z');
  });

  it('still refuses today when no notice period is configured', () => {
    // A zero notice period means "no notice was agreed", not "effective
    // immediately". Terms taking effect today would reprice work already
    // performed this morning.
    expect(earliestEffectiveFrom('2026-07-31T18:00:00.000Z', 0, tz)).toBe('2026-08-01T06:00:00.000Z');
  });

  it('counts from the LOCAL day, not the UTC one', () => {
    // 02:00 UTC on 1 August is still 31 July in Denver, so the count starts
    // from the 31st. Using the UTC date would quietly give a day less notice.
    expect(earliestEffectiveFrom('2026-08-01T02:00:00.000Z', 30, tz)).toBe('2026-08-31T06:00:00.000Z');
  });

  it('crosses a DST boundary without drifting an hour', () => {
    // 30 days from 20 October crosses the fall-back, so the answer must be
    // midnight MST rather than 23:00 the day before.
    expect(earliestEffectiveFrom('2026-10-20T18:00:00.000Z', 30, tz)).toBe('2026-11-20T07:00:00.000Z');
  });
});
