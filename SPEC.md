# HourChit Functional Specification

## Purpose and deployment model

HourChit is a tenant-configured time, mileage, and invoice application for a
sole proprietor. Each tenant deploys the same Cloudflare Worker core with its
own generated profile, D1 database, authentication allowlist, and mail
configuration. Server-rendered HTML is the primary interface; there is no
client-side application framework.

## Authentication and tenant boundary

Production access requires a one-time email code for an address in the tenant's
configured allowlist. `ACCESS_TOKEN` is the local-development and break-glass
path. The application fails closed when no authentication method is configured.
All non-authentication application routes pass through the shared authentication
middleware. Tenant data separation is provided by separate deployments and D1
databases rather than row-level tenant identifiers.

## Customers, services, and commercial terms

A customer owns service tasks. Each task has a display name and hourly rate and
can be made inactive without deleting history. Effective-dated term and rate
versions preserve the rate, billing increment, minimum call-out, timezone, and
weekend rules in force when work occurred.

## Time entry

Only one live timer may run at once, enforced by a partial unique database
index. Live and manual entries require a service task and event description and
accept an optional GL charge code. Manual entry additionally requires a local
start date/time and duration. Free-text invoice fields are whitespace-normalized
on input and HTML-escaped on output.

Unbilled time has no `invoice_id`, is stopped, and is not voided. Each attendance
is rounded and minimum-adjusted independently under the terms effective at its
start. Each attendance remains a separate invoice line. Work crossing local
midnight is allocated across the actual service dates without applying its
minimum twice.

## Mileage

Routes retain their configured one-way distance. Logged trips are round trips
and become billable according to the tenant's weekend and after-hours rule.
Unbilled mileage has no `invoice_id`, is billable, and is not voided. Mileage is
included only for tenants whose profile explicitly states that it is reimbursed.

## Invoices

Creating an invoice uses only explicitly selected eligible rows for its customer,
calculates amounts under the terms and rates in force when the work occurred,
persists immutable invoice lines and attaches the source rows in one atomic D1 batch.
The transaction rechecks selected source snapshots; a stale selection aborts
without leaving partial invoices or stealing rows from another invoice. Frozen lines
are the rendering source for screen, PDF, and email so later configuration
changes cannot restate an issued document.

A time line displays two descriptive rows:

1. `<service> - <M/D service date>`
2. `<event description> - <GL charge code>`, omitting the separator and charge
   code when the optional code is blank.

Invoices progress through draft, sent, paid, or canceled status. Draft and sent
invoices with frozen lines can be canceled with one of two source dispositions:

- Return entries to unbilled by clearing their invoice association.
- Delete hours from future billing by timestamping the source time and mileage
  entries as void while retaining both source rows and frozen invoice lines.

Paid, already-canceled, and legacy invoices without frozen lines cannot be
canceled. Canceled invoices cannot be sent or emailed.

## Delivery and records

Invoices can be printed, downloaded as PDF, marked sent by hand, or sent as an
email with both HTML and plain-text bodies and a PDF attachment. Delivery events
are retained with the invoice. Incoming and outgoing mail is stored with tenant
records rather than relying on a personal mailbox.

## Dashboard preferences

The dashboard provides a server-rendered customization mode. Each authenticated
user can move modules one position at a time and show or hide them using
keyboard- and touch-accessible controls. Preferences persist in D1 by normalized
session email; the break-glass login uses its own stable identity. Unknown,
duplicate, or retired module identifiers are discarded and newly introduced
modules are appended in the default order.

Recent mileage is omitted whenever there are no mileage rows, including while
customizing. Dashboard cards use tighter top spacing without changing cards on
invoice, client, mail, or settings pages. Date/time inputs retain their existing
local date-and-time behavior.

## Pending billing display and selection

Tenant setting `pending_billing_display` accepts `task_description`, `task`, or
`description`, defaulting to `task` when unset. `POST /settings/pending-billing`
accepts `pendingBillingDisplay`; unknown modes are rejected. It is presentation
only, scoped to pending billings; invoice/PDF rendering is unchanged. Blank legacy
descriptions show "No description". Every attendance stays separate in every mode.

`POST /invoices` accepts `customerId`, repeated `timeEntryIds[]`, and repeated
`mileageIds[]`. At least one entry must be explicitly selected. IDs must be
positive safe integers, unique within each list, unbilled, nonvoided, finished
(for time), and owned by the specified client. Mileage is selectable only when
the tenant bills it. Unchecked entries stay unbilled. Empty or stale submissions
redirect to the dashboard with an actionable error. Preview amounts share the
same historical rates, minimums, rounding, and date splitting as invoice creation.

## Browser manual-send contract

The existing `mail_app` client policy gates `GET /invoices/:id/mail-app` and
`GET /invoices/:id/mail-app/compose`. Both use the shared invoice email content;
external sends omit the hosted-transport disclosure because HourChit does not
send them. The browser page exposes full text and copies HTML plus text when
supported, falls back to text copying, then to selecting visible text for manual
copying. `mailto:` includes recipient and subject only; the user pastes the body
and attaches the downloaded PDF. The PDF download remains the existing renderer.
No preview, copy, open-email, or download action changes invoice status.

`POST /invoices/:id/send` with `method=mail_app` explicitly confirms manual sending.
Paid/canceled invoices are refused. A previously sent invoice requires
`confirmResend=1`; a compare-and-set update prevents a concurrent confirmation
from silently replacing a different sent record. Native composition is unchanged.

Device share-sheet invoice sending is deprecated after physical Safari→Mail
testing showed plain text and missing recipient/subject.

### Staged manual handoff

The optional profile setting `manualSendHandoffEnabled` controls the browser
capability dispatcher for manual-delivery invoices only. Composition is shared
with existing mail and returned privately without caching. Prepared attachments
must be same-origin PDFs with a valid signature, safe filename and at most 5 MiB.
They remain in page memory and are prepared only when a usable native mail
bridge is present. Browsers do not fetch the PDF during email preparation.
One fresh click opens an available native composer;
clipboard fallback copies HTML/plain text and opens recipient/subject mailto.
A reminder above Send explains the manual download/attachment and body paste
steps; shell identity keeps it hidden throughout native and fallback flows.
Shell fallback status explains each manual step before retry. Recovery controls
are collapsed by default; Copy body never launches mail, and clipboard denial
opens the recovery section before selecting the text. Only explicit manual confirmation changes sent state.
No schema migration is required.
