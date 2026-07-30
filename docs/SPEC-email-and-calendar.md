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

## Transport: one seam now, the abstraction later

The pluggable send interface **is wanted**, and it is **deliberately deferred**.
Building three transports before one of them has ever delivered an invoice is how
an abstraction ends up shaped around guesses instead of use.

So: ship the concrete Resend path first, and keep every send behind **one module**
with the message shape below as its argument. That is the seam. Introducing
`MailSender` later is then a rename and an extra implementation, not a rewrite --
and by that point the three modes above will have told us what the interface
actually needs.

The shapes are specified now because they constrain the schema, which is harder
to change than code.

```ts
// One message shape. Transports differ in delivery, not in meaning.
interface OutboundMessage {
  to: Address[]; cc?: Address[]; bcc?: Address[];   // all three, all multi
  replyTo?: Address;
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
| **Cloudflare Email Service** | Email Routing `email()` handler. Native, free, unlimited, no polling. | Email Sending: REST API, Workers binding, **or SMTP** | **The default, and the whole stack.** Verified-destinations-only applies *before* a sending domain is onboarded; after onboarding, sends go to any recipient. Needs Workers Paid. |
| **API (Resend)** | Provider inbound webhook | HTTPS `fetch` | Fallback, and the escape hatch if Cloudflare deliverability ever disappoints. Keeps the connector honest by being a second implementation. |
| **Tenant-supplied SMTP** | n/a | Tenant's own SMTP account | For a tenant who already has mail infrastructure and wants their own identity. |

**Default: Cloudflare end to end.** Email Routing in, Email Sending out. One
vendor, one config surface, no third-party API key to rotate or leak.

Numbers, from Cloudflare's published pricing: inbound is **unlimited and free**;
outbound includes **3,000 emails per month** on Workers Paid, then $0.35 per
1,000. A one-person service business sends a few dozen invoices and confirmations
a month, so outbound is effectively free and stays that way for a long time.

Sends to verified destination addresses are free on any plan and do not count
against the quota, which conveniently means **operator mail costs nothing** and
the existing rule that operator mail goes via Cloudflare is unchanged.

**Prerequisite: Workers Paid.** Arbitrary-recipient sending is not available on
the free plan.

Two further reasons this beat the alternative, both of which remove problems the
spec previously had to work around:

- **SMTP is offered natively.** The calendar section below needed SMTP for a true
  `METHOD:REQUEST` invitation, because transactional HTTP APIs generally cannot
  build a `multipart/alternative`. Cloudflare provides SMTP alongside the REST
  API and Workers binding, so that stops being a reason to add a second vendor.
- **A suppression list is built in**, and sends it blocks do not count toward the
  quota. Hard bounces are handled by the platform rather than by us discovering
  them.

### Addressing and sending identity

Every hosted tenant gets an address on a dedicated subdomain:

```
<tenant>@hosted.hourchit.app      e.g. mattsav@hosted.hourchit.app
```

That single address does double duty: **CF Email Routing delivers inbound to it**,
and it is also the **From** for that tenant's outbound. One address, one mental
model, and no DNS work asked of a tenant who may not own a domain at all.

`hosted.hourchit.app` is deliberately a subdomain rather than the apex. Tenant
mail is high-volume and machine-generated; keeping it off `hourchit.app` means a
tenant's deliverability reputation cannot damage HourChit's own.

Three sending modes, in order of preference:

| Mode | From | Credentials | When |
|---|---|---|---|
| **Send-as-a-service** (default) | `<tenant>@hosted.hourchit.app` | Cloudflare Email Sending | Any new tenant. Zero setup. |
| **Tenant's own domain** | tenant's verified domain | onboarded to Cloudflare, or the tenant's own provider key | Tenant wants their own identity and reputation |
| **Tenant's own SMTP** | tenant's domain | tenant's SMTP account | Tenant already has mail infrastructure |

**A tenant's own domain remains RECOMMENDED, just not required.** An invoice from
the vendor's own domain is what a finance office expects, and it aligns SPF, DKIM
and DMARC to the party actually being paid. Say so when onboarding. But it is
guidance, not a gate — a business with no domain must be able to start today and
upgrade later without migrating anything.

**HourChit's own** mail — tenant onboarding, system notices, operator alerts —
also goes through Cloudflare, from a distinct identity on `hourchit.app` rather
than `hosted.hourchit.app`, so the two reputations stay independent. Operator
mail to a verified destination is free and outside the quota.

**Standing rule, non-negotiable:** any email failure that is caught and logged
MUST also fire ntfy. A swallowed send is indistinguishable from a delivered one,
and an invoice nobody knows failed is an invoice nobody chases. This is not
theoretical: an API key scoped to the wrong sending domain once 403'd every
operator notification for weeks while the code logged and moved on.

## Contacts are data, not configuration

The two roles above cannot live in a config file. People leave, get promoted, and
go on holiday, and when Deb hands scheduling to somebody else Matthew must be
able to fix it himself at 7pm without a deploy. So contacts are a managed table
with a screen: add, edit, deactivate, change role.

**Deactivate, never delete.** A cancellation email from Deb in March must still
resolve to Deb in December, after she has left. Deleting the row orphans the
evidence that a booking was validly cancelled — which, given MSA 1.6(b), is the
record that decides whether an evening gets paid.

One person can hold more than one role. Deb Ryan is both a §2.5 booking contact
and the signatory on the SOW, and that is normal rather than a modelling error.

### Recipient policy: who lands on To, CC, and BCC

Every outbound kind resolves its recipients from the contact list at send time,
rather than hard-coding "invoices go to AP". The resolved set is shown before
sending and can be overridden per message.

| Kind | To | CC | BCC |
|---|---|---|---|
| Invoice | AP contacts marked primary | remaining AP contacts | Matthew |
| Booking confirmation | the contact who requested it | other booking contacts | Matthew |
| Cancellation confirmation | the contact who cancelled | other booking contacts | Matthew |
| Change order | booking contacts | — | Matthew |

Two deliberate choices in that table:

**BCC to Matthew on everything.** He gets a copy in his own mail without the
customer seeing a self-addressed message, so the record survives even if the app
does. This is the cheap insurance against HourChit being the only place a sent
invoice exists.

**Other contacts in the role are CC'd, not omitted.** SOW 2.5 says *either* Deb
or Trina may bind the University. If Trina cancels and Deb never sees the
confirmation, the University's own left hand is uninformed and the dispute that
follows is one Matthew has to win with records. Copying the role costs nothing.

Addresses that are not contacts can still be added ad hoc per send — a one-off
CC to a procurement officer should not require creating a permanent contact.

## Files belong in the dashboard

The setup memo tells Matthew to collect a specific pile of paper from the
University: a conflict-of-interest policy or disclosure form, a vendor onboarding
packet, a W-9 request, their insurance requirements, purchase orders. It also
tells him that anything agreed verbally should be followed up in writing. Those
documents arrive as email attachments, and a system that stores the covering
message but drops the attachment has kept the least useful half.

So the dashboard gets a **Files** view: every attachment, inbound and outbound,
listed with the customer, the thread it arrived on, who sent it, and when.
Outbound invoice PDFs land in the same place, so "what exactly did we send them
in March" is one query rather than an archaeology exercise.

This is also what makes the no-portal decision tenable. The University does not
get a login, so the documents flow through email — and email is only a filing
system if something is actually filing.

### Where the bytes live: WorkDrive, not R2

Client documents go to **Zoho WorkDrive, into that client's own folder**, not
into R2. Matthew already has WorkDrive, already has the app on his phone, and
already has a folder per client. Filing into it means the documents are his —
readable, searchable, and shareable from the phone without HourChit being
involved, and still there if HourChit is not.

R2 keeps one thing WorkDrive should not have: the **raw MIME** of each message.
That is an internal evidence artifact, not a document anyone browses, and it
exists to prove what a contact actually wrote.

| Artifact | Home | Why |
|---|---|---|
| Client documents, invoice PDFs, inbound attachments | WorkDrive, per-client folder | Matthew's, phone-accessible, outlives the app |
| Raw MIME | R2 | Evidence, not a document; nobody browses it |
| Metadata, threads, index | D1 | Queryable |

**This needs a WorkDrive scope HourChit does not have, and that is a real
decision rather than a detail.** The existing WorkDrive integration lives in
`client-portal` and is deliberately `WorkDrive.files.READ` and nothing else —
it displays a document tree and must never write. HourChit files documents, so
it needs `READ` plus `CREATE`. These are **separate OAuth grants for separate
applications**, so this does not reverse the portal's decision; the portal stays
read-only and should. But HourChit's grant must be scoped just as deliberately:
create and read, no DELETE, no `.ALL`. An integration that files executed
agreements should not be able to remove them.

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

**Constraint on any HTTP-API transport.** The inline Accept/Decline invitation
UI that Gmail and Apple Mail render requires a `text/calendar; method=REQUEST`
part inside a `multipart/alternative`. Transactional-email APIs generally expose
`text` and `html` bodies plus file attachments, and not arbitrary MIME structure
— which was verified for one provider and should be **verified for Resend before
relying on it**, not assumed either way.

If the API can only attach, the event arrives as an `.ics` attachment rather than
a native invitation. That is acceptable, and arguably correct here: Matthew does
not need to RSVP to his own bookings. The organiser/attendee machinery exists for
inviting other people. So use **`METHOD:PUBLISH`** and treat the attachment as a
delivery mechanism rather than an invitation.

If a true invitation is ever wanted — inviting a *client* to an event — the path
is **SMTP**, where the MIME structure is ours to build. Cloudflare offers SMTP
alongside the REST API and the Workers binding, so this no longer means adding a
vendor: it is the same product, a different door.

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
contacts        id, customer_id, name, email, title, phone, active,
                created_at, deactivated_at
contact_roles   contact_id, role('booking'|'ap'|'signatory'), is_primary
                -- many-to-many: Deb is both a booking contact and the signatory
threads         id, customer_id, subject, last_message_at
messages        id, thread_id, direction, message_id, in_reply_to,
                from_addr, to_addrs(json), cc_addrs(json), bcc_addrs(json),
                subject, body_text, raw_r2_key, received_at, transport,
                send_status, send_error, idempotency_key
attachments     id, message_id, filename, mime_type, bytes, direction,
                workdrive_file_id, workdrive_folder_id, filed_at, file_error,
                created_at
                -- filed_at NULL means "received but not yet in WorkDrive".
                -- Filing is a separate, retryable step: a WorkDrive outage
                -- must not reject the email that carried the document.
bookings        id, customer_id, starts_at, ends_at, location, title,
                status('confirmed'|'cancelled'), ical_uid, sequence,
                min_callout_hours
booking_drafts  id, message_id, proposed(json), confidence,
                kind('create'|'change'|'cancel'), resolved_at, resolved_by
cal_tokens      token, created_at, revoked_at
```

