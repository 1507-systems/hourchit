# Project log

Running history of decisions and significant changes. Newest first.

## 2026-09-19: Final audit — pending billing and manual send

Final feature branch rebased onto upstream privacy-policy commit `7572e71`.
Implementation commit: `2b0e3a1`.

- Documentation: README and SPEC describe the new controls and route contracts;
  implementation plan and this audit record retained in the repository.
- Functionality: **417 tests in 46 files pass** on local Node 26 and supported
  CI Node 22.12, run sequentially. Both TypeScript configurations pass.
- Build: Wrangler dry-run succeeds, 381.57 KiB (98.10 KiB gzip). No deployment.
- Browser: local Worker smoke checks cover saved display modes, separate rows,
  selection totals, selected-only invoices, remaining unbilled series entries,
  full rich/plain copy payloads, and explicit manual sent confirmation.
- Security: npm audit reports **0 vulnerabilities**. Parameterized queries,
  tenant-isolated settings/DB access, authentication, HTML escaping, input
  validation, stale selection rollback, and manual-confirmation races reviewed.
  No hardcoded secrets or unresolved TODO/FIXME markers found in application
  source; no tracked secret-file history found. Generated/private profiles remain
  excluded. Independent code review found no production blockers.
- Cleanup: removed obsolete per-task dashboard totals and their unused view data.
- Expected notices: Node22 SQLite experimental warning applies only to tests;
  non-security dependency updates are available but not part of this feature.
- Verification incident: simultaneously running two complete suites caused
  collisions in the pre-existing `profiles/zz-test.json` seed fixture. Confirmed
  the shared file in the test helper; rerunning suites sequentially passed all
  417 tests on each runtime. Do not run complete suites concurrently in one tree.

No outstanding functionality or security findings in the audited feature scope.
Live external-mail-client delivery and Cloudflare PDF rendering were not exercised:
no real customer email was sent. PDF success/error behavior is covered with the
binding test double; the actual invoice/PDF renderers and native composer are
unchanged from main. Release/deployment remains separate from this reviewed PR.
Share invoice is recorded as a Cortex fast follow (issue
`19febe3c-38a8-4559-90df-99e4f05548f6`).

## 2026-09-19: Pending billing selection and full browser manual sending

Implementation on `feat/billing-manual-send`; not yet deployed. Added tenant-level
pending display modes (task + description, task, description), separate attendance
rows, and checkbox invoice selection. Invoice and PDF layout are unchanged.
Selected totals reuse the invoice's historical rate and term calculation.
Invoice creation is now a guarded atomic D1 batch; stale/invalid selections fail
without partially saved invoices. Manual send now offers the full shared email
body (HTML/plain copy and manual fallback), subject-only mailto, PDF download
instructions, and explicit manual-send confirmation with concurrency protection.
Share invoice remains a fast follow.

Baseline: 378 tests passed. New tests run actual SQL against all migrations,
including partial-save rollback and concurrent selection/confirmation failures.
Feature verification before upstream rebase: 412 tests passed, both TypeScript
configs passed, Worker dry-run bundle passed (381.38 KiB / 98.01 KiB gzip), and
npm audit found zero vulnerabilities. Real Node 22.12 SQL tests passed (27 tests);
Vitest enables its SQLite flag for that supported runtime.

Browser smoke on fictional local D1 data verified tenant mode persistence,
separate rows, select/deselect totals, selective invoice creation, remaining
series entries unbilled, unchanged invoice presentation, rich/plain clipboard
payloads, unchanged draft state after copying, manual-send confirmation and
resend acknowledgement. Local PDF failure is explicit; success/error download
headers are integration-tested with a Browser binding stub. No real email sent.
The existing PDF rendering and native iOS mail composer were not live end-to-end
tested; their existing route/rendering tests continue to pass.

