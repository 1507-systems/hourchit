import { describe, expect, it } from 'vitest';
import {
  conflictsWithInvoicedWork,
  noticeDaysForTenantChange,
  parseMinimumCallOut,
  serializeMinimumCallOut,
  taskRateForInstant,
  termsForInstant,
  versionAt,
  type TermVersion,
} from '../src/domain/terms';

function tv(id: number, effective: string, extra: Partial<TermVersion> = {}): TermVersion {
  return {
    id,
    effective_from: effective,
    basis: 'notice',
    agreed_with: '',
    billing_increment_minutes: 15,
    minimum_callout: '60',
    mileage_rate_cents: 76,
    mileage_billable: 1,
    recorded_at: effective,
    recorded_by: '',
    note: '',
    ...extra,
  };
}

/** Newest first, as the index returns them. */
const VERSIONS = [
  tv(3, '2026-09-01 00:00:00', { billing_increment_minutes: 30 }),
  tv(2, '2026-08-01 00:00:00', { minimum_callout: '120' }),
  tv(1, '2026-06-01 00:00:00'),
];

describe('versionAt', () => {
  it('picks the version in force at the instant, not the newest', () => {
    // THE WHOLE POINT. Work in August resolves to August's terms even though a
    // September version exists, because the work was performed under August's.
    expect(versionAt(VERSIONS, '2026-08-15 12:00:00')?.id).toBe(2);
  });

  it('picks the newest once the instant passes it', () => {
    expect(versionAt(VERSIONS, '2026-09-02 09:00:00')?.id).toBe(3);
  });

  it('treats the effective instant itself as in force', () => {
    expect(versionAt(VERSIONS, '2026-08-01 00:00:00')?.id).toBe(2);
  });

  it('returns NULL for work predating every version, so the profile applies', () => {
    // THE TRAP THIS GUARDS. Falling back to the oldest VERSION would mean that
    // recording a term effective 1 September retroactively repriced August --
    // the exact failure the feature exists to prevent. Null sends the caller to
    // the tenant profile, which is the implicit version zero.
    expect(versionAt(VERSIONS, '2020-01-01 00:00:00')).toBeNull();
  });

  it('resolves to the profile when the ONLY version is in the future', () => {
    const future = [tv(1, '2026-09-01 00:00:00')];
    expect(versionAt(future, '2026-08-15 00:00:00')).toBeNull();
    expect(versionAt(future, '2026-09-02 00:00:00')?.id).toBe(1);
  });

  it('returns null when there are no versions at all', () => {
    expect(versionAt([], '2026-08-15 00:00:00')).toBeNull();
  });
});

describe('minimum call-out round trip', () => {
  it('reads a plain number of minutes', () => {
    expect(parseMinimumCallOut('60')).toBe(60);
    expect(parseMinimumCallOut('  0 ')).toBe(0);
  });

  it('reads the day-split form', () => {
    expect(parseMinimumCallOut('{"weekday":0,"weekend":240}')).toEqual({
      weekday: 0,
      weekend: 240,
    });
  });

  it('survives a round trip in BOTH forms', () => {
    // The regression guard. Flattening the split form back to a number would
    // silently destroy Matt's A/V SOW 3.3 -- four hours for an event beginning
    // Saturday or Sunday, none Monday to Friday -- and the failure would only
    // surface as a wrong invoice.
    for (const m of [60, 0, { weekday: 0, weekend: 240 }] as const) {
      expect(parseMinimumCallOut(serializeMinimumCallOut(m))).toEqual(m);
    }
  });

  it('refuses something unreadable rather than guessing a number', () => {
    expect(() => parseMinimumCallOut('four hours')).toThrow(/Unreadable minimum/);
    expect(() => parseMinimumCallOut('{"weekday":0}')).toThrow(/Unreadable minimum/);
    expect(() => parseMinimumCallOut('')).toThrow(/Unreadable minimum/);
  });
});

