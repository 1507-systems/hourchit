# HourChit

Time tracking, mileage, and invoicing for a business of one.

A single Cloudflare **Worker** plus a **D1** database. Server-rendered HTML, no
client framework, no build step for the UI. It costs approximately nothing to
run and moves between Cloudflare accounts without a code change.

> **Scope, honestly:** this is built for a sole proprietor with a handful of
> customers. Authentication is email-code based for a configured allowlist,
> there are no separate role tiers, and tenant identity remains configuration.
> If that doesn't fit,
> it will not fit later either; see [`SECURITY.md`](SECURITY.md).

> **Don't want to run this yourself?** [1507 Systems](https://hourchit.app) hosts
> it for you — $15/month flat, no tiers. Take the code and self-host any time,
> free, no lock-in; that's the whole reason the core is MIT-licensed.

## What it does

- **Customers and tasks**: modelled many-to-many from the start; a single-client
  setup just has one of each. Each task carries its own hourly rate.
- **One timer at a time**: start/stop stamps the date and time and requires a
  concrete event description, with an optional free-text GL charge code.
  Manual time entry keeps its explicit local date-and-time control and captures
  the same fields. Duration accrues as
  *unbilled* against the task until an invoice is created. A partial unique
  index enforces the single running timer in the database, not just in code.
- **Mileage with a rule**: log a trip on a known route and it is automatically
  flagged billable when it starts at or after the after-hours cutoff (default
  16:30) or on a weekend; otherwise it's an ordinary commute and isn't billed.
  Distance comes from the route's stored one-way mileage, doubled for the return.
- **Invoices**: choose pending time and mileage entries with checkboxes and render a clean,
  printable page. Every attendance is a separate time line showing service and
  actual local work date above its event description and optional charge code.
  Invoices can be downloaded as PDF, emailed with the PDF attached, marked sent
  by hand, or canceled while retaining an audit record. Cancellation can either
  return source entries for correction and reinvoicing or void them so they can
  never be billed again.

The mileage rule is the only clever part. It encodes a **billing** arrangement:
an engagement where after-hours and weekend call-outs are chargeable and the
ordinary daytime commute isn't. What you may bill is whatever your contract with
your customer says.

