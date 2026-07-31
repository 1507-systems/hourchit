# HourChit — next phase plan

Written 2026-07-31, after the session that shipped emailed-code login, inbound
body capture, billing increments, the conditional minimum call-out, persisted
invoice lines, outbound recording, the mail view, the two-column dashboard,
client management, the apex hub Worker, and the Zoho WorkDrive grant.

This plan sequences what is left. It is ordered by **dependency**, not by
appetite: several items look independent and are not.

---

## Sequencing rationale

Three couplings drive the order, and getting them wrong means rework.

**Terms before agreements.** An amendment is a new *version of terms*, so the
SOW/amendment tooling cannot be built before terms are versioned with effective
dates. Settings must land first.

**Effective dates before anything bills differently.** Persisted invoice lines
(PR #7) already protect invoices *already issued*. What is still unprotected is
work performed but not yet invoiced when a rate changes. Until terms carry
effective dates, changing a rate silently reprices that gap.

**Sender identity before invoices go to real clients.** The anti-phishing
property that makes an invoice get paid is that it comes from the tenant's own
domain, matching the letterhead. That is the "selfmail" question. Sending
client-facing invoices from `hosted.hourchit.app` works technically and is
weaker commercially.

---

## Phase 0 — unblockers (Bryce, not code)

These gate later phases and none of them are large. Listed first so they can be
done whenever there is a spare five minutes.

| # | Item | Blocks |
|---|---|---|
| 0.1 | **Answer "selfmail"**: tenant-sends-as-own-domain, or operator-notification path? | Phase 3's sender identity |
| 0.2 | **GitHub App consent** for Workers Builds on the 1507-systems org | Phase 5 CD |
| 0.3 | **Time Machine**: check share headroom on BShaCore before the in-flight 1.43 TB run spends 44 hours failing | Nothing here, but it is p1 on its own |

Phase 0.1 is the only one that blocks *code*.

---

## Phase 1 — Settings pane, with effective-dated terms

**Why first:** everything commercial hangs off it, and it is the last thing
standing between matts-av and a deployable tenant.

Billing terms currently live in `profiles/<key>.json`, validated at load,
deliberately not defaulted. Moving them into a form means the numbers that
decide what a client owes become editable by anyone signed in. That is
acceptable — it is the operator's own business — but it changes two things:

1. **Terms must be versioned with an effective date**, not overwritten. A rate
   change mid-engagement must not reprice work already performed. The profile
   supplies the *initial* version; the settings pane appends new ones.
2. **The conditional minimum must survive the round trip.** `minimumCallOutMinutes`
   accepts a number *or* `{weekday, weekend}`; a form that flattens that back to
   a single number would silently break Matt's A/V SOW 3.3.

### Work
- `term_versions` table: tenant-scoped, `effective_from`, the full settings
  payload, and who/when it was recorded.
- Resolution: given an instant, return the term version in force. Invoicing and
  the dashboard read *through* this rather than off the profile.
- Settings UI: rates, increment, minimum (flat or split), timezone, mileage
  rate and billable flag, invoice prefix.
- Guard: refuse an effective date that would retroactively change an
  already-invoiced period. Say so plainly rather than silently clamping.

### Acceptance
Changing a rate with a future effective date leaves existing unbilled work
priced at the old rate until that date, and an already-issued invoice is
untouched. `matts-av` loads without the profile-validation error.

---

## Phase 2 — WorkDrive filing

**Why here:** the grant, the folder tree and the client records all exist now.
It is the smallest remaining piece with a real payoff, and it is what makes
Tarnsby a faithful rehearsal of Matthew's setup.

State: HourChit has its own Zoho OAuth client, refresh token vaulted, scopes
READ + CREATE + `teamfolders.READ` (no delete, no update). The JD tree is
mirrored into `Client Data / Matts AV Solutions LLC` and all 82 files uploaded.

### Work
- **Tenant-root folder is TENANT config**, not the `customers.workdrive_folder_id`
  column added in migration 0007. Both levels are real: the tenant root, and a
  per-customer folder under `Clients/`. The column is right; it needs a
  tenant-level setting beside it.
- Token refresh: exchange the vaulted refresh token for an access token, cache
  it for its lifetime, never log it.
- File inbound attachments to the right JD category. `attachments.filed_at`
  already encodes "received but not filed"; filing is a separate retryable step
  and must never cause inbound mail to be rejected.
- `file_error` gets the real reason, so a stuck file is diagnosable without
  re-running anything.

### Watch out
- Uploads are `POST /workdrive/api/v1/upload`, multipart with `filename`,
  `parent_id`, `content`. Reads want `Accept: application/vnd.api+json` — a
  request without it returns HTTP 415, which looks like a permissions problem
  and is not.
- **`MAIL_RAW` should be standard for every tenant**, not just Tarnsby. The
  absence of that binding is what made the first inbound body loss
  unrecoverable rather than merely annoying.

---

## Phase 3 — Invoice send, and delivery status

**Depends on:** Phase 0.1 (sender identity) for the commercial property; can be
built before it and re-pointed.

### 3a. Send button
- Confirm naming **recipient address and total** — precisely what is wrong when
  it is wrong.
- **Attach the invoice; do not send a bare link.** An emailed link to a
  financial document is the shape of invoice fraud, and AP staff are trained to
  report exactly that. A hosted link may supplement, never replace, and must
  never require a login.
- **Mark sent only on success.** Today it flips unconditionally.
- **Keep "Mark sent" as a separate action** for invoices delivered by other
  means. Two buttons, not one with a mode flag.
- **Warn on resend**, showing when and to whom it already went. A duplicate
  invoice at AP risks a double payment, or more often a hold measured in weeks.
  Possible, never accidental.

**Open before building:** HourChit renders HTML, not PDF. Producing a PDF
attachment in a Worker needs a mechanism — Cloudflare's Browser Rendering is the
likely candidate but is **unverified**; check before designing around it.

### 3b. Delivery status
Cloudflare publishes six outbound events — `delivered`, `deferred`, `bounced`,
`failed`, `rejected`, `complained` — subscribable via Queues, each carrying the
`messageId`, the recipient server's `smtpStatusCode` and its literal
`smtpResponse`. `sendMail()` already returns that Message-ID and `storeOutbound()`
already stores it, so matching is a join.

- **`deferred` is NOT a failure.** It means retries are pending. Rendering it as
  failed would push the operator into exactly the duplicate-send this phase
  guards against.
- **`rejected` means the suppression list blocked it** — a prior hard bounce or
  complaint. The fix is address hygiene, not a retry, and the UI should say so.
- Store status **history**, not just latest. "Deferred 09:02, delivered 09:41"
  plus the server's own words is what settles a dispute with a client's IT.
- Surface on the invoice *and* in the mail thread.

**Read tracking is out of scope and should stay out.** There is no honest open
tracking without a pixel, and a pixel no longer works — Apple Mail Privacy
Protection pre-fetches images, so opens register whether or not a human looked.

---

## Phase 4 — Agreements: terms record, generation, amendments

**Depends on:** Phase 1. An amendment is a chain of term versions.

Decided 2026-07-31: **the structured terms are the record; a document is a
rendering of them.** HourChit never stores-and-reparses a PDF, because it never
needs to read one back — it regenerates from the record.

- Instruments have states: **draft → issued → executed**. An executed instrument
  is immutable.
- Changing terms on an executed engagement produces a **new instrument** — an
  amendment or a superseding SOW — generated for signature and linked to what it
  amends. The app must **refuse** to rewrite an executed document and offer the
  amendment path instead.
- Output follows the invoice pattern: server-rendered HTML, print-to-PDF,
  emailable. No document library in a Worker.
- Separate pipeline from `~/dev/matts-av-llc/build/gen.py`, which is Python
  producing DOCX for Matt's A/V specifically and is **not** being ported.

---

## Phase 5 — CD and hygiene

Not glamorous, and the standing rule says merged must mean live. Every deploy
tonight was by hand.

- **Workers Builds** once 0.2 lands: root `tenants/<key>`, build
  `../../scripts/ci-build.sh`, deploy `../../scripts/ci-deploy.sh`. The
  auto-issued build token has **no D1 permission**, so migrations stay a
  deliberate manual step. Re-probe the `/builds/` endpoints with the vaulted
  `cloudflare/hourchit-workers-ci` token after consent — they returned 12000
  "not found" only because no git provider was connected.
- **`MAIL_RAW` for every tenant.**
- **Zoho Self Client cleanup**: one shared Self Client is the blast radius for
  every integration built on it. Give each its own named client, migrate the
  refresh tokens, then narrow or retire it.
- **Google Maps distance provider**: `ai/google-maps` already exists in coffer,
  and `src/domain/mileage.ts` already has the `DistanceProvider` seam. This
  replaces the hand-entered 27.3 miles in the matts-av profile.

---

## Deferred, deliberately

- **Private repos for HourChit client data.** Filed, p3, explicitly deferred by
  Bryce until the SNAFUs are fixed. The sharpest objection to record: PII in git
  history is effectively permanent, so a client deletion request becomes a
  history rewrite rather than a `DELETE`.
- **Read tracking.** See Phase 3b.

---

## How to execute

Bryce's standing preference is subagent-driven execution for plan work. The
phases above are ordered by dependency and each has its own acceptance
criteria, so they parallelise badly *within* a phase and cleanly *across*
Phase 2 and Phase 3a, which touch different files.

The one habit worth keeping from tonight, because it caught three real defects
that unit tests did not: **pin Tarnsby to the unmerged branch, prove the change
against real data, then merge and move the pin.** A test tenant that carries
unmerged work is worth more than one that mirrors main.