describe('termsForInstant', () => {
  const tenant = { weekendDays: [0, 6], timezone: 'America/Denver' };

  it('returns the terms in force when the work happened', () => {
    const t = termsForInstant(VERSIONS, '2026-08-15 12:00:00', tenant);
    expect(t?.incrementMinutes).toBe(15);
    expect(t?.minimumCallOutMinutes).toBe(120);
  });

  it('returns the later increment for later work', () => {
    expect(termsForInstant(VERSIONS, '2026-09-15 12:00:00', tenant)?.incrementMinutes).toBe(30);
  });

  it('carries the day-split minimum through intact', () => {
    const split = [tv(1, '2026-01-01 00:00:00', { minimum_callout: '{"weekday":0,"weekend":240}' })];
    expect(termsForInstant(split, '2026-08-01 00:00:00', tenant)?.minimumCallOutMinutes).toEqual({
      weekday: 0,
      weekend: 240,
    });
  });

  it('takes weekendDays and timezone from the tenant, not the version', () => {
    // Which days are the weekend, and where the business operates, are facts
    // about the tenant -- not commercial terms a client renegotiates.
    const t = termsForInstant(VERSIONS, '2026-08-15 12:00:00', tenant);
    expect(t?.timezone).toBe('America/Denver');
    expect(t?.weekendDays).toEqual([0, 6]);
  });
});

describe('taskRateForInstant', () => {
  const rates = [
    { id: 2, task_id: 1, effective_from: '2026-09-01 00:00:00', rate_cents_per_hour: 15000 },
    { id: 1, task_id: 1, effective_from: '2026-01-01 00:00:00', rate_cents_per_hour: 12500 },
  ];

  it('bills August work at the August rate after a September rise', () => {
    expect(taskRateForInstant(rates, '2026-08-20 18:00:00', 9999)).toBe(12500);
    expect(taskRateForInstant(rates, '2026-09-20 18:00:00', 9999)).toBe(15000);
  });

  it('uses the fallback when a task has no rate history', () => {
    expect(taskRateForInstant([], '2026-08-20 18:00:00', 9500)).toBe(9500);
  });
});

describe('conflictsWithInvoicedWork', () => {
  it('flags an effective date that would restate an invoiced period', () => {
    const r = conflictsWithInvoicedWork('2026-07-01 00:00:00', '2026-07-15 09:00:00');
    expect(r.conflicts).toBe(true);
    expect(r.latestInvoicedWorkAt).toBe('2026-07-15 09:00:00');
  });

  it('allows an effective date after all invoiced work', () => {
    expect(conflictsWithInvoicedWork('2026-08-01 00:00:00', '2026-07-15 09:00:00').conflicts).toBe(
      false,
    );
  });

  it('allows anything when nothing has been invoiced yet', () => {
    expect(conflictsWithInvoicedWork('2020-01-01 00:00:00', null).conflicts).toBe(false);
  });

  it('treats the boundary instant itself as a conflict', () => {
    // Equal means the new terms would cover that exact invoiced moment.
    expect(conflictsWithInvoicedWork('2026-07-15 09:00:00', '2026-07-15 09:00:00').conflicts).toBe(
      true,
    );
  });
});

describe('noticeDaysForTenantChange', () => {
  it('takes the LONGEST period, because one change touches every client', () => {
    // MSA 3.3 governs "standard rate updates applicable across Provider's
    // client base" -- one change, every client, each under their own
    // separately negotiated period. Satisfying the shortest breaches the rest.
    const r = noticeDaysForTenantChange([
      { id: 1, name: 'Grandvale College', notice_days: 30 },
      { id: 2, name: 'University of Bridgeport', notice_days: 60 },
      { id: 3, name: 'Harbor Theatre', notice_days: 14 },
    ]);
    expect(r.days).toBe(60);
    expect(r.longestFrom).toBe('University of Bridgeport');
    expect(r.unstated).toEqual([]);
  });

  it('reports an unstated client rather than treating null as zero', () => {
    // Null means nobody has read that SOW in. Counting it as zero would let one
    // unread agreement quietly shorten the floor for everybody.
    const r = noticeDaysForTenantChange([
      { id: 1, name: 'Grandvale College', notice_days: 60 },
      { id: 2, name: 'Harbor Theatre', notice_days: null },
    ]);
    expect(r.unstated).toEqual([{ id: 2, name: 'Harbor Theatre' }]);
    expect(r.days).toBe(60);
  });

  it('distinguishes a client that agreed to NO notice from one not yet read in', () => {
    const none = noticeDaysForTenantChange([{ id: 1, name: 'Cash job', notice_days: 0 }]);
    expect(none.days).toBe(0);
    expect(none.unstated).toEqual([]);
  });

  it('is zero with no clients at all, since there is nobody to notify', () => {
    const r = noticeDaysForTenantChange([]);
    expect(r.days).toBe(0);
    expect(r.longestFrom).toBeNull();
  });
});
