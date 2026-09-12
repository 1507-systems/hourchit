/**
 * Cloudflare Email Sending delivery events.
 *
 * WHAT THESE ARE AND ARE NOT. Cloudflare publishes six outbound lifecycle
 * events to a Queue: delivered, deferred, bounced, failed, rejected,
 * complained. They report what the RECEIVING MAIL SERVER did. That is a fact.
 *
 * They do NOT report whether a person read anything, and nothing here should
 * ever be presented as though they did. The usual way to fake that is a
 * tracking pixel, which answers the question badly in both directions: Apple
 * Mail Privacy Protection prefetches remote images for every message whether or
 * not anyone opened it, so a pixel reports "read" for mail nobody looked at,
 * while corporate gateways strip images entirely, so it reports nothing for
 * mail that WAS read. On an invoice it is also a beacon in a client's inbox.
 */

export type DeliveryEventType =
  | 'delivered'
  | 'deferred'
  | 'bounced'
  | 'failed'
  | 'rejected'
  | 'complained';

const KNOWN: DeliveryEventType[] = [
  'delivered',
  'deferred',
  'bounced',
  'failed',
  'rejected',
  'complained',
];

export interface DeliveryEvent {
  type: DeliveryEventType;
  messageId: string;
  recipient: string;
  subject: string;
  terminal: boolean;
  smtpCode: string;
  smtpResponse: string;
  provider: string;
  occurredAt: string;
}

/**
 * Read one queue message into a DeliveryEvent, or null if it is not one.
 *
 * TOLERANT ON PURPOSE. This parses a payload shape owned by someone else, on a
 * queue we do not control, and a consumer that throws on an unexpected field
 * retries the batch forever. Returning null lets the caller record the raw
 * event and move on -- the raw copy is kept precisely so a payload we failed to
 * understand is still recoverable later.
 */
export function parseDeliveryEvent(body: unknown): DeliveryEvent | null {
  if (typeof body !== 'object' || body === null) return null;
  const ev = body as Record<string, unknown>;

  // "cf.email.sending.message.delivered" -> "delivered"
  const rawType = typeof ev.type === 'string' ? ev.type : '';
  const tail = rawType.split('.').pop() ?? '';
  const type = KNOWN.find((k) => k === tail);
  if (!type) return null;

  const payload = (ev.payload ?? {}) as Record<string, unknown>;
  const delivery = (payload.delivery ?? {}) as Record<string, unknown>;
  const metadata = (ev.metadata ?? {}) as Record<string, unknown>;

  const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';
  if (!messageId) return null; // Nothing to join back to; useless as an event.

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');

  return {
    type,
    messageId,
    recipient: str(payload.recipient),
    subject: str(payload.subject),
    terminal: payload.terminal === true,
    // Cloudflare documents smtpStatusCode as a STRING ("250"), not a number.
    smtpCode: str(delivery.smtpStatusCode),
    smtpResponse: str(delivery.smtpResponse),
    provider: str(delivery.provider),
    occurredAt: str(metadata.eventTimestamp),
  };
}

/**
 * Whether a new event should replace the status already recorded.
 *
 * ORDER IS NOT GUARANTEED. Queue delivery is at-least-once and events can
 * arrive out of sequence, so a late 'deferred' must not overwrite the
 * 'delivered' that followed it -- an invoice would go from arrived back to
 * in-flight and the operator would chase a client who already has it.
 *
 * TERMINAL WINS. Cloudflare marks the final word for a recipient; once one
 * arrives, only another terminal event may replace it. Among non-terminal
 * events the newest wins, which is the best available answer while in flight.
 */
export function supersedes(
  incoming: { terminal: boolean; occurredAt: string },
  current: { terminal: boolean; occurredAt: string } | null,
): boolean {
  if (!current) return true;
  if (current.terminal && !incoming.terminal) return false;
  if (incoming.terminal && !current.terminal) return true;
  // Same terminality: newest wins. Missing timestamps sort earliest, so an
  // event with no timestamp never displaces one that has a real time.
  return incoming.occurredAt >= current.occurredAt;
}

/**
 * How a delivery state should read to an operator.
 *
 * The words are chosen to be TRUE rather than reassuring. "Delivered" says the
 * mail server accepted it, and the description says exactly that, because an
 * operator who reads "delivered" as "they have seen it" will not chase an
 * invoice that is sitting unread.
 */
export function describeDelivery(status: string): { label: string; detail: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
  switch (status) {
    case 'delivered':
      return {
        label: 'Delivered',
        detail: "Their mail server accepted it. That is not the same as anyone having read it.",
        tone: 'ok',
      };
    case 'deferred':
      return {
        label: 'Deferred',
        detail: 'Temporarily refused and still being retried. Usually resolves on its own.',
        tone: 'warn',
      };
    case 'bounced':
      return {
        label: 'Bounced',
        detail: 'Permanently refused. Check the address before sending again.',
        tone: 'bad',
      };
    case 'failed':
      return { label: 'Failed', detail: 'Could not be delivered.', tone: 'bad' };
    case 'rejected':
      return {
        label: 'Rejected',
        detail: 'Refused before it left. Often a policy or reputation block.',
        tone: 'bad',
      };
    case 'complained':
      return {
        label: 'Marked as spam',
        detail: 'The recipient reported it. Do not send to this address again without asking.',
        tone: 'bad',
      };
    default:
      return {
        label: 'Sent',
        detail: 'Handed to the mail provider. No delivery report yet.',
        tone: 'muted',
      };
  }
}
