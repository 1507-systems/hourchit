import { describe, expect, it } from 'vitest';
import { renderInvoice } from '../src/ui/invoice';

describe('event invoice presentation', () => {
  it('renders the service larger with the event and work date beneath it', () => {
    const html = renderInvoice({
      business: { name: 'Example AV', address: '1 Main St', email: 'owner@example.invalid', phone: '555-0100' },
      customer: { id: 1, name: 'College', address: '', email: '', archived: 0, workdrive_folder_id: null, notes: '', notice_days: 60, invoice_delivery_mode: 'hosted' },
      invoice: {
        id: 1, customer_id: 1, number: 'INV-0001', status: 'draft',
        period_start: '2026-09-09', period_end: '2026-09-09',
        time_subtotal_cents: 25000, mileage_subtotal_cents: 0, total_cents: 25000,
        currency: 'USD', created_at: '2026-09-10T00:00:00Z', sent_at: null, sent_method: null,
      },
      contents: { timeEntries: [], mileage: [] },
      terms: { incrementMinutes: 15, minimumCallOutMinutes: 0, weekendDays: [0, 6], timezone: 'America/New_York' },
      lines: [{
        id: 1, invoice_id: 1, kind: 'time', description: 'Event Tech Management',
        detail: 'Awards Ceremony', charge_code: 'GL 5678', service_date: '2026-09-09', quantity: 2, unit: 'hr',
        rate_cents: 12500, amount_cents: 25000, sort_order: 0,
      }],
    });

    expect(html).toContain('<div class="line-service">Event Tech Management - 9/9</div>');
    expect(html).toContain(
      '<link rel="icon" type="image/svg+xml" href="https://hourchit.app/icon-mark.svg">',
    );
    expect(html).toContain('<div class="line-detail">Awards Ceremony - GL 5678</div>');
    expect(html.indexOf('line-service')).toBeLessThan(html.indexOf('line-detail'));
    expect(html).toContain('action="/invoices/1/cancel"');
    expect(html).toContain('name="disposition" value="return"');
    expect(html).toContain('Return hours to unbilled');
    expect(html).toContain('name="disposition" value="delete"');
    expect(html).toContain('Delete hours');
  });

  it('shows enough hour precision for a split-midnight line to multiply out', () => {
    const html = renderInvoice({
      business: { name: 'Example AV', address: '', email: '', phone: '' },
      customer: { id: 1, name: 'College', address: '', email: '', archived: 0, workdrive_folder_id: null, notes: '', notice_days: 60, invoice_delivery_mode: 'hosted' },
      invoice: {
        id: 2, customer_id: 1, number: 'INV-0002', status: 'draft',
        period_start: '2026-09-09', period_end: '2026-09-10',
        time_subtotal_cents: 1563, mileage_subtotal_cents: 0, total_cents: 1563,
        currency: 'USD', created_at: '2026-09-10T00:00:00Z', sent_at: null, sent_method: null,
      },
      contents: { timeEntries: [], mileage: [] },
      terms: { incrementMinutes: 15, minimumCallOutMinutes: 0, weekendDays: [0, 6], timezone: 'America/Denver' },
      lines: [{
        id: 2, invoice_id: 2, kind: 'time', description: 'Event Tech Management',
        detail: 'Awards Ceremony', charge_code: null, service_date: '2026-09-09', quantity: 0.125, unit: 'hr',
        rate_cents: 12500, amount_cents: 1563, sort_order: 0,
      }],
    });

    expect(html).toContain('<td class="num">0.125</td>');
    expect(html).not.toContain('<td class="num">0.13</td>');
    expect(html).toContain('<div class="line-detail">Awards Ceremony</div>');
    expect(html).not.toContain('Awards Ceremony - </div>');
  });

  it('shows a canceled invoice as historical, not money currently due', () => {
    const html = renderInvoice({
      business: { name: 'Example AV', address: '', email: '', phone: '' },
      customer: { id: 1, name: 'College', address: '', email: '', archived: 0, workdrive_folder_id: null, notes: '', notice_days: 60, invoice_delivery_mode: 'hosted' },
      invoice: {
        id: 3, customer_id: 1, number: 'INV-0003', status: 'canceled',
        period_start: '2026-09-09', period_end: '2026-09-09',
        time_subtotal_cents: 12500, mileage_subtotal_cents: 0, total_cents: 12500,
        currency: 'USD', created_at: '2026-09-10T00:00:00Z', sent_at: null, sent_method: null,
      },
      contents: { timeEntries: [], mileage: [] },
      terms: { incrementMinutes: 15, minimumCallOutMinutes: 0, weekendDays: [0, 6], timezone: 'America/Denver' },
      lines: [],
    });

    expect(html).toContain('Canceled total');
    expect(html).not.toContain('Total due');
    expect(html).not.toContain('/invoices/3/cancel');
    expect(html).not.toContain('/invoices/3/email');
  });
});
