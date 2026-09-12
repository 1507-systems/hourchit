/**
 * Inbound email logic: addressing, sender attribution, and threading.
 *
 * Pure. No database, no network, no MIME parsing. Every decision that can be
 * wrong in a way that matters lives here, so it can be tested without standing
 * up a mail path.
 */

/** Extract the bare address from a From/To value that may carry a display name. */
export function bareAddress(value: string): string {
  const angled = value.match(/<([^>]+)>/);
  const raw = angled ? angled[1] : value;
  return raw.trim().toLowerCase();
}

/** Split a header that may hold several comma-separated addresses. */
export function addressList(value: string | null | undefined): string[] {
  if (!value) return [];
  // Commas inside a quoted display name must not split the list.
  const parts: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ',' && !inQuotes) {
      parts.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts.map(bareAddress).filter((a) => a.includes('@'));
}

/**
 * Which MAILBOX on this tenant's own mail domain an address names.
 *
 * Returns the local part -- "billing", "hello" -- or null if the address is not
 * on this tenant's domain at all. Null means REJECT: with one Worker per tenant
 * and a domain per tenant, mail for another domain arriving here is either a
 * misconfigured routing rule or someone probing, and neither should be stored.
 *
 * This replaces tenantFromAddress, which split the tenant out of the LOCAL PART
 * of a shared `hosted.hourchit.app`. Now the domain carries the identity, so
 * the local part is free to mean what it does everywhere else: which mailbox.
 *
 * Subaddressing is stripped. Cloudflare delivers `billing+anything@` to the
 * `billing@` rule, and the suffix is context rather than identity.
 */
export function mailboxFor(address: string, tenantMailDomain: string): string | null {
  const addr = bareAddress(address);
  const at = addr.lastIndexOf('@');
  if (at < 0) return null;
  if (addr.slice(at + 1) !== tenantMailDomain.trim().toLowerCase()) return null;
  const mailbox = addr.slice(0, at).split('+')[0].trim();
  return mailbox.length > 0 ? mailbox : null;
}

/**
 * Strip reply and forward prefixes to get a stable grouping key.
 *
 * Needed because plenty of mail clients drop References and In-Reply-To, and
 * without this a five-message exchange becomes five unrelated threads. Handles
 * repeated and localised prefixes ("Re:", "RE:", "Fwd:", "FW:", "Re[2]:").
 */
export function subjectKey(subject: string): string {
  let s = (subject || '').trim();
  const prefix = /^(re|res|fw|fwd|aw|antw|sv|vs|tr)(\[\d+\])?\s*:\s*/i;
  // Loop: "Re: Fwd: Re: x" is common and one pass is not enough.
  for (let i = 0; i < 10; i += 1) {
    const next = s.replace(prefix, '');
    if (next === s) break;
    s = next.trim();
  }
  return s.replace(/\s+/g, ' ').toLowerCase();
}

/** Parse a References header into individual message ids, oldest first. */
export function parseReferences(value: string | null | undefined): string[] {
  if (!value) return [];
  return (value.match(/<[^>]+>/g) || []).map((s) => s.trim());
}

export interface ThreadCandidate {
  id: number;
  customer_id: number | null;
  subject_key: string;
}

export interface ThreadMatchInput {
  inReplyTo?: string | null;
  references?: string | null;
  subject: string;
  customerId: number | null;
  /** Threads already known, and the message ids seen in each. */
  knownMessageThread: Map<string, number>;
  candidatesBySubject: ThreadCandidate[];
}

/**
 * Decide which thread a message joins, or null to start a new one.
 *
 * Order matters and is deliberate: explicit references beat subject matching,
 * because a subject line is a guess and In-Reply-To is a statement.
 */
export function matchThread(input: ThreadMatchInput): number | null {
  // 1. In-Reply-To is the strongest signal.
  if (input.inReplyTo) {
    const hit = input.knownMessageThread.get(input.inReplyTo.trim());
    if (hit !== undefined) return hit;
  }
  // 2. Then References, newest first -- the last entry is the nearest ancestor.
  const refs = parseReferences(input.references);
  for (let i = refs.length - 1; i >= 0; i -= 1) {
    const hit = input.knownMessageThread.get(refs[i]);
    if (hit !== undefined) return hit;
  }
  // 3. Fall back to subject, but ONLY within the same customer. Two clients can
  //    both send "Invoice question" and they are not the same conversation.
  const key = subjectKey(input.subject);
  if (key.length === 0) return null;
  const match = input.candidatesBySubject.find(
    (c) => c.subject_key === key && c.customer_id === input.customerId,
  );
  return match ? match.id : null;
}

export interface SenderResolution {
  contactId: number | null;
  customerId: number | null;
}

/**
 * Attribute an inbound message to a contact, and through them to a customer.
 *
 * Matches DEACTIVATED contacts too. A cancellation sent in March by somebody who
 * left in June must still be attributable to them -- that attribution is the
 * evidence the cancellation was valid.
 */
export function resolveSender(
  fromAddress: string,
  contacts: { id: number; customer_id: number; email: string }[],
): SenderResolution {
  const addr = bareAddress(fromAddress);
  const hit = contacts.find((c) => c.email.trim().toLowerCase() === addr);
  return hit
    ? { contactId: hit.id, customerId: hit.customer_id }
    : { contactId: null, customerId: null };
}
