import { describe, expect, it } from 'vitest';
import { renderInvoice } from '../src/ui/invoice';
import { renderClients, renderClient } from '../src/ui/clients';
import { hostedSendDenialReason } from '../src/domain/invoice-delivery';
import type { Customer } from '../src/db';

/**
 * Invoice-delivery mode is a policy boundary, not a label: hiding the "Email
 * to client" button is a convenience, and the actual boundary is the route
 * guard (see test/invoice-send-route.test.ts). What is worth testing here is
 * that the UI never shows an action it cannot honor, and that the copy
 * describing "disabled" never drifts from the one string the route guard
 * actually enforces.
 */

function customer(mode: Customer['invoice_delivery_mode']): Customer {
  return {
    id: 1,
    name: 'College',
    address: '',
    email: 'ap@college.test',
    archived: 0,
    workdrive_folder_id: null,
    notes: '',
    notice_days: 60,
    invoice_delivery_mode: mode,
  };
}

function invoiceHtml(mode: Customer['invoice_delivery_mode'], forPrint = false, manualSendHandoffEnabled = false): string {
  return renderInvoice({
    business: { name: 'Example AV', address: '', email: '', phone: '' },
    customer: customer(mode),
    invoice: {
      id: 1,
      customer_id: 1,
      number: 'INV-0001',
      status: 'draft',
      period_start: '2026-09-09',
      period_end: '2026-09-09',
      time_subtotal_cents: 25000,
      mileage_subtotal_cents: 0,
      total_cents: 25000,
      currency: 'USD',
      created_at: '2026-09-10T00:00:00Z',
      sent_at: null,
      sent_method: null,
    },
    contents: { timeEntries: [], mileage: [] },
    terms: { incrementMinutes: 15, minimumCallOutMinutes: 0, weekendDays: [0, 6], timezone: 'America/New_York' },
    lines: [],
    forPrint,
    manualSendHandoffEnabled,
  });
}

describe('renderInvoice: action visibility per delivery mode', () => {
  it('hosted shows "Email to client" and not the mail-app handoff', () => {
    const html = invoiceHtml('hosted');
    expect(html).toContain('/invoices/1/email');
    expect(html).toContain('Email to client');
    expect(html).not.toContain('/invoices/1/mail-app');
  });

  it('mail_app shows the mail-app handoff and not the hosted-send action', () => {
    const html = invoiceHtml('mail_app');
    expect(html).toContain('/invoices/1/mail-app');
    expect(html).toContain('Compose invoice email');
    expect(html).not.toContain('/invoices/1/email');
  });

  it('mail_app wires the button to intercept for the native shell, calling window.native.composeMail with the full hosted-quality body', () => {
    const html = invoiceHtml('mail_app');
    expect(html).toContain('id="composeInvoiceEmail"');
    expect(html).toContain('/invoices/1/mail-app/compose');
    expect(html).toContain('native.composeMail(');
    expect(html).toContain('bodyIsHtml: true');
  });

  it('hosted and disabled never carry the native mail-app intercept script', () => {
    for (const mode of ['hosted', 'disabled'] as const) {
      const html = invoiceHtml(mode);
      expect(html).not.toContain('composeInvoiceEmail');
      expect(html).not.toContain('mail-app/compose');
    }
  });

  it('print output never carries the native mail-app intercept script, even in mail_app mode', () => {
    const html = invoiceHtml('mail_app', true);
    expect(html).not.toContain('composeInvoiceEmail');
    expect(html).not.toContain('mail-app/compose');
  });

  it('disabled shows neither send action, and states the canonical reason', () => {
    const html = invoiceHtml('disabled');
    expect(html).not.toContain('/invoices/1/email');
    expect(html).not.toContain('/invoices/1/mail-app');
    expect(html).not.toContain('Email to client');
    expect(html).toContain(hostedSendDenialReason('disabled')!);
  });

  it('print output never carries a send action, in any mode', () => {
    for (const mode of ['hosted', 'disabled', 'mail_app'] as const) {
      const html = invoiceHtml(mode, true);
      expect(html).not.toContain('/invoices/1/email');
      expect(html).not.toContain('/invoices/1/mail-app');
    }
  });
});

describe('renderClients: delivery-mode tag in the client list', () => {
  it('tags a disabled client', () => {
    const html = renderClients('Acme', [customer('disabled')], false, 'hosted');
    expect(html).toContain('invoice email disabled');
  });

  it('tags a mail_app client', () => {
    const html = renderClients('Acme', [customer('mail_app')], false, 'hosted');
    expect(html).toContain('sends via mail app');
  });

  it('leaves a hosted client untagged', () => {
    const html = renderClients('Acme', [customer('hosted')], false, 'hosted');
    expect(html).not.toContain('invoice email disabled');
    expect(html).not.toContain('sends via mail app');
  });
});

describe('renderClient: delivery-mode form and description', () => {
  it('preselects the client\'s own stored mode, not the tenant default', () => {
    const html = renderClient('Acme', customer('mail_app'), [], [], false);
    expect(html).toMatch(/<option value="mail_app" selected>/);
  });

  it('disabled description matches the canonical route-guard denial reason', () => {
    const html = renderClient('Acme', customer('disabled'), [], [], false);
    expect(html).toContain(hostedSendDenialReason('disabled')!);
  });

  it('mail_app description is honest about the operator still attaching and sending it themselves', () => {
    const html = renderClient('Acme', customer('mail_app'), [], [], false);
    expect(html).toMatch(/attach the PDF and hit send yourself/);
    expect(html).not.toMatch(/will attach|attached automatically|sends? it for you/i);
  });

  it('hosted description does not claim to be anything other than what it is', () => {
    const html = renderClient('Acme', customer('hosted'), [], [], false);
    expect(html).toContain("HourChit sends this client's invoices directly");
  });
});

it('opts in manual invoices only, preserving the PDF action', () => {
 const html = invoiceHtml('mail_app', false, true);
 expect(html).toContain('id="manual-send"');
 expect(html).toContain('Download PDF');
 expect(html).not.toContain('id="composeInvoiceEmail"');
 expect(invoiceHtml('mail_app')).not.toContain('id="manual-send"');
 expect(invoiceHtml('hosted', false, true)).not.toContain('id="manual-send"');
 expect(invoiceHtml('mail_app', true, true)).not.toContain('id="manual-send"');
});
it('excludes manual handoff controls from browser printing', () => {
 const html=invoiceHtml('mail_app',false,true);
 expect(html).toContain('<section class="manual-handoff">');
 expect(html).toMatch(/@media print[\s\S]*?\.manual-handoff[\s\S]*?display:\s*none/);
});
it('uses a real disabled button during preparation',()=>{
 expect(invoiceHtml('mail_app',false,true)).toContain('<button type="button" id="manual-send" disabled>Send</button>');
});
