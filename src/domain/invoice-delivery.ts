/**
 * How an invoice leaves this tenant, per client.
 *
 * Every client stores an explicit mode; the tenant default only seeds a
 * client at creation and is never read again for a client that already
 * exists. See docs/superpowers/specs/2026-09-10-invoice-delivery-modes-design.md.
 */

export const invoiceDeliveryModes = ['hosted', 'disabled', 'mail_app'] as const;
export type InvoiceDeliveryMode = (typeof invoiceDeliveryModes)[number];

export function parseInvoiceDeliveryMode(value: unknown): InvoiceDeliveryMode | null {
  return (invoiceDeliveryModes as readonly unknown[]).includes(value)
    ? (value as InvoiceDeliveryMode)
    : null;
}

export const INVOICE_DELIVERY_MODE_LABELS: Record<InvoiceDeliveryMode, string> = {
  hosted: 'HourChit sends it',
  disabled: 'Disabled',
  mail_app: 'Send with your mail app',
};

/**
 * The tenant-creation default, or the client's own submitted choice.
 *
 * An explicit valid submission always wins, even if it differs from the
 * tenant default -- the operator is deliberately choosing an exception for
 * this one client. Anything else falls back to the tenant default so
 * creating a client without touching the field still records a real,
 * explicit mode rather than an implicit one.
 */
export function resolveNewClientMode(
  submitted: unknown,
  tenantDefault: InvoiceDeliveryMode,
): InvoiceDeliveryMode {
  return parseInvoiceDeliveryMode(submitted) ?? tenantDefault;
}

/**
 * Why hosted send must refuse for this client, or null when it may proceed.
 *
 * ONE canonical string per mode, shared by the route guard (the actual
 * enforcement) and every page that describes the mode to an operator --
 * so a later reword of the enforcement text cannot drift from what the
 * client-edit and invoice pages tell someone about the same mode.
 */
export function hostedSendDenialReason(mode: InvoiceDeliveryMode): string | null {
  if (mode === 'hosted') return null;
  if (mode === 'disabled') return 'Invoice email delivery is disabled for this business.';
  return "This client sends invoices from your mail app, not HourChit's hosted email. Use \"Send with your mail app\" instead.";
}
