/**
 * Invoice assembly. Turns unbilled time + billable mileage into line items and
 * totals. Pure — the caller supplies already-fetched, already-filtered rows.
 */
import { decimalHours } from './time';
import { mileageAmountCents, timeAmountCents } from './money';

export interface TaskTimeAggregate {
  taskId: number;
  taskName: string;
  rateCentsPerHour: number;
  seconds: number;
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
  quantity: number; // hours (2dp) or miles
  unit: 'hr' | 'mi';
  rateCents: number; // per hour or per mile
  amountCents: number;
}

export interface InvoiceTotals {
  lines: InvoiceLine[];
  timeSubtotalCents: number;
  mileageSubtotalCents: number;
  totalCents: number;
}

/** Build the line items and totals for an invoice. */
export function buildInvoice(
  timeByTask: TaskTimeAggregate[],
  mileage: MileageItem[],
): InvoiceTotals {
  const lines: InvoiceLine[] = [];

  for (const t of timeByTask) {
    if (t.seconds <= 0) continue;
    const hours = decimalHours(t.seconds);
    lines.push({
      kind: 'time',
      description: t.taskName,
      quantity: hours,
      unit: 'hr',
      rateCents: t.rateCentsPerHour,
      amountCents: timeAmountCents(t.seconds, t.rateCentsPerHour),
    });
  }

  for (const m of mileage) {
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
