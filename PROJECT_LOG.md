# Project log

Running history of decisions and significant changes. Newest first.

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

**Retired the "MK LLC" placeholder.** The client's LLC was formed on 2026-07-28
as **Matt's A/V Solutions LLC** (CT filing 0014205113), so the tenant key moved
from `mk-llc` to `matts-av` before any data was seeded.

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

- `profiles/matts-av.json` still needs the institutional client's name, address,
  and billing email; the engagement name and hourly rate; the business phone;
  and the client-site address plus the home↔site one-way mileage. Seeding with
  `oneWayMiles: 0` would bill zero miles on every trip.
- How `ACCESS_TOKEN` reaches the deployed tenant, and who holds it.
