# SPEC — Email handling and published calendar

Status: **draft for review**, not started. Written 2026-07-29.

## Why this exists

Matt's A/V Solutions LLC has one customer, The University of Bridgeport, and the
University will not be given a client portal. Bookings, changes, and
cancellations arrive by **email** from two named people, and invoices go out by
email to two other named people. So the coordination surface is a mailbox, not a
login, and HourChit has to be the thing that reads and writes it.

Matthew still gets a portal — his own. Inbound mail lands there, and his
calendar subscribes to what he confirms.

Contacts come from the executed SOW, and the two roles are deliberately
separate:

| Role | People | SOW clause |
|---|---|---|
| Booking and cancellation | Deb Ryan, Trina Henderson | 2.5 |
| Accounts payable | Stephen Giambra, Craig Schuelke | 5.2 |

An invoice sent to a booking contact is misaddressed, and a cancellation from an
AP clerk is not a cancellation. The model must know the difference.

## What this changes about the product

Two of HourChit's founding assumptions stop holding, and both belong in
`SECURITY.md` before any of this ships.

**1. There is now an unauthenticated write path.** Today every route is behind
one shared token and the app fails closed. Inbound email is, by construction,
input from the open internet that nobody authenticated. It must therefore never
mutate billable state directly. Inbound mail may only ever create a **draft** or
a **message**; a human promotes it.

**2. There is now a URL that is its own credential.** A subscribed calendar
cannot send an `Authorization` header, so the iCal feed is a capability URL: the
token is in the path. Anyone holding it can read event titles, times, and
locations. That is acceptable for this data, but it must be rotatable and it
must be stated plainly rather than discovered later.

## Transport is pluggable

The one hard requirement: **no email provider is baked in.** Three transports
must be interchangeable by configuration.

```ts
// One message shape. Transports differ in delivery, not in meaning.
interface OutboundMessage {
  to: Address[]; replyTo?: Address;
  subject: string; text: string; html?: string;
  attachments?: Attachment[];          // invoice PDFs
  idempotencyKey: string;              // a retry must not double-send
}

interface MailSender {
  readonly id: 'cf-send-email' | 'api' | 'smtp';
  send(msg: OutboundMessage): Promise<SendResult>;
  /** Recipients this transport can legally reach. See the CF caveat below. */
  canReach(addr: Address): boolean;
}

interface InboundMessage {
  messageId: string; inReplyTo?: string; references: string[];
  from: Address; to: Address[]; subject: string;
  text: string; receivedAt: string; raw: ArrayBuffer;
}
```

Inbound arrives two ways and the difference is structural, not cosmetic:

- **Push** — CF Email Routing invokes the Worker's `email()` handler, or a
  provider POSTs a webhook. Near-instant. Webhooks must be signature-verified.
- **Pull** — a cron trigger polls IMAP. Latency is the cron interval.

### The three transports, honestly

| Transport | Inbound | Outbound | Where it hurts |
|---|---|---|---|
| **CF Email Routing** | Email Workers `email()` handler. Native, free, no polling. | `send_email` binding | **The binding can only send to verified destination addresses.** That makes it correct for operator mail to Bryce and useless for invoicing a university. This matches the standing rule that operator mail goes via CF and client-facing mail does not. |
| **API (ZeptoMail)** | Provider inbound webhook | HTTPS `fetch` | The chosen client-facing vendor. Needs a verified sending domain. See the ZeptoMail section below — it cannot build arbitrary MIME, which constrains calendar invites. |
| **IMAP / SMTP** | Cron + `connect()` from `cloudflare:sockets` | Same | Workers have TCP sockets, so this is *possible*, but it is the most fragile of the three: hand-rolled protocol handling, STARTTLS negotiation, no mature edge-compatible client library, and polling latency. Support it because the interface demands it, but do not make it the default. |

**Default:** CF Email Routing inbound (free, push, no polling) + **ZeptoMail**
outbound. The abstraction exists so this pairing is a config choice, not a
rewrite.

### ZeptoMail specifics

