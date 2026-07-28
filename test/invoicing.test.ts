import { describe, expect, it } from 'vitest';
import { buildInvoice, invoiceNumber } from '../src/domain/invoicing';

describe('invoicing', () => {
  it('builds line items and totals from time and mileage', () => {
    const totals = buildInvoice(
      [
        { taskId: 1, taskName: 'On-site coverage', rateCentsPerHour: 9500, seconds: 5400 }, // 1.5h => $142.50
        { taskId: 2, taskName: 'Remote support', rateCentsPerHour: 8000, seconds: 3600 }, // 1h => $80.00
      ],
      [{ description: 'Mileage — 2026-07-28 (after-hours)', miles: 36.8, rateCentsPerMile: 70 }], // $25.76
    );

    expect(totals.timeSubtotalCents).toBe(14250 + 8000);
    expect(totals.mileageSubtotalCents).toBe(2576);
    expect(totals.totalCents).toBe(14250 + 8000 + 2576);
    expect(totals.lines).toHaveLength(3);
    expect(totals.lines[0]).toMatchObject({ kind: 'time', quantity: 1.5, unit: 'hr' });
    expect(totals.lines[2]).toMatchObject({ kind: 'mileage', unit: 'mi' });
  });

  it('skips zero-quantity lines', () => {
    const totals = buildInvoice(
      [{ taskId: 1, taskName: 'Idle', rateCentsPerHour: 9500, seconds: 0 }],
      [{ description: 'nope', miles: 0, rateCentsPerMile: 70 }],
    );
    expect(totals.lines).toHaveLength(0);
    expect(totals.totalCents).toBe(0);
  });

  it('formats padded invoice numbers', () => {
    expect(invoiceNumber('MK', 7)).toBe('MK-0007');
    expect(invoiceNumber('INV', 1234)).toBe('INV-1234');
  });
});
