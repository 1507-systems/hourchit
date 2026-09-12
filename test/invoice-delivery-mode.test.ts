import { describe, expect, it } from 'vitest';
import {
  parseInvoiceDeliveryMode,
  resolveNewClientMode,
  type InvoiceDeliveryMode,
} from '../src/domain/invoice-delivery';

describe('parseInvoiceDeliveryMode', () => {
  it('accepts the three known modes', () => {
    expect(parseInvoiceDeliveryMode('hosted')).toBe('hosted');
    expect(parseInvoiceDeliveryMode('disabled')).toBe('disabled');
    expect(parseInvoiceDeliveryMode('mail_app')).toBe('mail_app');
  });

  it('rejects anything else, including near-misses and empty input', () => {
    expect(parseInvoiceDeliveryMode('email')).toBeNull();
    expect(parseInvoiceDeliveryMode('Hosted')).toBeNull();
    expect(parseInvoiceDeliveryMode('')).toBeNull();
    expect(parseInvoiceDeliveryMode(undefined)).toBeNull();
    expect(parseInvoiceDeliveryMode(null)).toBeNull();
  });
});

describe('resolveNewClientMode', () => {
  const tenantDefault: InvoiceDeliveryMode = 'hosted';

  it('falls back to the tenant default when nothing valid was submitted', () => {
    expect(resolveNewClientMode(undefined, tenantDefault)).toBe('hosted');
    expect(resolveNewClientMode('', tenantDefault)).toBe('hosted');
    expect(resolveNewClientMode('bogus', tenantDefault)).toBe('hosted');
  });

  it('an explicit valid submission wins even when it differs from the default', () => {
    expect(resolveNewClientMode('disabled', 'hosted')).toBe('disabled');
    expect(resolveNewClientMode('mail_app', 'disabled')).toBe('mail_app');
  });
});