Independent review found no production blockers; its Node22 SQLite finding was
resolved and tested. Source secret/unfinished-marker scans were clean. Outdated
packages (Workers types, Node types, Hono, TypeScript, Vitest, Wrangler) are
available updates, not reported vulnerabilities; dependency versions remain
unchanged to avoid expanding this feature release. Upstream privacy-policy
changes were retained by rebasing onto current main before the final check.
Expected development notices: Node's SQLite adapter is experimental on older
supported Node releases; Wrangler 4.131.0 reports a newer 4.135.0 version. Neither
changes production runtime behavior. Sandbox localhost/log access required
approval for local Wrangler verification. Test data is fictional and local only.

## 2026-09-11: Per-client invoice delivery modes

Every client now stores an explicit invoice delivery mode -- `hosted`,
`disabled`, or `mail_app` -- with a tenant-wide default that seeds new clients
only; changing the default never rewrites an existing client. Migration 0015
assigns every existing client `hosted`, preserving prior behavior everywhere
except one tenant, whose default and one existing client were then
deliberately switched to `disabled` as a separate, explicit data change, not a
side effect of the migration.

Enforcement is fail-closed and lives in one place, shared by the invoice page
and both email routes: a disabled or mail_app client's hosted-send routes
return 403 regardless of what the page renders, and the check runs again
immediately before the send itself (after PDF rendering's real network round
trip), so a mode change mid-request still stops it.

**Mail app mode is a browser-only best effort, not a send.** A browser cannot
attach a file to a `mailto:` draft and cannot detect whether the operator
actually sent anything after it opens. The page hands over a PDF download and
a pre-filled draft, says so plainly, and only records the invoice as sent
after an explicit operator confirmation -- opening the draft is never treated
as sending. Invoice-email composition (recipient, subject, body, filename)
now lives in one shared module so hosted send and this handoff cannot drift
apart, which is also what the future native iOS bridge will consume instead
of reimplementing composition in Swift.

Shipped as core commit `19a3526`, 371 tests, both TypeScript configurations,
and zero npm vulnerabilities. Deployed and `/health`-verified on both current
tenants with schema `0015_invoice_delivery_modes.sql` live.

## 2026-09-10: GL charge codes and explicit canceled-hour disposition

Added an optional normalized GL charge code to both live and manual time entry,
while retaining the existing manual local date-and-time picker. Event
description remains required. Every source attendance now stays a separate
invoice line; an attendance crossing local midnight remains date-split so the
line dates and totals stay accurate.

Frozen invoice lines now retain the charge code. Web, print/PDF, and email
render time entries as two descriptive rows: `Service - M/D`, then
`Event description - Charge code`. When the optional code is blank, its hyphen
is omitted.

Cancellation now makes source disposition explicit. **Return hours to
unbilled** preserves the prior correction/reinvoice behavior. **Delete hours**
preserves both the canceled invoice and source entries for audit, timestamps the
source entries as void, and excludes them from all future unbilled work and
invoices. Nothing is physically deleted.

Dashboard module ordering and visibility were specified as server-side,
per-user preferences but deliberately deferred until this invoice workflow is
deployed and tested with the tenant.

### Audit run — 2026-09-10

Documentation was reconciled across `README.md`, the new root `SPEC.md`, this
log, and the approved design/implementation plan. The functionality pass ran
all 305 tests, both TypeScript configurations, a Worker bundle dry-run, and a
fresh D1 database migration through all 13 migrations. The only tooling finding
was Wrangler 4.131.0 being available over the locked 4.130.0; it was upgraded
and the complete gate was repeated.

The security pass found zero dependency vulnerabilities at moderate or higher
severity, no hard-coded credentials, no sensitive-file history, parameterized
SQL throughout the changed data path, authenticated application routes, and
HTML escaping for both operator-controlled invoice fields. The public health
route exposes only build/config/schema identifiers and readiness state. No
feature-specific security findings remain.

### Full audit complete — 2026-09-10

- Documentation: complete and reconciled with the implementation.
- Functionality: 306 tests passing, zero failing; TypeScript clean; Worker
  bundle dry-run successful; all 13 migrations applied successfully from a
  clean database.
