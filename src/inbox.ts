/**
 * Storage for inbound mail. Thin over D1 + R2; every judgement call lives in
 * domain/inbound.ts and is tested there.
 */
import PostalMime, { type Email } from 'postal-mime';
import type { Env } from './env';
import { resolveBodyText } from './domain/htmltext';
import {
  addressList,
  bareAddress,
  matchThread,
  resolveSender,
  subjectKey,
  type ThreadCandidate,
} from './domain/inbound';

export interface StoredMessage {
  messageRowId: number;
  threadId: number;
  duplicate: boolean;
}

/** Parse raw RFC822 into the fields we persist. */
export async function parseRaw(raw: ArrayBuffer | Uint8Array | string): Promise<Email> {
  return PostalMime.parse(raw as never);
}

/**
 * Persist one inbound message.
 *
 * Idempotent on Message-ID. Cloudflare's delivery guarantee is at-least-once, so
 * the same mail can arrive twice; the unique index means the second attempt is a
 * no-op instead of a duplicate thread entry.
 */
export async function storeInbound(
  env: Env,
  email: Email,
  opts: { transport: string; rawBytes?: ArrayBuffer } = { transport: 'cf-email-routing' },
): Promise<StoredMessage> {
  const db = env.DB;
  const messageId = email.messageId ? email.messageId.trim() : null;

  if (messageId) {
    const existing = await db
      .prepare('SELECT id, thread_id FROM messages WHERE message_id = ?')
      .bind(messageId)
      .first<{ id: number; thread_id: number }>();
    if (existing) {
      return { messageRowId: existing.id, threadId: existing.thread_id, duplicate: true };
    }
  }

  const fromAddr = bareAddress(email.from?.address ?? '');

  // Deactivated contacts are included on purpose -- see resolveSender.
  const contacts = await db
    .prepare('SELECT id, customer_id, email FROM contacts')
    .all<{ id: number; customer_id: number; email: string }>();
  const { contactId, customerId } = resolveSender(fromAddr, contacts.results ?? []);

  const subject = email.subject ?? '';
  const key = subjectKey(subject);

  // Only the ids we might thread against, not every message ever received.
  const refIds = [
    email.inReplyTo?.trim(),
    ...(email.references ? email.references.match(/<[^>]+>/g) ?? [] : []),
  ].filter((v): v is string => !!v);

  const knownMessageThread = new Map<string, number>();
  if (refIds.length > 0) {
    const placeholders = refIds.map(() => '?').join(',');
    const rows = await db
      .prepare(`SELECT message_id, thread_id FROM messages WHERE message_id IN (${placeholders})`)
      .bind(...refIds)
      .all<{ message_id: string; thread_id: number }>();
    for (const r of rows.results ?? []) knownMessageThread.set(r.message_id, r.thread_id);
  }

  let candidatesBySubject: ThreadCandidate[] = [];
  if (key.length > 0) {
    const rows = await db
      .prepare(
        `SELECT id, customer_id, subject_key FROM threads
         WHERE subject_key = ? AND customer_id IS ${customerId === null ? 'NULL' : '?'}
         ORDER BY last_message_at DESC LIMIT 20`,
      )
      .bind(...(customerId === null ? [key] : [key, customerId]))
      .all<ThreadCandidate>();
    candidatesBySubject = rows.results ?? [];
  }

  let threadId = matchThread({
    inReplyTo: email.inReplyTo ?? null,
    references: email.references ?? null,
    subject,
    customerId,
    knownMessageThread,
    candidatesBySubject,
  });

  if (threadId === null) {
    const created = await db
      .prepare(
        `INSERT INTO threads (customer_id, subject, subject_key, last_message_at)
         VALUES (?, ?, ?, datetime('now')) RETURNING id`,
      )
      .bind(customerId, subject, key)
      .first<{ id: number }>();
    threadId = created!.id;
  } else {
    await db
      .prepare("UPDATE threads SET last_message_at = datetime('now') WHERE id = ?")
      .bind(threadId)
      .run();
  }

  // The raw copy is the evidence of what a contact actually wrote. Stored before
  // the row so a message row never claims a raw key that does not exist.
  let rawKey: string | null = null;
  if (opts.rawBytes && env.MAIL_RAW) {
    rawKey = `raw/${threadId}/${crypto.randomUUID()}.eml`;
    await env.MAIL_RAW.put(rawKey, opts.rawBytes);
  }

  const body = resolveBodyText(email.text, email.html);

  const inserted = await db
    .prepare(
      `INSERT INTO messages
        (thread_id, direction, message_id, in_reply_to, references_raw,
         from_addr, to_addrs, cc_addrs, subject, body_text, body_html,
         body_is_derived, contact_id, raw_r2_key, transport)
       VALUES (?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      threadId,
      messageId,
      email.inReplyTo ?? null,
      email.references ?? '',
      fromAddr,
      JSON.stringify(addressList((email.to ?? []).map((t) => t.address).join(','))),
      JSON.stringify(addressList((email.cc ?? []).map((t) => t.address).join(','))),
      subject,
      // A phone reply is usually HTML and nothing else. Preferring text/plain
      // but falling back to a rendering of the HTML is what keeps the body from
      // being silently empty; body_is_derived records which one this was.
      body.bodyText,
      email.html ?? '',
      body.derived ? 1 : 0,
      contactId,
      rawKey,
      opts.transport,
    )
    .first<{ id: number }>();

  const messageRowId = inserted!.id;

  for (const att of email.attachments ?? []) {
    const bytes =
      att.content instanceof ArrayBuffer
        ? att.content.byteLength
        : typeof att.content === 'string'
          ? att.content.length
          : 0;
    let r2Key: string | null = null;
    if (env.MAIL_RAW && att.content instanceof ArrayBuffer) {
      r2Key = `att/${messageRowId}/${att.filename || 'attachment'}`;
      await env.MAIL_RAW.put(r2Key, att.content);
    }
    // filed_at is left NULL: filing to the client document store is a separate
    // retryable step, and a document-store outage must not reject the email.
    await env.DB.prepare(
      `INSERT INTO attachments (message_id, filename, mime_type, bytes, direction, r2_key)
       VALUES (?, ?, ?, ?, 'inbound', ?)`,
    )
      .bind(messageRowId, att.filename ?? '', att.mimeType ?? 'application/octet-stream', bytes, r2Key)
      .run();
  }

  return { messageRowId, threadId, duplicate: false };
}

/**
 * Record a message WE sent, in the same table as inbound.
 *
 * Until this existed, outbound was invisible to the system: a client replying
 * to an invoice put our Message-ID in their In-Reply-To, we had never seen that
 * id, and the reply fell through to subject matching -- which breaks the moment
 * anybody edits a subject line. For a system whose job is to show what was
 * agreed and when, a broken reply chain is an evidentiary hole, not a display
 * nuisance.
 *
 * Stored AFTER a successful send, deliberately. A row claiming we sent
 * something we did not is worse than no row: it would read, later, as proof of
 * a notice that never left.
 */
/**
 * The thread an outbound message we initiate belongs in.
 *
 * Inbound mail threads itself off In-Reply-To and References; a message WE send
 * first has neither, so it needs somewhere to live before the client has
 * replied. Matching on subject key and customer means a reply lands back in the
 * same thread -- storeInbound will match the Message-ID we recorded, and even
 * if the client's mailer strips it, the subject key still finds this thread.
 *
 * Each invoice therefore gets its own conversation, because each carries its
 * own number in the subject. That is the right grain: "what was said about
 * invoice 0008" is the question actually asked later, not "everything ever
 * discussed with this client".
 */
export async function openOutboundThread(
  env: Env,
  customerId: number | null,
  subject: string,
): Promise<number> {
  const key = subjectKey(subject);
  if (key.length > 0) {
    const existing = await env.DB.prepare(
      `SELECT id FROM threads
        WHERE subject_key = ? AND customer_id IS ${customerId === null ? 'NULL' : '?'}
        ORDER BY last_message_at DESC LIMIT 1`,
    )
      .bind(...(customerId === null ? [key] : [key, customerId]))
      .first<{ id: number }>();
    if (existing) return existing.id;
  }

  const created = await env.DB.prepare(
    `INSERT INTO threads (customer_id, subject, subject_key, last_message_at)
     VALUES (?, ?, ?, datetime('now')) RETURNING id`,
  )
    .bind(customerId, subject, key)
    .first<{ id: number }>();
  return created!.id;
}

export async function storeOutbound(
  env: Env,
  msg: {
    threadId: number;
    messageId: string | null;
    inReplyTo: string | null;
    references: string;
    fromAddr: string;
    toAddrs: string[];
    subject: string;
    bodyText: string;
  },
  transport = 'cf-email-sending',
): Promise<number> {
  const inserted = await env.DB.prepare(
    `INSERT INTO messages
       (thread_id, direction, message_id, in_reply_to, references_raw,
        from_addr, to_addrs, cc_addrs, subject, body_text, body_html,
        body_is_derived, contact_id, raw_r2_key, transport)
     VALUES (?, 'outbound', ?, ?, ?, ?, ?, '[]', ?, ?, '', 0, NULL, NULL, ?)
     RETURNING id`,
  )
    .bind(
      msg.threadId,
      msg.messageId,
      msg.inReplyTo,
      msg.references,
      msg.fromAddr,
      JSON.stringify(msg.toAddrs),
      msg.subject,
      msg.bodyText,
      transport,
    )
    .first<{ id: number }>();

  await env.DB.prepare("UPDATE threads SET last_message_at = datetime('now') WHERE id = ?")
    .bind(msg.threadId)
    .run();

  return inserted!.id;
}

/** Threads newest first, with a message count, for the mail list. */
export async function listThreads(env: Env, limit = 50) {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.subject, t.customer_id, t.last_message_at,
            COUNT(m.id) AS message_count,
            SUM(CASE WHEN m.direction = 'inbound' THEN 1 ELSE 0 END) AS inbound_count
       FROM threads t LEFT JOIN messages m ON m.thread_id = t.id
      GROUP BY t.id
      ORDER BY t.last_message_at DESC
      LIMIT ?`,
  )
    .bind(limit)
    .all<{
      id: number;
      subject: string;
      customer_id: number | null;
      last_message_at: string;
      message_count: number;
      inbound_count: number;
    }>();
  return results ?? [];
}

/** One thread's messages oldest first, plus attachment counts. */
export async function threadMessages(env: Env, threadId: number) {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.direction, m.message_id, m.from_addr, m.to_addrs, m.subject,
            m.body_text, m.body_is_derived, m.received_at, m.references_raw,
            (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS attachment_count
       FROM messages m WHERE m.thread_id = ? ORDER BY m.id`,
  )
    .bind(threadId)
    .all<{
      id: number;
      direction: string;
      message_id: string | null;
      from_addr: string;
      to_addrs: string;
      subject: string;
      body_text: string;
      body_is_derived: number;
      received_at: string;
      references_raw: string;
      attachment_count: number;
    }>();
  return results ?? [];
}

export async function getThread(env: Env, threadId: number) {
  return env.DB.prepare('SELECT * FROM threads WHERE id = ?')
    .bind(threadId)
    .first<{ id: number; subject: string; customer_id: number | null }>();
}
