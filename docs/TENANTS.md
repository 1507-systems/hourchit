# Running a configured tenant

hourchit is a generic core. Everything that identifies a business — its name,
address, rates, the mileage rule, and its starter data — lives in one JSON
profile. This document describes how to run a configured deployment without
putting client data in this repository.

## Why profiles are not in this repo

This repo is public. A tenant profile contains a real business address, a
billing email, an hourly rate, and the home address used for the mileage route.
Publishing that is not acceptable even when the underlying business filing is
itself a public record: a state filing is searchable on request, while a GitHub
repository is crawled, mirrored, and scraped.

So: **the core is public, tenant profiles are private.** The core ships
`profiles/core.json` (a blank template) and `profiles/example.json` (fully
filled in with invented data, to document the shape). Real profiles live in a
separate private repository and are copied in at deploy time.

`.gitignore` enforces this — `profiles/*.json` is ignored except for those two
files, so a real profile cannot be committed here by accident.

## The shape of a profile

See `profiles/example.json`. `src/config/profile.ts` is the authoritative type.

| Field | Meaning |
|---|---|
| `key` | Profile id. **Must equal the filename** — the build fails otherwise. |
| `business` | Appears on invoices: name, address, email, phone. |
| `settings.mileageRateCentsPerMile` | e.g. `70` = $0.70/mi. |
| `settings.afterHoursStart` | `"HH:MM"` local cutoff for billable travel. |
| `settings.weekendDays` | `0`=Sunday … `6`=Saturday. |
| `settings.invoicePrefix` | Invoice numbers render as `PREFIX-0001`. |
| `seed` | Optional starter rows: one customer, its tasks, and routes. |

`seed.routes[].oneWayMiles` is doubled for a round trip. Leaving it at `0`
means every trip bills zero miles, so fill it in before seeding.

## The profile registry is generated

`src/config/profiles.generated.ts` is built from whatever `profiles/*.json`
files are present, by `scripts/generate-profiles.mjs`. It is gitignored.

Regenerate explicitly with `npm run profiles`; the `dev`, `test`, `typecheck`,
and `deploy` scripts each run it first via an npm pre-hook. The generator fails
loudly if a profile's `key` disagrees with its filename, because that mismatch
would otherwise surface as a tenant silently serving the wrong branding.

## Deploying a tenant

A tenant supplies two files from the private repo:

```
tenants/<key>/profile.json           → copied to profiles/<key>.json
tenants/<key>/wrangler.tenant.jsonc  → copied to wrangler.tenant.<key>.jsonc
```

The tenant's wrangler config is complete and standalone — its own worker name,
its own `TENANT_PROFILE` var, and its own D1 binding and `database_id`. Both
copy targets are gitignored here.

```bash
export CLOUDFLARE_ACCOUNT_ID=<account-id>

# One-time provisioning
npx wrangler d1 create hourchit-<key>       # id goes in the tenant's config
npx wrangler d1 migrations apply DB -c wrangler.tenant.<key>.jsonc --remote
npm run seed:sql -- <key> > seed/.generated.sql
npx wrangler d1 execute DB -c wrangler.tenant.<key>.jsonc --remote --file seed/.generated.sql

# REQUIRED — the app returns 503 on every route without it
npx wrangler secret put ACCESS_TOKEN -c wrangler.tenant.<key>.jsonc

npm run profiles
npm test
npx wrangler deploy -c wrangler.tenant.<key>.jsonc
```

Seeding inserts rows unconditionally, so run it against a fresh database only —
a second run duplicates the customer, tasks, and routes.

## Onboarding a new tenant

1. Add `tenants/<key>/profile.json` in the private repo, `key` matching the
   directory name.
2. Add `tenants/<key>/wrangler.tenant.jsonc` with a unique worker name and its
   own D1 database.
3. Provision, migrate, seed, set the secret, deploy.

No changes to this repository are required. If you find yourself editing core
code to onboard a client, the profile is missing a setting — add it to
`ProfileSettings` with a sensible default instead.