- Security: zero npm vulnerabilities; credential/history scan clean; changed
  inputs normalized, SQL parameterized, output escaped, and routes protected.
- Cleanup: no unresolved production TODO/FIXME/HACK markers or debug output.
- Outstanding known issues: none for this release. The approved dashboard
  preference feature is intentionally a subsequent project, not an audit gap.

Independent review then identified a stale/concurrent cancellation race: a
second cancel request could observe the first request's generic `canceled`
status and apply a conflicting source disposition. The batch now changes source
rows only while the invoice remains draft/sent, performs the guarded status
transition last, and rejects a transition that affects no invoice. A regression
test pins statement order, guards, and the stale-transition error. Because this
was a post-audit fix, the complete functionality/security/functionality gate was
restarted before release.
That repeated gate completed cleanly: 306 tests twice, both TypeScript
configurations twice, the migration and bundle smokes, and a zero-vulnerability
dependency scan all passed in sequence.

## 2026-09-09: Event-specific, date-separated invoice lines

Renamed the configured service from **Event Management** to **Event Tech
Management**. Migration `0012_invoice_line_event_details.sql` updates existing
task names while deliberately leaving finalized invoice descriptions untouched.

Time-entry forms now require an event name (for example, “Awards Ceremony”)
for both running timers and manual entries. The value is normalized and stored
on the time entry, then snapshotted onto the invoice line with its local service
date. Invoice lines merge only when service, normalized event name, local work
date, hourly rate, and applicable client terms all match; work performed on a
different date remains a separate billable line. An attendance that crosses
local midnight is split between dates while its rounded/minimum billable total
is allocated only once. Each actual-date line is then a separate billable line
and rounds currency independently; hour quantities render with enough precision
for the displayed quantity, rate, and amount to reconcile.

Printed and emailed invoices show the service as the primary label, with the
event name and work date beneath it. Legacy unbilled entries without an event
name remain invoiceable, and previously issued invoices retain their original
rendering and wording.
For invoices old enough to predate frozen line rows, the migration snapshots
the task label used by their fallback renderer before changing the live task.

Added domain aggregation, route/form, rendering, and email tests. The complete
suite passes with 299 tests, along with TypeScript checking and SQLite migration
smoke tests.

Invoices can now be canceled without erasing the accounting record. Cancellation
retains the invoice and its frozen lines, marks it canceled, and atomically
returns its time and mileage rows to the unbilled pool for correction and
reinvoicing. Paid and already-canceled invoices are protected, and canceled
invoices cannot be sent or emailed. Legacy invoices that predate frozen line
items cannot be canceled because releasing their source rows would erase their
only surviving item detail.

### Audit work in progress

Documentation was reconciled with the current application and `SPEC.md` was
added as the functional contract. The dependency audit initially found 12
advisories (including transitive Wrangler/Vitest tooling); Hono, Wrangler,
Workers types, Vitest, and Vite were upgraded, with patched Sharp pinned through
an override. The resulting dependency scan reports zero vulnerabilities. The
full 299-test suite and both TypeScript configurations pass on the upgraded
toolchain. Wrangler's production bundle dry-run and controlled SQLite migration
smoke pass. Static secrets/input/access review found no feature-specific issue.
Live Tarnsby smoke verification remains before the audit is closed.

## 2026-07-28: Open-source split, security fix, tenant rename

**Renamed `stint` → `hourchit`.** A namespace search found `stint` taken on npm,
PyPI, crates.io, and RubyGems, plus an existing stint.co and a TimeStint
product. `hourchit` was clear across all four registries and the relevant TLDs.
Landed as PR #1.

**Fixed a fail-open authentication bug.** `requireAuth()` called `next()`
whenever `ACCESS_TOKEN` was unset. A comment scoped that to local `wrangler
dev`, but nothing enforced the scope, so any deploy that skipped `wrangler
secret put` would have served a real client's billing data to anyone who found
the URL. The gate now fails closed in every environment (503), local development
supplies the token through `.dev.vars`, and both token comparisons are
constant-time. `test/auth.test.ts` covers it, the two fail-closed cases return
200 against the previous implementation and 503 against this one.

