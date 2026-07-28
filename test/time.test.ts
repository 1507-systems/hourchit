import { describe, expect, it } from 'vitest';
import {
  decimalHours,
  durationSeconds,
  formatHoursMinutes,
  runningEntry,
  TimeEntry,
  unbilledSecondsForTask,
} from '../src/domain/time';

const entry = (over: Partial<TimeEntry>): TimeEntry => ({
  id: 1,
  taskId: 1,
  startedAt: '2026-07-28T09:00:00.000Z',
  stoppedAt: '2026-07-28T10:30:00.000Z',
  note: null,
  invoiceId: null,
  ...over,
});

describe('time', () => {
  it('computes whole-second durations, never negative', () => {
    expect(durationSeconds('2026-07-28T09:00:00Z', '2026-07-28T10:30:00Z')).toBe(5400);
    expect(durationSeconds('2026-07-28T10:00:00Z', '2026-07-28T09:00:00Z')).toBe(0);
  });

  it('finds the single running entry', () => {
    const entries = [entry({ id: 1 }), entry({ id: 2, stoppedAt: null })];
    expect(runningEntry(entries)?.id).toBe(2);
    expect(runningEntry([entry({ id: 1 })])).toBeUndefined();
  });

  it('accrues only unbilled seconds for a task', () => {
    const now = '2026-07-28T12:00:00.000Z';
    const entries = [
      entry({ id: 1, startedAt: '2026-07-28T09:00:00Z', stoppedAt: '2026-07-28T10:00:00Z' }), // 1h unbilled
      entry({ id: 2, startedAt: '2026-07-28T10:00:00Z', stoppedAt: '2026-07-28T10:30:00Z', invoiceId: 5 }), // billed
      entry({ id: 3, startedAt: '2026-07-28T11:00:00Z', stoppedAt: null }), // running, 1h so far
      entry({ id: 4, taskId: 2, startedAt: '2026-07-28T09:00:00Z', stoppedAt: '2026-07-28T09:30:00Z' }), // other task
    ];
    expect(unbilledSecondsForTask(entries, 1, now)).toBe(3600 + 3600);
    expect(unbilledSecondsForTask(entries, 2, now)).toBe(1800);
  });

  it('formats hours and decimal hours', () => {
    expect(formatHoursMinutes(5400)).toBe('1:30');
    expect(formatHoursMinutes(90)).toBe('0:02');
    expect(decimalHours(5400)).toBe(1.5);
  });
});
