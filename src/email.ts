/**
 * Cloudflare Email Routing entry point.
 *
 * Addresses are <tenant>@hosted.hourchit.app, one Worker per tenant, so this
 * handler's job is to confirm the mail is for THIS tenant, store it, and stop.
 * It deliberately does not classify, parse bookings, or send anything: inbound
 * mail is unauthenticated input and may only ever create a record.
 */
import type { Env } from './env';
import { tenantFromAddress } from './domain/inbound';
import { parseRaw, storeInbound } from './inbox';

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  const hosted = env.HOSTED_MAIL_DOMAIN ?? 'hosted.hourchit.app';
  const tenant = tenantFromAddress(message.to, hosted);

  // Wrong tenant, or an address on some other domain entirely. Reject rather
  // than silently accept: a message we do not store must not look delivered.
  if (tenant === null || tenant !== env.TENANT_PROFILE) {
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
