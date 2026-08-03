# Project log

Running history of decisions and significant changes. Newest first.

## 2026-08-03: App-icon set and a real favicon

Exported the approved brand mark (a punched-tag silhouette with a filled
circular hole -- the "on the clock" device) to actual image assets, and wired
a favicon into every page the app renders.

- **Source SVGs and every exported PNG live under `assets/icon/`**: the mark
  alone (`mark.svg`), the composited ink+amber app-icon square (`tile.svg`),
  and the Android adaptive-icon pair (`android-adaptive-bg.svg` /
  `android-adaptive-fg.svg`), plus rendered PNGs in `ios/` (1024 down to 29,
  flat squares, no alpha -- Apple applies its own corner rounding),
  `android/` (a 512 standard icon plus the adaptive background/foreground
  pair, foreground kept transparent and scaled to roughly Android's 66% safe
  zone so OEM mask shapes don't clip it), and `favicon/` (32 and 48). Every
  size was verified against spec with `sips -g pixelWidth -g pixelHeight -g
  hasAlpha`, not just trusted from a silent `rsvg-convert` exit code.
- **No Cloudflare Workers static-assets directory exists in this repo**
  (`wrangler.jsonc` has no `assets` key), and adding one changes request
  routing for every path by default plus would need mirroring into each
  tenant's separate wrangler config. For two small, tenant-invariant PNGs,
  the smaller move was to embed them as base64 in `src/favicon.ts` and serve
  them from ordinary routes -- the same pattern this repo already uses for
  the generated invoice PDF (`/invoices/:id/pdf`).
- **`/favicon-32.png`, `/favicon-48.png`, and `/favicon.ico`** are registered
  before the `requireAuth` gate in `src/index.ts`, unauthenticated for the
  same reason `/health` is: a browser asks for these before any login
  happens. `/favicon.ico` serves the 32px PNG rather than a true
  multi-resolution ICO container -- rsvg-convert can't produce one, and
  nothing in this repo's existing head/meta tags expected real `.ico`
  semantics (checked; there was none before this).
- **`<link rel="icon">` tags added to every `<head>` this app emits**:
  `src/ui/layout.ts` (the main app shell), `src/ui/invoice.ts`, `src/ui/mail.ts`,
  and `src/auth.ts` (the login pages, which is the very first thing a browser
  tab shows).
- No `manifest.json` yet -- the full icon set is committed and ready for
  whenever a PWA manifest or native wrapper needs it, but inventing one now
  would mean guessing at fields (short_name, description) nobody has decided.

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
