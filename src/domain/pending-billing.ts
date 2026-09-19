import type { TimeEntry } from './time';
import { durationSeconds } from './time';
import { billableSeconds, type BillingTerms } from './billing';
import { splitBillableSecondsByLocalDate } from './localtime';
import {
  termsForInstant,
  taskRateForInstant,
  type TermVersion,
  type TaskRateVersion,
} from './terms';
import { normalizeEventName, normalizeChargeCode, type BillableTimeEntry } from './invoicing';

export const PENDING_DISPLAY_MODES = ['task_description', 'task', 'description'] as const;
export type PendingBillingDisplay = (typeof PENDING_DISPLAY_MODES)[number];
export const PENDING_DISPLAY_LABELS: Record<PendingBillingDisplay, string> = {
  task_description: 'Task + description',
  task: 'Task only',
  description: 'Description only',
};
export function parsePendingBillingDisplay(value: unknown): PendingBillingDisplay | null {
  return PENDING_DISPLAY_MODES.includes(value as PendingBillingDisplay)
    ? (value as PendingBillingDisplay)
    : null;
}
export interface InvoiceSelection {
  timeEntryIds: number[];
  mileageIds: number[];
}
export function selectionIds(value: unknown): number[] {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const ids = values.map((value) => {
    if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
      throw new Error('Choose valid pending billing entries.');
    }
    return Number(value);
  });
  if (new Set(ids).size !== ids.length)
    throw new Error('An entry was selected more than once. Refresh and try again.');
  return ids;
}
export type PendingTimeEntry = TimeEntry & {
  taskName: string;
  rateCentsPerHour: number;
};

/** One billing calculation shared by the selection preview and frozen invoice lines. */
export function billableTimeEntries(
  time: PendingTimeEntry[],
  terms: BillingTerms,
  termVersions: TermVersion[],
  rateHistory: Map<number, TaskRateVersion[]>,
): BillableTimeEntry[] {
  // Resolve every attendance first. Each remains its own invoice line; a
  // cross-midnight attendance is split so each line has its actual local date.
  const billableEntries: BillableTimeEntry[] = [];
  for (const e of time) {
    // The rate is likewise the one in force when the work was performed, not
    // the task's current rate.
    const rateThen = taskRateForInstant(
      rateHistory.get(e.taskId) ?? [],
      e.startedAt,
      e.rateCentsPerHour,
    );
    // Rounded PER ATTENDANCE before summing. MSA 1.5 makes the minimum apply to
    // each confirmed attendance, so three short visits are three minimums;
    // rounding the aggregate instead would bill for one.
    //
    // And rounded under the terms in force WHEN THAT ATTENDANCE HAPPENED, so a
    // later change to the increment or the minimum cannot reach backwards.
    const termsThen =
      termsForInstant(termVersions, e.startedAt, {
        weekendDays: terms.weekendDays,
        timezone: terms.timezone,
      }) ?? terms;
    const eventName = e.note?.trim() ? normalizeEventName(e.note) : '';
    const chargeCode = normalizeChargeCode(e.chargeCode ?? '');
    const termsKey = JSON.stringify({
      incrementMinutes: termsThen.incrementMinutes,
      minimumCallOutMinutes: termsThen.minimumCallOutMinutes,
      weekendDays: termsThen.weekendDays,
      timezone: termsThen.timezone,
    });
    const roundedSeconds = billableSeconds(
      durationSeconds(e.startedAt, e.stoppedAt as string),
      termsThen,
      e.startedAt,
    );
    const parts = splitBillableSecondsByLocalDate(
      e.startedAt,
      e.stoppedAt as string,
      termsThen.timezone,
      roundedSeconds,
    );
    for (const part of parts) {
      billableEntries.push({
        taskId: e.taskId,
        taskName: e.taskName,
        eventName,
        chargeCode,
        serviceDate: part.serviceDate,
        rateCentsPerHour: rateThen,
        termsKey,
        seconds: part.seconds,
      });
    }
  }
  return billableEntries;
}
