/**
 * Cloudflare Email Routing entry point.
 *
 * Addresses are <mailbox>@<tenant>.hourchit.app -- one Worker per tenant, one
 * DOMAIN per tenant -- so this handler's job is to confirm the mail is for this
 * tenant's domain, store it, and stop.
 * It deliberately does not classify, parse bookings, or send anything: inbound
 * mail is unauthenticated input and may only ever create a record.
 */
import type { Env } from './env';
import { mailboxFor } from './domain/inbound';
import { parseRaw, storeInbound } from './inbox';

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  // No default. A guessed mail domain would either reject this tenant's real
  // mail or, worse, accept another tenant's.
  const domain = env.TENANT_MAIL_DOMAIN;
  const mailbox = domain ? mailboxFor(message.to, domain) : null;

  // Not this tenant's domain. Reject rather than silently accept: a message we
  // do not store must not look delivered to the sender.
  if (mailbox === null) {
    message.setReject(`No mailbox for ${message.to}`);
    return;
  }

  const raw = await new Response(message.raw).arrayBuffer();
  const email = await parseRaw(raw);

  // Stored BEFORE returning. Cloudflare treats a clean return as accepted, so
  // acknowledging first and writing later would lose mail the sender believes
  // was delivered.
  await storeInbound(env, email, { transport: 'cf-email-routing', rawBytes: raw });
}