Notes on three of those:

- **`contact_roles` is a separate table, not a column.** One person holds several
  roles, and a single `role` field forces a duplicate row per role — which then
  drifts when an address changes.
- **Raw MIME and attachment bytes go to R2**, never D1. A D1 row is the wrong
  home for a multi-megabyte PDF, and the raw copy is what proves what a contact
  actually wrote.
- **`send_status` / `send_error` / `idempotency_key` on messages** are what make
  outbound a production path rather than a fire-and-hope. Every send is
  recorded before it is attempted, so a failure is a row you can see and retry
  rather than an absence you never notice.

## Production, not a demo

The failure this system cannot have is a silent one. An invoice that never
arrived looks exactly like an invoice nobody has paid yet.

- **No swallowed failures.** Every caught send error writes `send_error` AND
  fires ntfy. This is the house rule, and it exists because a Resend key scoped
  to the wrong domain 403'd every operator notification for weeks while the code
  logged and moved on.
- **Idempotent sends.** Invoice *n* has one idempotency key. A retry, a double
  click, or a queue redelivery must not produce two invoices at a university's
  accounts payable.
- **Inbound is acknowledged only after it is stored.** Losing an email because
  the write failed after the 250 OK is unrecoverable — the sender believes it
  was delivered.
- **A visible outbox.** Queued, sent, failed, with the error and a retry button.
  If Matthew cannot see that Tuesday's invoice failed, the system has not told
  him anything.

