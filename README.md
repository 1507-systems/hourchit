# hourchit

Tiny time-tracking, mileage, and invoicing for a one-person LLC. A single
Cloudflare **Worker** + **D1** database — no client framework, no build step for
the UI, cheap to run and easy to move.

Built to be **reused across clients**: the code is generic ("core"); each
deployment is specialized by a small **profile** file. The first configured
tenant is **MK LLC** (placeholder name — updated when the LLC name is final).

## What it does (round one)

- **Customers & tasks** — modeled many-to-many from day one; a single-client
  setup just has one of each. Each task carries its own hourly rate.
- **Timer** — one running timer at a time. Start/stop auto-stamps date + time;
  duration accrues as *unbilled* against the task until an invoice is created,
  then resets.
- **Mileage with smarts** — log a trip on a known route; it's **auto-flagged
  billable when it starts at/after the after-hours cutoff (default 16:30) or on
  a weekend**, otherwise treated as an ordinary (non-billable) daytime commute.
  Distance comes from the route's stored one-way mileage (× 2 for round trip).
- **Invoicing** — bundle everything unbilled for a customer into an invoice and
  render a clean, **printable** page (browser "Print / Save PDF"). "Mark sent"
  records the method; email delivery is a pluggable stub for a later round.

## Architecture

```
src/domain/     pure, unit-tested logic (money, time, mileage, invoicing)
src/db.ts       D1 data layer (SQL only; math lives in domain/)
src/ui/         server-rendered HTML (layout, dashboard, printable invoice)
src/config/     tenant profile type + loader
src/index.ts    Hono app wiring routes → db → ui
profiles/       core.json (generic) + mk-llc.json (configured)
migrations/     D1 schema
seed/           profile → seed SQL generator
test/           vitest specs for the domain
```

Money is integer **cents** everywhere; rounding happens once, at the edges.
Trip times are stored and classified as **naive local wall-clock** — no timezone
math, so "16:30" means what the owner's watch says.

### Core vs. configured

All client-specific facts (business name/address, rates, the mileage rule,
starter data) live **only** in `profiles/<key>.json`. The core code never
mentions a client. To onboard a new client:

1. Add `profiles/<key>.json`, register it in `src/config/profiles.ts`.
2. Add a wrangler env pointing `TENANT_PROFILE` at it with its own D1.
3. `wrangler d1 create` → migrate → seed → deploy.

No core edits.

## Portability

`wrangler.jsonc` hard-codes **no `account_id`** — the target account comes from
`CLOUDFLARE_ACCOUNT_ID` at deploy time, so the same repo ships to the 1507
Systems dev account today or a client's own account tomorrow. Two environments
ship in the box: default (`core`, clean) and `mkllc`.

## Develop

```bash
npm install
npm test              # domain unit tests (vitest)
npm run typecheck     # tsc --noEmit
npm run migrate:local # apply schema to local D1
npm run dev           # wrangler dev at http://127.0.0.1:8787
```

With no `ACCESS_TOKEN` set the app runs open (local only).

## Deploy (dev under 1507 Systems)

```bash
export CLOUDFLARE_ACCOUNT_ID=1bc602ff7462b84393caf09302a19b29   # 1507 Systems

# --- MK LLC environment ---
npx wrangler d1 create hourchit-mkllc        # paste database_id into wrangler.jsonc (env.mkllc)
npx wrangler d1 migrations apply DB --env mkllc --remote
npm run seed:mkllc:remote                 # seeds customer/task/route from profiles/mk-llc.json
npx wrangler secret put ACCESS_TOKEN --env mkllc
npx wrangler deploy --env mkllc
```

The clean `core` build deploys the same way without `--env mkllc` (and its own
D1 + `hourchit-core` name).

## Known round-one edges (for the next pass)

- `profiles/mk-llc.json` is placeholder-filled (`TODO:` values) — needs the real
  LLC name, client, addresses, rate, and the home↔client one-way mileage.
- Config lives in the committed profile (rate/rule changes = edit + redeploy). A
  later round can move editable settings into D1 behind a settings screen.
- Distance is the stored route mileage; a Google Maps Distance Matrix provider
  can drop into the `DistanceProvider` seam in `src/domain/mileage.ts` without
  schema or caller changes.
- Email invoice delivery is stubbed (`/invoices/:id/send`); wire a real sender
  when it's needed.
- Auth is a single shared token — fine for one user, not multi-user.
