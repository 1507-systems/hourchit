# hourchit

Time tracking, mileage, and invoicing for a business of one.

A single Cloudflare **Worker** plus a **D1** database. Server-rendered HTML, no
client framework, no build step for the UI. It costs approximately nothing to
run and moves between Cloudflare accounts without a code change.

> **Scope, honestly:** this is built for a sole proprietor with a handful of
> customers. Authentication is one shared token, there are no user accounts, and
> settings are configuration rather than a settings screen. If that doesn't fit,
> it will not fit later either — see [`SECURITY.md`](SECURITY.md).

## What it does

- **Customers and tasks** — modelled many-to-many from the start; a single-client
  setup just has one of each. Each task carries its own hourly rate.
- **One timer at a time** — start/stop stamps the date and time. Duration accrues
  as *unbilled* against the task until an invoice is created. A partial unique
  index enforces the single running timer in the database, not just in code.
- **Mileage with a rule** — log a trip on a known route and it is automatically
  flagged billable when it starts at or after the after-hours cutoff (default
  16:30) or on a weekend; otherwise it's an ordinary commute and isn't billed.
  Distance comes from the route's stored one-way mileage, doubled for the return.
- **Invoices** — bundle everything unbilled for a customer and render a clean,
  printable page. "Print / Save as PDF" in the browser is the delivery mechanism;
  "mark sent" records the method.

The mileage rule is the only clever part. It encodes a **billing** arrangement —
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
capacities — someone who is an employee of an organisation by day and contracts
with the same organisation after hours is making genuinely different trips, and
Rev. Rul. 99-7 determines deductibility "on a business-by-business basis." Even
then the clock is only evidence of which hat you were wearing. That is an
argument for confirming each trip rather than inferring it: a deliberate
confirmation is a contemporaneous record of capacity, and that is what survives
scrutiny.

## Try it

```bash
npm install
cp .dev.vars.example .dev.vars   # edit it — ACCESS_TOKEN is required
npm test
npm run migrate:local
npm run dev                      # http://127.0.0.1:8787
```

The app **fails closed**: without `ACCESS_TOKEN` every gated route returns 503,
locally and in production alike. There is no open mode.

You'll want some starter data. Copy `profiles/example.json` to
`profiles/mine.json`, change `key` to `"mine"` to match the filename, fill it in,
then:

```bash
npm run seed:sql -- mine > seed/.generated.sql
npx wrangler d1 execute DB --local --file seed/.generated.sql
```

## How it's put together

```
src/domain/     pure logic (money, time, mileage, invoicing) — unit-tested
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

**Trip times are naive local wall-clock strings.** No timezone math anywhere —
`16:30` means what the owner's watch says. This is a feature for a one-person
business operating in one place, and it's why there's no `Date` parsing in the
mileage path.

### Core vs. configured

Everything client-specific — business name and address, rates, the mileage rule,
starter data — lives in a **tenant profile**, a single JSON file. The core code
never mentions a client. Onboarding one is: add a profile, point a wrangler
config at it, provision a database, deploy. No core edits.

Real profiles contain personal data (a business address, a billing email, the
home address used for the mileage route), so they are **not** kept in this
repository — `.gitignore` refuses them. This repo ships `core.json` (blank) and
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

- Settings live in the committed profile — a rate change is an edit and a
  redeploy, not a form.
- Distance is the stored route mileage. There's a `DistanceProvider` seam in
  `src/domain/mileage.ts` sized for a Google Maps Distance Matrix lookup.
- Email invoice delivery is stubbed; `/invoices/:id/send` marks an invoice sent
  without sending anything.
- Domain logic is unit-tested; there are no integration tests against the
  Workers runtime yet. The app is smoke-tested by hand on `wrangler dev`.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The one rule that matters: the core
never mentions a client.

## License

MIT — see [`LICENSE`](LICENSE).
