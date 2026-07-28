# hourchit — design notes

**Date:** 2026-07-28
**Status:** Round one (initial build)

## Problem

A one-person LLC, restarting with a single institutional client, needs a very
basic system to:

1. Track billable time against a task (start/stop, auto date+time, cumulative
   unbilled duration until invoiced).
2. Log mileage with light automation — attribute business mileage for travel
   between home and the client site **after hours or on weekends**.
3. Produce an invoice (printed now, possibly emailed later).

It must be **web-hosted** (dev under the 1507 Systems Cloudflare account) and
**portable** to another Cloudflare account later. It should ship as a **clean,
generic core** plus a **configured** deployment for the client's use case.

## Decisions

| Area | Choice | Rationale |
|---|---|---|
| Runtime | Cloudflare Worker + D1 | Web-hosted, cheap, portable across CF accounts; matches the 1507 stack |
| Server framework | Hono | Tiny, standard for Workers |
| UI | Server-rendered HTML, no client framework | "Very basic," phone-friendly, nothing to build |
| Money | Integer cents + round-half-away-from-zero | No float drift on invoices |
| Time | ISO-8601 UTC instants; durations in JS | Simple, testable |
| Mileage time | Naive local wall-clock string | "16:30" = the owner's watch, no TZ pitfalls |
| Distance | Stored per-route one-way miles, ×2 | Works with zero API keys; provider seam for Google Maps later |
| Config | Per-tenant JSON profile | Generic core; specialization lives in one file |
| Portability | No `account_id` in wrangler; `CLOUDFLARE_ACCOUNT_ID` at deploy | Same repo → any account |
| Auth | Single shared token (cookie gate) | One user; keeps it off the open web |

## Core vs. configured

One codebase. `profiles/core.json` is generic/blank and `profiles/example.json`
documents the shape; a real tenant profile carries that business's branding,
rates, mileage rule, and seed data. `TENANT_PROFILE` (a wrangler var) selects
the active profile; each tenant gets its own wrangler config and its own D1. New
client = new profile + new config, no core changes.

Because a real profile contains personal data — a business address, a billing
email, the home address behind the mileage route — and this repository is
public, real profiles live in a separate private repository and are copied in at
deploy time. `.gitignore` enforces the split. See `docs/TENANTS.md`.

## Data model

`customers` → `tasks` (rate per task) → `time_entries` (unbilled until an
`invoice_id` is set). `routes` feed `mileage_entries` (billable flag + reason,
rate captured per row). `invoices` store subtotals + total in cents and a
period derived from the billed rows. A partial unique index enforces **at most
one running timer** at the database level.

## The mileage rule

A trip is billable when it starts **at/after the after-hours cutoff (default
16:30)** *or* on a **weekend** (both configurable per profile). Otherwise it's a
normal daytime commute and not billed. Distance resolves from the route table;
the `DistanceProvider` interface is where a live Google Maps Distance Matrix
lookup slots in without touching schema or callers.

**`billable` means chargeable to the customer, not deductible on a tax return.**
The two are different questions and this field only answers the first. Tax
deductibility of home-to-worksite travel is governed by
[Rev. Rul. 99-7](https://www.irs.gov/pub/irs-drop/rr-99-7.pdf) and turns on
whether the work location is temporary, whether the taxpayer has a regular
workplace elsewhere, and whether the residence is the principal place of
business under § 280A(c)(1)(A). Time of day and day of week play no part in it.
Conflating the two would be an expensive mistake in both directions — billing
for what the contract doesn't cover, or failing to claim deductible travel
because the app called it a commute.

The per-mile rate is stored **on each mileage row** at entry time, not read from
the profile at invoice time. That is deliberate: published mileage rates change,
sometimes mid-year, and a rate change must not silently reprice trips already
taken.

## Deliberately deferred

- Real client data (profile is `TODO:`-filled pending the LLC name/details).
- Editable settings in D1 (today: edit profile + redeploy).
- Live maps distance, email invoice delivery, multi-user auth.
- Full Workers-runtime integration tests (domain logic is unit-tested; the app
  was smoke-tested end-to-end via `wrangler dev` + local D1).