ZeptoMail is the house standard for client-facing transactional mail and
**Resend is deprecated** — it was retired after an API key scoped to one sending
domain silently 403'd every send from another. That history is the reason for
the ntfy rule below.

Credentials already exist in coffer and are not to be re-minted:

- `communications/zeptomail-token` — the **complete** `Authorization` header
  value, already carrying the `Zoho-enczapikey ` prefix. Do **not** prefix it
  again; that is the classic way this integration fails.
- `communications/zeptomail-smtp-password` — a *different* secret from the API
  token. SMTP username is the literal string `emailapikey`.

Two prerequisites before a single invoice can go to the University:

1. **A verified sending domain for the LLC.** ZeptoMail needs a Mail Agent with
   domain verification plus DKIM and SPF records. Bryce controls DNS, so this is
   work, not a blocker — but the domain must exist first.
2. **Confirm production access to arbitrary recipients.** As last recorded, the
   ZeptoMail account's ability to send to arbitrary external addresses was
   *pending verification*, and the existing token was send-scope-only. Verify
   against the live dashboard before relying on it; a sandbox-limited account
   will deliver to Bryce and silently fail to a bridgeport.edu address, which is
   exactly the failure this project cannot afford.

**Standing rule, non-negotiable:** any email failure that is caught and logged
MUST also fire ntfy. A swallowed send is indistinguishable from a delivered one,
and an invoice nobody knows failed is an invoice nobody chases.

### Sending identity

Invoices must come from the **company's own domain**, not from `hourchit.app`.
An invoice arriving at a university finance office from a third-party app domain
reads as spam and aligns SPF/DKIM/DMARC to the wrong party. `mattsavsolutions.com`
is recommended and available; the LLC currently owns no domain, so this is a
prerequisite, not a detail.

## Inbound: parse to a draft, never to a fact

Pipeline:

1. **Accept** — mail addressed to the tenant's ingest address only.
2. **Identify** — match `From` against known contacts. Unknown sender still
   lands as a message; it just cannot produce a draft.
3. **Thread** — `Message-ID` / `In-Reply-To` / `References` into a thread, keyed
   to the customer.
4. **Classify** — booking request, change, cancellation, or other.
5. **Extract** — date, start time, duration, location, event name, with a
   confidence score.
6. **Draft** — create a `booking_draft` linked to the message. Never a booking.
7. **Surface** — thread and draft appear in Matthew's portal for approval.

**Cancellations never auto-apply, at any confidence.** A confirmed weekend
booking carries a four-hour minimum under SOW 3.3, and MSA 1.6(b) makes a
cancellation after departure fully payable. A parser that silently drops a
booking destroys a billing record whose value is real money. Approval is
mandatory, and the raw message is retained as the evidence of what was actually
said.

The same reasoning applies to the verbal-notice path in SOW 3.4: when Deb or
Trina cancels by phone, Matthew records it and HourChit sends the confirming
email that the SOW makes the record. That outbound confirmation is a first-class
feature, not an afterthought.

Low-confidence extraction is not an error. It degrades to "a message you should
read", which is exactly what the system does today with no parser at all.

## Outbound

- **Invoices** — PDF to the AP contacts, `Reply-To` the company. Idempotent:
  re-sending invoice *n* must not produce two emails.
- **Change-order confirmations** — acknowledge a change agreed by email or
  phone, quoting what was understood, per SOW 3.4.
- **Booking confirmations** — MSA 1.4 makes a booking binding on written
  confirmation, so this is the clause the feature implements.

Every outbound message is written to the same thread store as inbound, so the
portal shows one conversation rather than two half-conversations.

## Calendar: emailed invites AND a subscription feed

These are not alternatives. They fail in opposite directions, which is why both
are specified.

### Emailed `.ics` — the push half

When a booking is confirmed, HourChit emails Matthew the event as an `.ics`
attachment. This is the answer to subscription lag: it arrives immediately, and
on iOS an `.ics` attachment offers "Add to Calendar" straight from Mail.

