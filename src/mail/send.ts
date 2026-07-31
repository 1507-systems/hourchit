/**
 * Outbound mail.
 *
 * ONE concrete connector behind a single module, deliberately. The pluggable
 * MailSender interface is wanted but deferred until the send modes have shown
 * what the interface actually needs -- an interface shaped around the first
 * provider is worse than no interface, because it looks finished.
 *
 * The transport is Cloudflare Email Sending, reached through the `send_email`
 * Worker binding. Two constraints from Cloudflare's docs drive everything here:
 *
 *   - "The sender address must always belong to a domain you have onboarded to
 *     Email Service." So `from` is configuration, never user input.
 *   - Sending to a VERIFIED DESTINATION address is free on any plan and does
 *     not touch the monthly quota or the daily limit, "including when only
 *     Email Routing is configured". A login code goes to the operator, who is
 *     exactly such an address, so OTP costs nothing and needs no onboarded
 *     sending domain.
 *
 * Worth knowing when debugging: mail sent from a Worker via this binding shows
 * up in the Email Routing summary as DROPPED even when it was delivered. Use
 * the Email Sending metrics instead, or the absence of a thrown error here.
 */

/**
 * Structural type for the binding rather than an import.
 *
 * @cloudflare/workers-types has carried more than one shape for this binding as
 * Email Service moved through beta, and pinning to whichever one is installed
 * today makes a routine types bump a compile break. What we actually depend on
 * is one method with four fields.
 */
export interface SendEmailBinding {
  send(message: {
    to: string;
    from: string;
    subject: string;
    text?: string;
    html?: string;
    /**
     * Threading and other RFC headers. Cloudflare documents In-Reply-To and
     * References here, which is what lets a reply we send land in the same
     * thread in the client's mail app rather than starting a new one.
     */
    headers?: Record<string, string>;
  }): Promise<{ messageId?: string } | void>;
}

export interface OutboundMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Message-ID being replied to, if any. Sets In-Reply-To and seeds References. */
  inReplyTo?: string | null;
  /** Existing References chain, oldest first, space separated. */
  references?: string | null;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super('Outbound mail is not configured: the EMAIL binding or LOGIN_MAIL_FROM is missing.');
    this.name = 'MailNotConfiguredError';
  }
}

/**
 * Send one message, or throw.
 *
 * Throwing rather than returning false is deliberate: every caller so far is a
 * flow where the user is waiting on the mail (a login code), and a silent
 * failure there presents as "the code never arrived" with nothing in the logs
 * to say why.
 */
export async function sendMail(
  binding: SendEmailBinding | undefined,
  from: string | undefined,
  msg: OutboundMessage,
): Promise<{ messageId: string | null }> {
  if (!binding || !from) throw new MailNotConfiguredError();

  const headers = threadingHeaders(msg);
  const result = await binding.send({
    to: msg.to,
    from,
    subject: msg.subject,
    text: msg.text,
    ...(msg.html ? { html: msg.html } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  });

  // The binding reports the Message-ID it assigned. Recording it is what lets
  // the recipient's REPLY thread back to this message: their client will put
  // this id in In-Reply-To, and storeInbound matches on ids it has seen.
  const messageId =
    result && typeof result === 'object' && typeof result.messageId === 'string'
      ? result.messageId
      : null;
  return { messageId };
}

/**
 * In-Reply-To and References for a reply.
 *
 * References accumulates the whole chain, oldest first, because that is what
 * mail clients walk to group a conversation; In-Reply-To names only the direct
 * parent. Capped at 100 entries, which is the point Cloudflare rejects a reply
 * to prevent loops -- keeping the NEWEST is right, since those are the ones a
 * client actually matches against.
 */
export function threadingHeaders(msg: OutboundMessage): Record<string, string> {
  if (!msg.inReplyTo) return {};
  const prior = (msg.references ?? '').match(/<[^>]+>/g) ?? [];
  const chain = [...prior, msg.inReplyTo].filter((id, i, all) => all.indexOf(id) === i);
  const capped = chain.slice(-100);
  return { 'In-Reply-To': msg.inReplyTo, References: capped.join(' ') };
}

/**
 * The login-code email.
 *
 * Plain text carries the code because that is what survives every client, and
 * the code is repeated in the subject so it can be read from a lock-screen
 * notification without opening anything. There is deliberately NO link: a
 * one-time code that is also a clickable magic link is a code that can be
 * phished into a forwarded email, and the operator logs in from a phone where
 * typing six digits is easier than trusting a link anyway.
 */
export function loginCodeMessage(to: string, code: string, businessName: string): OutboundMessage {
  return {
    to,
    subject: `${code} is your ${businessName} sign-in code`,
    text: [
      `Your ${businessName} sign-in code is:`,
      ``,
      `    ${code}`,
      ``,
      `It expires in 10 minutes and can only be used once.`,
      ``,
      `If you did not try to sign in, you can ignore this email. Nobody can`,
      `get in with this code alone, and it will expire on its own.`,
    ].join('\n'),
  };
}