> **It is not a tax rule, and you should not read it as one.** Whether a trip
> between home and a work location is *deductible* is governed by
> [Rev. Rul. 99-7](https://www.irs.gov/pub/irs-drop/rr-99-7.pdf), which turns on
> whether the location is temporary, whether you have a regular workplace
> elsewhere, and whether your home is your principal place of business. No
> provision makes a trip deductible because of the hour it happened. Configure
> this rule to match your contract, and take deductibility from your accountant.

Where the cutoff *does* carry weight is when it separates two different
capacities. Someone who is an employee of an organisation by day and contracts
with the same organisation after hours is making genuinely different trips, and
Rev. Rul. 99-7 determines deductibility "on a business-by-business basis." Even
then the clock is only evidence of which hat you were wearing. That is an
argument for confirming each trip rather than inferring it: a deliberate
confirmation is a contemporaneous record of capacity, and that is what survives
scrutiny.

## Try it

```bash
npm install
cp .dev.vars.example .dev.vars   # edit it: ACCESS_TOKEN is required
npm test
npm run migrate:local
npm run dev                      # http://127.0.0.1:8787
```

The app **fails closed**: production access uses one-time email codes for the
tenant allowlist. `ACCESS_TOKEN` remains a break-glass/local-development path;
without configured authentication every gated route remains unavailable.

You'll want some starter data. Copy `profiles/example.json` to
`profiles/mine.json`, change `key` to `"mine"` to match the filename, fill it in,
then:

```bash
npm run seed:sql -- mine > seed/.generated.sql
npx wrangler d1 execute DB --local --file seed/.generated.sql
```

## How it's put together

```
src/domain/     pure logic (money, time, mileage, invoicing), unit-tested
src/db.ts       D1 data layer; SQL only, arithmetic lives in domain/
src/ui/         server-rendered HTML (layout, dashboard, printable invoice)
src/config/     tenant profile type + generated registry
src/index.ts    Hono routes wiring db → domain → ui
profiles/       core.json (blank template) + example.json (documented shape)
migrations/     D1 schema
seed/           profile → seed SQL generator
test/           vitest specs
```

Two decisions shape most of the code:

**Money is integer cents everywhere.** Rounding happens once, at the edges, so
an invoice total always equals the sum of its lines.

**Trip times are naive local wall-clock strings.** No timezone math anywhere;
`16:30` means what the owner's watch says. This is a feature for a one-person
business operating in one place, and it's why there's no `Date` parsing in the
mileage path.

### Core vs. configured

Everything client-specific (business name and address, rates, the mileage
rule, starter data) lives in a **tenant profile**, a single JSON file. The core code
never mentions a client. Onboarding one is: add a profile, point a wrangler
config at it, provision a database, deploy. No core edits.

Real profiles contain personal data (a business address, a billing email, the
home address used for the mileage route), so they are **not** kept in this
repository; `.gitignore` refuses them. This repo ships `core.json` (blank) and
`example.json` (invented data, documenting the shape).

[`docs/TENANTS.md`](docs/TENANTS.md) covers running a configured deployment.
[`docs/DESIGN.md`](docs/DESIGN.md) covers why things are the way they are.

## Deploy

No `account_id` is hard-coded, so the same tree ships to any Cloudflare account:

```bash
export CLOUDFLARE_ACCOUNT_ID=<account-id>
npx wrangler d1 create hourchit-core      # paste the id into wrangler.jsonc
npm run migrate:remote
npx wrangler secret put ACCESS_TOKEN      # required
npm run deploy
```

## Known edges

- Tenant identity and seed defaults live in the committed profile. Effective-
  dated billing terms and client/task administration are available in the app.
- Distance is the stored route mileage. There's a `DistanceProvider` seam in
  `src/domain/mileage.ts` sized for a Google Maps Distance Matrix lookup.
- Tests include real SQLite integration coverage against the complete migration
  schema for selected invoicing and manual-send state. The local Worker is also
  smoke-tested with `wrangler dev`; external mail apps and live PDF rendering
  require their configured integrations.

## Pending billings and manual email

Under **Terms → Pending billing display**, choose **Task + description**, **Task only**,
or **Description only** for the tenant. Each attendance stays a separate row;
this setting never changes invoices or PDFs. Existing tenants start with task-only
labels until they choose a mode.

Select the pending entries you want and click **Add to invoice**. Select/deselect
all and a running hours/charge total help review the selection. Unchecked entries
remain unbilled; stale or competing submissions cannot bill the same entry twice.
**Choose entries to invoice** reveals the selection card even if you hid it.

For a client configured to use their own mail app, **Compose invoice email** opens
these steps in a browser: download the PDF, **Copy body**, open your mail app,
paste the body, attach the PDF, and send. The shared email renderer supplies all
invoice details; formatted copying includes a plain-text fallback. If clipboard
access fails, the text is selected for manual copying. Recipient and subject stay
visible for clients that do not handle email links. Finally, **Mark as sent manually**
records the operator's confirmation; copying, opening, and downloading do not.
The native mail composer continues to attach the PDF directly.

Device share-sheet sending is planned as a fast follow. Combined body/PDF
clipboard copying is not supported.

## Dashboard preferences

Each signed-in user can choose **Customize dashboard** to move modules up or
down and show or hide them. Changes are stored server-side, so the layout follows
that login across devices. The break-glass login has a separate shared layout.
Recent mileage is omitted automatically when no mileage exists; it is not shown
as an empty customization placeholder.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The one rule that matters: the core
never mentions a client.

## License

MIT. See [`LICENSE`](LICENSE).

Manual invoice handoff can be staged per tenant with
`settings.manualSendHandoffEnabled` (default false). An opted-in manual invoice
uses one Send button: supported native composer, PDF Web Share, or recipient/
subject mailto with HTML/plain body copying and manual PDF attachment. Download
PDF remains available. External handoffs never mark invoices sent automatically.
Share targets can omit recipient, subject or text; check the destination draft.
The initial rollout is restricted to the test tenant pending device qualification.