**Constraint, verified against ZeptoMail's API docs:** the send API accepts
attachments with a custom `mime_type`, but exposes only `htmlbody`/`textbody`
and **cannot build a raw MIME body or a `multipart/alternative` part.** The
inline Accept/Decline invitation UI that Gmail and Apple Mail render requires a
`text/calendar; method=REQUEST` alternative part, so over the ZeptoMail **API**
the event will arrive as an attachment, not a native invitation.

That is acceptable, and arguably correct: Matthew does not need to RSVP to his
own bookings. The organiser/attendee machinery exists for inviting other people.
So use **`METHOD:PUBLISH`**, and treat the attachment as a delivery mechanism
rather than an invitation.

If a true invitation is ever wanted — inviting a *client* to an event — the path
is ZeptoMail over **SMTP** instead of the API, where the MIME structure is ours
to build. Same vendor, same domain, same DKIM. This is the first concrete
payoff of making transport pluggable rather than hard-coding one client.

**What emailed `.ics` does badly:** updates and cancellations. A moved booking
sends a second file, and whether the client merges it by `UID` + `SEQUENCE` or
creates a duplicate varies. A cancellation is worse — there is no reliable way
to make an already-added event disappear from a mailed attachment. Given a
cancelled weekend booking is a four-hour minimum under SOW 3.3, a calendar that
quietly keeps showing it is a real problem.

### Subscription feed — the correct half

`GET /cal/:token.ics` → `text/calendar`, no session, token in path.

- One `VEVENT` per **confirmed** booking. Drafts never appear — a calendar that
  shows unapproved guesses is worse than no calendar.
- Stable `UID` per booking so edits update rather than duplicate.
- Cancelled bookings emit `STATUS:CANCELLED` rather than vanishing, so
  subscribers actually remove them.
- Advertise `X-PUBLISHED-TTL` and `REFRESH-INTERVAL`.

**Set expectations on "auto update":** subscription is *pull*. Apple Calendar
refreshes on its own schedule and can lag well behind the advertised TTL, and
iOS is worse than macOS. Nothing in the implementation fixes that — which is
precisely why the emailed `.ics` exists. **The invite is the push; the feed is
the truth.** New booking lands on his phone in seconds via email; the feed is
what stays correct through moves and cancellations, and what he re-subscribes to
on a new phone or after deleting an invite. Neither alone is sufficient.

Token lives in D1, rotatable from the portal; rotating invalidates the old URL
and he re-subscribes.

## Data model (D1)

```
contacts        id, customer_id, name, email, role('booking'|'ap'), active
threads         id, customer_id, subject, last_message_at
messages        id, thread_id, direction, message_id, in_reply_to, from, to,
                subject, body_text, raw_r2_key, received_at, transport
bookings        id, customer_id, starts_at, ends_at, location, title,
                status('confirmed'|'cancelled'), ical_uid, min_callout_hours
booking_drafts  id, message_id, proposed(json), confidence,
                kind('create'|'change'|'cancel'), resolved_at, resolved_by
cal_tokens      token, created_at, revoked_at
```

Raw MIME to **R2**, not D1 — a D1 row is the wrong place for a multi-megabyte
attachment, and the raw copy is what proves what a contact actually wrote.

## Build order

1. Transport interfaces + CF Email Routing inbound + ZeptoMail outbound. Store
   and display threads. **No parsing.** This alone replaces the mailbox.
2. iCal feed over manually-entered bookings, plus emailed `.ics` on confirm.
3. Invoice send from existing invoice rendering.
4. Classifier and extractor producing drafts, cancellations approval-only.
5. SMTP transport, which both proves the abstraction holds and unlocks true
   `METHOD:REQUEST` invitations if they are ever wanted.

Stages 1–3 are useful shipped alone, which is the point of the ordering.

## Open questions

- Domain for the LLC — blocks outbound sending identity.
- Does this live in the public core repo or the private tenant repo? Generic
  capability in core, contacts and addresses in tenant config, matches the
  existing split — but email in a public product is a bigger commitment than
  the README currently claims the project makes.
- Retention for raw MIME. Business records argue for keeping it; a mailbox that
  never forgets is also a liability.
