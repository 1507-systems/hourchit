# Running a configured tenant

HourChit is a generic core. Everything that identifies a business, its name,
address, rates, the mileage rule, and its starter data, lives in one JSON
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

`.gitignore` enforces this, `profiles/*.json` is ignored except for those two
files, so a real profile cannot be committed here by accident.

## The shape of a profile

See `profiles/example.json`. `src/config/profile.ts` is the authoritative type.

| Field | Meaning |
|---|---|
| `key` | Profile id. **Must equal the filename**; the build fails otherwise. |
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

A tenant is described by three files in the private repo:

```
tenants/<key>/profile.json      → copied into this repo as profiles/<key>.json
tenants/<key>/wrangler.jsonc    the Worker config, and the deploy's project root
tenants/<key>/core.ref          the commit of this repo that it deploys
```

The tenant's wrangler config is complete and standalone, its own worker name,
its own `TENANT_PROFILE` var, and its own D1 binding and `database_id`.

**The private repo drives the deploy, not this one.** Each tenant directory
there is a Wrangler project root that clones this core at a pinned commit into
`core/` and points `main` at `core/src/index.ts`. That direction is required by
Cloudflare Workers Builds, which insists the Worker name in the dashboard match
the `name` in the Wrangler config found in the connected root directory, so the
tenant's config has to be the root one. It also means this repo needs no
knowledge of any tenant. See that repo's README for the connection settings.

The profile is still copied in here, to `profiles/<key>.json`, and the build
refuses to continue unless this repo ignores that path.

Provisioning a new tenant's database and secret is still a manual, deliberate
step:

```bash
export CLOUDFLARE_ACCOUNT_ID=<account-id>
cd <tenants-repo>/tenants/<key>
../../scripts/ci-build.sh                      # clones the pinned core into ./core

W=core/node_modules/.bin/wrangler
npx wrangler d1 create hourchit-<key>          # id goes in the tenant's wrangler.jsonc
$W d1 migrations apply DB --remote
(cd core && npm run seed:sql -- <key> > seed/.generated.sql)
$W d1 execute DB --remote --file core/seed/.generated.sql

# REQUIRED: the app returns 503 on every route without it
$W secret put ACCESS_TOKEN
```

Seeding inserts rows unconditionally, so run it against a fresh database only;
a second run duplicates the customer, tasks, and routes.

## Verifying a deploy

`/health` is unauthenticated and reports:

| Field | Meaning |
|---|---|
| `version` | the commit of **this** repo that is running |
| `config` | the commit of the private config repo that produced the deploy, or `''` when this repo was built directly |
| `configured` | whether `ACCESS_TOKEN` is set, `false` means every route is 503 |
| `tenant` | the profile key in use |

Two identities because a tenant deploy builds two repositories. Workers Builds
injects `WORKERS_CI_COMMIT_SHA` for whichever repo it is building, the config
repo, so `version` is taken from git in this tree instead. Reporting the config
repo's commit as the running version would make a drift check compare unrelated
histories, silently, because the value still looks like a perfectly good sha.

`.github/workflows/drift-guard.yml` reads this back on a schedule for every URL
in the `HEALTH_URLS` repository secret and fails when a deployment is
unreachable, unstamped, missing its token, or running a commit that is not in
this history. A live deployment's hostname identifies the client, which is why
the list is a secret and not a file in this public repo. The guard is inert until
that secret is set.

## Onboarding a new tenant

1. Add `tenants/<key>/profile.json` in the private repo, `key` matching the
   directory name.
2. Add `tenants/<key>/wrangler.jsonc` with a unique worker name and its own D1
   database, `main` pointing at `core/src/index.ts`.
3. Add `tenants/<key>/core.ref` pinning the core commit to deploy.
4. Provision, migrate, seed, set the secret, connect Workers Builds.

No changes to this repository are required. If you find yourself editing core
code to onboard a client, the profile is missing a setting, add it to
`ProfileSettings` with a sensible default instead.
