/**
 * Timer + duration accrual. Pure functions over timestamps — no I/O.
 *
 * A time entry is "running" while `stoppedAt` is null. Duration accrues against
 * its task and stays unbilled (invoiceId null) until an invoice is created.
 */

export interface TimeEntry {
  id: number;
  taskId: number;
  startedAt: string; // ISO-8601 UTC instant
  stoppedAt: string | null; // ISO-8601 UTC instant, or null while running
  note: string | null;
  invoiceId: number | null;
}

/** Whole seconds between two ISO instants (never negative). */
export function durationSeconds(startedAt: string, stoppedAt: string): number {
  const start = Date.parse(startedAt);
  const stop = Date.parse(stoppedAt);
  if (Number.isNaN(start) || Number.isNaN(stop)) {
    throw new Error('durationSeconds: invalid timestamp');
  }
  return Math.max(0, Math.round((stop - start) / 1000));
}

/** Seconds accrued by a single entry as of `nowIso` (handles the running case). */
export function entrySeconds(entry: TimeEntry, nowIso: string): number {
  return durationSeconds(entry.startedAt, entry.stoppedAt ?? nowIso);
}

/** The currently running entry, if any (at most one is expected). */
export function runningEntry(entries: TimeEntry[]): TimeEntry | undefined {
  return entries.find((e) => e.stoppedAt === null);
}

/**
 * Cumulative unbilled seconds for one task — the "how much do I have on the
 * clock for this job that I haven't invoiced yet" number.
 */
export function unbilledSecondsForTask(
  entries: TimeEntry[],
  taskId: number,
  nowIso: string,
): number {
  return entries
    .filter((e) => e.taskId === taskId && e.invoiceId === null)
    .reduce((total, e) => total + entrySeconds(e, nowIso), 0);
}

/** Format seconds as "H:MM" for compact display (e.g. 5400 => "1:30"). */
export function formatHoursMinutes(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Decimal hours to 2 places (used for invoice line items), e.g. 5400 => 1.5. */
export function decimalHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}
