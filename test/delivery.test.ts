import { describe, expect, it } from 'vitest';
import { describeDelivery, parseDeliveryEvent, supersedes } from '../src/domain/delivery';

/** A payload in the shape Cloudflare documents. */
const DELIVERED = {
  type: 'cf.email.sending.message.delivered',
  source: { type: 'email.sending', zoneId: 'z1', domain: 'tarnsby.hourchit.app' },
  payload: {
    eventId: '0190d0c4-7e9a-7b3c-9f12-1a2b3c4d5e6f',
    messageId: '0101018f7d0c4d9a-msg-deadbeef',
    sender: 'invoices@tarnsby.hourchit.app',
    recipient: 'grandvale@bpsmail.net',
    subject: 'Invoice TBY-0008',
    terminal: true,
    delivery: {
      status: 'delivered',
      provider: 'gmail',
      deliveryTimeMs: 1234,
      smtpStatusCode: '250',
      smtpEnhancedStatusCode: '2.0.0',
      smtpResponse: '250 2.0.0 OK 1714820445 a1b2c3 - gsmtp',
    },
  },
  metadata: { eventTimestamp: '2026-07-31T02:48:57.132Z' },
};

describe('parseDeliveryEvent', () => {
  it('reads the documented payload', () => {
    const ev = parseDeliveryEvent(DELIVERED)!;
    expect(ev.type).toBe('delivered');
    expect(ev.messageId).toBe('0101018f7d0c4d9a-msg-deadbeef');
    expect(ev.recipient).toBe('grandvale@bpsmail.net');
    expect(ev.terminal).toBe(true);
    expect(ev.smtpCode).toBe('250');
    expect(ev.smtpResponse).toContain('gsmtp');
    expect(ev.occurredAt).toBe('2026-07-31T02:48:57.132Z');
  });

  it('takes the event name from the end of the dotted type', () => {
    for (const t of ['bounced', 'deferred', 'failed', 'rejected', 'complained']) {
      const ev = parseDeliveryEvent({ ...DELIVERED, type: `cf.email.sending.message.${t}` });
      expect(ev?.type).toBe(t);
    }
  });

  it('returns null rather than throwing on anything unexpected', () => {
    // This parses a payload shape somebody else owns, arriving on a queue we do
    // not control. A consumer that throws retries the batch forever.
    for (const junk of [null, undefined, 'a string', 42, {}, { type: 'cf.email.routing.forwarded' }]) {
      expect(parseDeliveryEvent(junk)).toBeNull();
    }
  });

  it('returns null when there is no messageId to join back to', () => {
    const noId = { ...DELIVERED, payload: { ...DELIVERED.payload, messageId: undefined } };
    expect(parseDeliveryEvent(noId)).toBeNull();
  });

  it('survives missing optional fields', () => {
    const sparse = {
      type: 'cf.email.sending.message.deferred',
      payload: { messageId: 'abc' },
    };
    const ev = parseDeliveryEvent(sparse)!;
    expect(ev.messageId).toBe('abc');
    expect(ev.recipient).toBe('');
    expect(ev.terminal).toBe(false);
    expect(ev.smtpCode).toBe('');
  });
});

describe('supersedes', () => {
  const at = (occurredAt: string, terminal = false) => ({ terminal, occurredAt });

  it('accepts the first event for a message', () => {
    expect(supersedes(at('2026-07-31T10:00:00Z'), null)).toBe(true);
  });

  it('does NOT let a late deferral walk back a delivery', () => {
    // The failure this prevents: queue delivery is at-least-once and unordered,
    // so a stale 'deferred' arriving after 'delivered' would move an invoice
    // from arrived back to in-flight, and the operator chases a client who
    // already has it.
    const delivered = at('2026-07-31T10:05:00Z', true);
    const lateDeferral = at('2026-07-31T10:00:00Z', false);
    expect(supersedes(lateDeferral, delivered)).toBe(false);
  });

  it('lets a terminal event replace a non-terminal one', () => {
    expect(supersedes(at('2026-07-31T10:05:00Z', true), at('2026-07-31T10:00:00Z'))).toBe(true);
  });

  it('lets a later terminal event replace an earlier one', () => {
    // A complaint after a delivery is real: they received it and reported it.
    expect(supersedes(at('2026-07-31T11:00:00Z', true), at('2026-07-31T10:00:00Z', true))).toBe(true);
  });

  it('takes the newest among non-terminal events', () => {
    expect(supersedes(at('2026-07-31T10:05:00Z'), at('2026-07-31T10:00:00Z'))).toBe(true);
    expect(supersedes(at('2026-07-31T09:55:00Z'), at('2026-07-31T10:00:00Z'))).toBe(false);
  });
});

describe('describeDelivery', () => {
  it('never claims delivery means somebody read it', () => {
    // An operator who reads "Delivered" as "they have seen it" stops chasing an
    // invoice that is sitting unread. The wording has to carry the distinction
    // because nothing else will.
    const d = describeDelivery('delivered');
    expect(d.label).toBe('Delivered');
    expect(d.detail).toMatch(/not the same as anyone having read it/);
  });

  it('distinguishes a deferral, which is still in flight, from a bounce', () => {
    expect(describeDelivery('deferred').tone).toBe('warn');
    expect(describeDelivery('deferred').detail).toMatch(/retried/);
    expect(describeDelivery('bounced').tone).toBe('bad');
  });

  it('says a complaint means stop, not retry', () => {
    expect(describeDelivery('complained').detail).toMatch(/Do not send to this address again/);
  });

  it('reports no report yet rather than inventing a status', () => {
    expect(describeDelivery('').label).toBe('Sent');
    expect(describeDelivery('').detail).toMatch(/No delivery report yet/);
  });
});
