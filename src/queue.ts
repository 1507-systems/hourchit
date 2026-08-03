import type { Env } from './env';
import { parseDeliveryEvent, supersedes } from './domain/delivery';

/**
 * Queue consumer for Cloudflare Email Sending delivery events.
 *
 * Subscribed to ONE sending domain, which for a hosted tenant is that tenant's
 * own subdomain. That is why isolation here is structural rather than a filter:
 * a subscription scoped to tarnsby.hourchit.app cannot carry another tenant's
 * recipients, so there is no filtering code that could be wrong, and no way for
 * one client's billing addresses to appear in another's database.
 *
 * EVERY MESSAGE IS ACKED, including ones we could not parse. A consumer that
 * retries an unrecognised payload retries it forever, and Cloudflare owns this
 * schema -- a field they add must not wedge a tenant's queue. Anything
 * unreadable is still stored raw, which is the point of keeping the raw copy.
 */
export async function handleQueue(
  batch: { messages: Array<{ body: unknown; ack(): void; retry(): void }> },
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await recordEvent(env, msg.body);
    } catch (e) {
      // Storing the event failed, which is a D1 problem rather than a payload
      // problem, so this one IS worth retrying.
      console.error('delivery event not stored, retrying:', (e as Error).message);
      msg.retry();
      continue;
    }
    msg.ack();
  }
}

async function recordEvent(env: Env, body: unknown): Promise<void> {
  const raw = JSON.stringify(body ?? null);
  const ev = parseDeliveryEvent(body);

  if (!ev) {
    // Unrecognised, but kept. A payload we failed to understand is still
    // evidence, and the alternative is discovering months later that a whole
    // class of event was silently dropped.
    await env.DB.prepare(
      `INSERT INTO mail_delivery_events (message_id, event_type, raw) VALUES ('', 'unparsed', ?)`,
    )
      .bind(raw)
      .run();
    return;
  }

  await env.DB.prepare(
    `INSERT INTO mail_delivery_events
       (message_id, event_type, recipient, terminal, smtp_code, smtp_response,
        provider, occurred_at, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ev.messageId,
      ev.type,
      ev.recipient,
      ev.terminal ? 1 : 0,
      ev.smtpCode,
      ev.smtpResponse,
      ev.provider,
      ev.occurredAt,
      raw,
    )
    .run();

  // Update the cached status on the message, but only if this event actually
  // supersedes what is there. Queue delivery is at-least-once and unordered, so
  // a late 'deferred' must not walk an invoice back from delivered to in-flight
  // and send the operator chasing a client who already has it.
  const current = await env.DB.prepare(
    `SELECT delivery_status, delivery_at FROM messages WHERE message_id = ?`,
  )
    .bind(ev.messageId)
    .first<{ delivery_status: string; delivery_at: string | null }>();

  if (!current) return; // An event for a message this tenant did not send.

  const currentTerminal = ['delivered', 'bounced', 'failed', 'rejected', 'complained'].includes(
    current.delivery_status,
  );
  const shouldReplace = supersedes(ev, current.delivery_status
    ? { terminal: currentTerminal, occurredAt: current.delivery_at ?? '' }
    : null);

  if (!shouldReplace) return;

  await env.DB.prepare(
    `UPDATE messages SET delivery_status = ?, delivery_at = ?, delivery_detail = ?
      WHERE message_id = ?`,
  )
    .bind(
      ev.type,
      ev.occurredAt,
      // The receiving server's own words, kept verbatim: a bounce reason is the
      // difference between a wrong address and a full mailbox, and any
      // paraphrase loses exactly the part worth reading.
      [ev.smtpCode, ev.smtpResponse].filter(Boolean).join(' ').slice(0, 500),
      ev.messageId,
    )
    .run();
}