## Build order

0. **Contacts + roles CRUD.** No external dependency, and everything downstream
   resolves recipients from it. Build it first because stage 1 needs it to know
   who an inbound sender is.
1. **Inbound**: transport interface + CF Email Routing. Store threads, messages,
   and attachments; render them in the dashboard with a Files view. **No
   parsing, no sending.** This alone replaces the mailbox.
2. **Outbound**: Cloudflare Email Sending from `<tenant>@hosted.hourchit.app`,
   recipient-policy resolution across To/CC/BCC, outbox with status and retry,
   ntfy on failure. Gated only on Workers Paid and onboarding the sending domain.
3. iCal feed over manually-entered bookings, plus emailed `.ics` on confirm.
4. Invoice send from the existing invoice rendering.
5. Classifier and extractor producing drafts; cancellations approval-only.
6. SMTP transport, which both proves the abstraction holds and unlocks true
   `METHOD:REQUEST` invitations if they are ever wanted.

Stages 0–2 are all unblocked now that sending identity is hourchit.app.
Contacts come first because everything downstream resolves against it.

## Open questions

- Domain for the LLC — blocks outbound sending identity.
- Does this live in the public core repo or the private tenant repo? Generic
  capability in core, contacts and addresses in tenant config, matches the
  existing split — but email in a public product is a bigger commitment than
  the README currently claims the project makes.
- Retention for raw MIME. Business records argue for keeping it; a mailbox that
  never forgets is also a liability.
