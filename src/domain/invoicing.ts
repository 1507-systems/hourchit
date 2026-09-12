/**
 * Invoice assembly. Turns unbilled time + billable mileage into line items and
 * totals. Pure, the caller supplies already-fetched, already-filtered rows.
 */
import { mileageAmountCents } from './money';

import { amountCentsFor, billableHours } from './billing';

export interface TaskTimeAggregate {
  taskId: number;
  taskName: string;
  eventName?: string | null;
  chargeCode?: string | null;
  serviceDate?: string | null;
  rateCentsPerHour: number;
  seconds: number;
}

export interface BillableTimeEntry extends TaskTimeAggregate {
  eventName: string;
  chargeCode: string | null;
  serviceDate: string;
  /** Distinguishes entries billed under different effective term versions. */
  termsKey: string;
}

export interface MileageItem {
  /** e.g. "Home ↔ Client site (2026-07-25)" */
  description: string;
  miles: number;
  rateCentsPerMile: number;
}

export interface InvoiceLine {
  kind: 'time' | 'mileage';
  description: string;
  detail?: string | null;
  serviceDate?: string | null;
  chargeCode?: string | null;
  quantity: number; // hours (2dp) or miles
  unit: 'hr' | 'mi';
  rateCents: number; // per hour or per mile
  amountCents: number;
}

/** A required, stable label for one concrete engagement on an invoice. */
export function normalizeEventName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('Enter an event name.');
  return normalized;
}

/** Optional free-text accounting destination, normalized for clean output. */
export function normalizeChargeCode(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

/** Preserve the line-level identity of every billable attendance. */
export function aggregateInvoiceTime(entries: BillableTimeEntry[]): TaskTimeAggregate[] {
  // Each attendance is separately auditable and separately billable. The
  // historical name remains because callers assemble invoice time here.
  return entries.map(({ termsKey: _termsKey, ...entry }) => ({ ...entry }));
}

export interface InvoiceTotals {
  lines: InvoiceLine[];
  timeSubtotalCents: number;
  mileageSubtotalCents: number;
  totalCents: number;
}

export interface InvoiceOptions {
  /**
   * Whether travel is billable to this client. REQUIRED, and the argument
   * itself is required — no default, no optional parameter.
   *
   * Callers must state it, because the failure mode is asymmetric: defaulting
   * to billable puts a charge on an invoice the client has already refused,
   * which surfaces as a rejection weeks later. Making it explicit costs one
   * argument at each call site and removes the possibility entirely.
   *
   * When false, mileage is omitted from the invoice rather than listed at zero.
   * A $0.00 line invites an accounts-payable clerk to query it, and the trips
   * are already preserved in the mileage log where the deduction is actually
   * claimed — so showing the client buys nothing and costs a phone call.
   */
  mileageBillable: boolean;
}

/** Build the line items and totals for an invoice. */
export function buildInvoice(
  timeByTask: TaskTimeAggregate[],
  mileage: MileageItem[],
  options: InvoiceOptions,
): InvoiceTotals {
  const { mileageBillable } = options;
  const lines: InvoiceLine[] = [];

  for (const t of timeByTask) {
    // t.seconds is ALREADY billable: each attendance was rounded to the
    // increment and floored at the minimum before being summed, because the
    // minimum applies per attendance (MSA 1.5) and rounding an aggregate would
    // give a different, smaller answer than rounding each visit.
    if (t.seconds <= 0) continue;
    const hours = billableHours(t.seconds);
    lines.push({
      kind: 'time',
      description: t.taskName,
      detail: t.eventName ?? null,
      serviceDate: t.serviceDate ?? null,
      chargeCode: t.chargeCode ?? null,
      quantity: hours,
      unit: 'hr',
      rateCents: t.rateCentsPerHour,
      // From the SAME hours the quantity shows, so the line always multiplies
      // out. Computing the two independently is what made 0.08 hr at $125.00
      // print as $10.42.
      amountCents: amountCentsFor(t.seconds, t.rateCentsPerHour),
    });
  }

  for (const m of mileage) {
    if (!mileageBillable) break;
    if (m.miles <= 0) continue;
    lines.push({
      kind: 'mileage',
      description: m.description,
      quantity: m.miles,
      unit: 'mi',
      rateCents: m.rateCentsPerMile,
      amountCents: mileageAmountCents(m.miles, m.rateCentsPerMile),
    });
  }

  const timeSubtotalCents = sum(lines.filter((l) => l.kind === 'time'));
  const mileageSubtotalCents = sum(lines.filter((l) => l.kind === 'mileage'));

  return {
    lines,
    timeSubtotalCents,
    mileageSubtotalCents,
    totalCents: timeSubtotalCents + mileageSubtotalCents,
  };
}

function sum(lines: InvoiceLine[]): number {
  return lines.reduce((acc, l) => acc + l.amountCents, 0);
}

/** Human invoice number, e.g. ("INV", 7) => "INV-0007". */
export function invoiceNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}