**Split public core from private tenant data.** The core is being published, and
a real tenant profile carries a business address, a billing email, and the home
address behind the mileage route. A state business filing being public record
isn't a reason to put that in a crawled, mirrored, scraped GitHub repo.

- `src/config/profiles.ts` no longer hand-imports each profile. The registry is
  generated from whatever `profiles/*.json` exist
  (`scripts/generate-profiles.mjs`, output gitignored, wired to npm pre-hooks).
  It rejects a profile whose `key` disagrees with its filename, because that
  mismatch would surface as a tenant quietly serving the wrong branding.
- `.gitignore` permits only `core.json` and `example.json` under `profiles/`,
  and CI asserts the same thing so a slip fails the build rather than the review.
- `wrangler.jsonc` dropped the tenant environment; each tenant gets a complete
  standalone config living beside its profile in the private repo.

**Retired the initial placeholder tenant key.** The first tenant's business
was formally constituted, so its tenant key moved to the real entity's key
before any data was seeded. The key itself and everything identifying that
business live in the private tenants repo, not here.

**Added the open-source surface:** MIT license (BPS Enterprises LLC, d/b/a 1507
Systems), README rewritten for an outside reader, `CONTRIBUTING.md`,
`SECURITY.md` with an honest threat model, `CODE_OF_CONDUCT.md`, issue and PR
templates, and a GitHub-hosted CI workflow. Public repo, so GitHub-hosted
runners (a self-hosted runner must never be attached to a public repository).

### Round one (built in a remote session, same day)

Cloudflare Worker + D1, Hono, server-rendered HTML, integer cents for money, and
naive local wall-clock strings for trip times so `16:30` means what the owner's
watch says. The mileage rule, billable at/after the after-hours cutoff or on a
weekend, distance from the stored one-way route mileage doubled, is the only
non-obvious piece, and it exists because after-hours travel to a client site is
deductible where the daytime commute isn't.

One SQLite trap worth remembering: the single-running-timer guard must be an
expression index on `(stopped_at IS NULL)`, not a plain index on `stopped_at`.
SQLite treats NULLs as distinct, so the plain version enforces nothing.

## Open questions

Tracked so they don't get lost:

- The first tenant's profile still needs the institutional client's name, address,
  and billing email; the engagement name and hourly rate; the business phone;
  and the client-site address plus the home↔site one-way mileage. Seeding with
  `oneWayMiles: 0` would bill zero miles on every trip.
- How `ACCESS_TOKEN` reaches the deployed tenant, and who holds it.

## 2026-09-10: Per-user dashboard customization

Added server-side dashboard ordering and visibility preferences through migration
`0014_dashboard_preferences.sql`. Normal email sessions receive independent
layouts keyed by normalized address; break-glass access receives a distinct
shared layout. Customize mode uses explicit move-up, move-down, show, and hide
buttons so it works with touch and keyboard input without drag-and-drop.

The Recent Mileage module now disappears when it has no rows. Dashboard card
headings have less unused top space through dashboard-scoped CSS, leaving all
other application cards unchanged. Existing local date-and-time inputs are
preserved.

The final audit passed in one clean post-review run: 323 tests, both TypeScript
configurations, zero npm vulnerabilities, Worker production-bundle dry-run,
clean-database migrations through 0014, and whitespace validation. Independent
review found no blocking security or correctness issue; its three minor findings
were resolved with visible-module movement, OTP identity-isolation coverage, and
an explicit CSS-scope regression check.

Follow-up UI correction moved the dashboard customization action from the page
body into the dashboard header, immediately before Sign out. It toggles to Done
customizing while editing and remains absent from other pages. Independent review
caught narrow-screen overflow in the initial header patch; the header navigation
now wraps with explicit spacing on phones. The post-fix audit passed 324 tests,
both TypeScript configurations, zero npm vulnerabilities, Worker dry-run, and
whitespace validation.

