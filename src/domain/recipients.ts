/**
 * Who lands on To, CC, and BCC for each kind of outbound message.
 *
 * Pure: takes the contacts already loaded for a customer and returns an
 * envelope. No database, no network, so the routing rules are testable without
 * either.
 *
 * The rule that is easy to get wrong: everyone else holding the same role is
 * CC'd, not dropped. Where an agreement lets *either* of two named people bind
 * the client, a confirmation only one of them sees leaves the client's own left
 * hand uninformed -- and the argument that follows is one the operator has to
 * win on records. Copying the role costs nothing and prevents exactly that.
 */

export type Role = 'booking' | 'ap' | 'signatory';

export type MessageKind =
  | 'invoice'
  | 'booking_confirmation'
  | 'cancellation_confirmation'
  | 'change_order';

export interface ContactRef {
  id: number;
  name: string;
  email: string;
  active: number;
  roles: { role: Role; is_primary: number }[];
}

export interface Envelope {
  to: ContactRef[];
  cc: ContactRef[];
  bcc: string[];
}

/** Which role each kind of message is addressed to. */
const ROLE_FOR_KIND: Record<MessageKind, Role> = {
  invoice: 'ap',
  booking_confirmation: 'booking',
  cancellation_confirmation: 'booking',
  change_order: 'booking',
};

export interface ResolveOptions {
  /**
   * The contact who prompted this message -- the person who actually asked for
   * the booking or sent the cancellation. They go on To even if they are not
   * the primary, because replying to somebody other than the person who wrote
   * to you is how a thread gets lost.
   */
  triggeredBy?: number;
  /** Operator's own address. BCC'd on everything; see below. */
  operatorEmail?: string;
  /** One-off addresses for this send that are not, and need not become, contacts. */
  extraCc?: string[];
}

export function resolveRecipients(
  kind: MessageKind,
  contacts: ContactRef[],
  opts: ResolveOptions = {},
): Envelope {
  const role = ROLE_FOR_KIND[kind];

  // Inactive contacts never receive mail. They are retained so that historic
  // messages still resolve to a person, not so that we keep writing to someone
  // who has left the organisation.
  const inRole = contacts.filter(
    (c) => c.active === 1 && c.roles.some((r) => r.role === role),
  );

  const isTrigger = (c: ContactRef) => opts.triggeredBy !== undefined && c.id === opts.triggeredBy;
  const isPrimary = (c: ContactRef) =>
    c.roles.some((r) => r.role === role && r.is_primary === 1);

  // The person who prompted the message wins over the configured primary. If
  // nobody prompted it -- an invoice, say -- fall back to the primary, and if
  // no primary is set, address the whole role rather than silently sending to
  // nobody.
  let to = inRole.filter(isTrigger);
  if (to.length === 0) to = inRole.filter(isPrimary);
  if (to.length === 0) to = inRole;

  const toIds = new Set(to.map((c) => c.id));
  const cc = inRole.filter((c) => !toIds.has(c.id));

  const bcc: string[] = [];
  // The operator is BCC'd on everything: he keeps a copy in his own mail without
  // the client seeing a self-addressed message, so the record survives even if
  // the application does not.
  if (opts.operatorEmail) bcc.push(opts.operatorEmail);

  return { to, cc, bcc };
}

/**
 * True when a kind of message cannot be sent because nobody holds the role.
 * Callers should surface this before composing rather than sending to an empty
 * To line -- most transports accept that and deliver to nobody.
 */
export function missingRecipients(env: Envelope): boolean {
  return env.to.length === 0;
}