Added the canonical HourChit favicon from
`https://hourchit.app/icon-mark.svg` to every HTML shell through one shared
theme fragment. Current tenants and future tenant subdomains inherit brand
updates without copied files or per-tenant configuration. The SVG is not
advertised as an Apple touch icon because iOS expects a raster icon; a canonical
PNG can be added separately if the main site publishes one.

## 2026-09-19 — Header Settings label

Renamed the shared header link from Terms to Settings to reflect the broader
settings page. Route remains /settings. Reviewed the one-line change for scope,
escaping and authentication impact; no functional or security findings.
Validation: full 417-test suite and both TypeScript configurations pass;
npm audit reports zero vulnerabilities; diff whitespace check clean.

## 2026-09-20 — Tarnsby-only manual handoff implementation and review

Added opt-in single manual Send action, shared full-body composition, private
no-store responses, strict same-origin/PDF/size preparation, native v2/legacy
handoff, Web Share and formatted/plain clipboard + mailto fallback. Download PDF
remains independent; all external paths retain explicit sent confirmation.

Independent review found print leakage and over-broad fallback after confirmed
native unavailability; fixed with failing-then-passing regressions. Also fixed
stale BFCache completion and replaced the disabled anchor with a real button.
Security review checked tenant opt-in, authenticated routes, XSS-safe rendering,
attachment validation, no auto-send mutation and no PDF clipboard. Dependency
security audit: zero vulnerabilities. Native review/tests/build recorded in the
separate iOS repo. Physical mail-app interoperability is not yet qualified;
optional native picker remains disabled. This is a Tarnsby trial, not general
production readiness. Private main must not be merged for this trial because
both tenant CI triggers currently match every main change.

## 2026-09-20 — Browser manual mail replaces Web Share

User's physical Safari→Mail evidence showed PDF attachment but plain body and empty recipient/subject. Retired browser share dispatch. Capability detection selects the existing native HTML/PDF composer; otherwise Send copies HTML/plain text and opens recipient/subject mailto. Visible reminder immediately above Send explains paste and manual PDF attachment. Browser preparation no longer fetches PDFs. Native failure/unavailable reveals the reminder and requires a fresh fallback click. Download PDF remains independent.

Bounded audit: documentation updated; 443 tests and both type checks pass; Worker dry bundle passes; npm audit zero vulnerabilities; independent review found no code/security blocker, and requested non-vacuous native PDF-rejection assertions were added and passed (39 focused tests). Reviewed escaped static reminder, exact bridge capability predicates, existing PDF validation/auth, clipboard denial/restore/duplicate handling, no sent mutations. Three new regressions observed failing before implementation. No secrets or dependencies added. No outstanding finding in this change; whole-project native/device matrix remains unqualified. Tarnsby-only rollout remains mandatory.

## 2026-09-20 — Shell fallback instruction cleanup

Bryce confirms browser formatted paste produces the intended email and first-tap native composition works on his installed shell. Separate shell identity from composer capability so the web-only reminder stays hidden even during manual shell fallback; initial hidden markup prevents a visible flash. Replace abbreviated fallback copy with explicit download/retry/clipboard/addressed-email/paste/attach/send steps. Remove redundant rich-copy success instructions after launch. Collapse individual recipient/subject/body controls in native details/summary labeled Still didn’t work? Click here, with full manual drafting instructions and Copy body without launching mail. Denied clipboard opens recovery before selecting text.

Bounded functionality/security audit and independent review: no outstanding blocker. New copy callback generation guard prevents old completion unlocking a restored page; regression test covers it.447 full tests passed before final two regressions, then45 focused tests and typechecks passed; npm audit0 and Worker dry build passed. Existing native payload/auth/PDF limits and explicit sent confirmation preserved; no dependency/secrets changes. Broader device matrix remains pending despite user's successful browser/shell evidence. Tarnsby-only rollout.
