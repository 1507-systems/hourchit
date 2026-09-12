# Contributing

Thanks for looking. This is a small, deliberately boring codebase. That is the
point of it, and the main thing to preserve.

## Getting set up

```bash
npm install
cp .dev.vars.example .dev.vars   # then edit: ACCESS_TOKEN is required
npm test
npm run typecheck
npm run migrate:local
npm run dev                      # http://127.0.0.1:8787
```

`src/config/profiles.generated.ts` is built from `profiles/*.json` and is
gitignored. The `dev`, `test`, `typecheck`, and `deploy` scripts regenerate it
automatically; run `npm run profiles` if you need it on its own.

## The one architectural rule

**The core never mentions a client.** Anything specific to a particular business
(its name, rates, the cutoff time for billable travel, its starter data) lives
in a tenant profile, never in `src/`.

If onboarding a client would require editing core code, that means the profile
is missing a setting. Add the setting to `ProfileSettings` in
`src/config/profile.ts` with a sensible default, and leave the core generic.

## Layout

```
src/domain/     pure logic (money, time, mileage, invoicing), unit-tested
src/db.ts       D1 data layer; SQL only, no arithmetic
src/ui/         server-rendered HTML
src/config/     profile type + generated registry
src/index.ts    Hono routes wiring db → domain → ui
```

Two conventions worth knowing before you change anything numeric:

- **Money is integer cents everywhere.** Rounding happens once, at the edges.
  Floats in a money path will be sent back.
- **Trip times are naive local wall-clock strings.** No timezone math; `16:30`
  means what the owner's watch says. Don't "fix" this by introducing `Date`
  parsing with an implicit zone.

## Tests

`npm test` runs vitest over `test/`. Domain logic is pure TypeScript and runs
under plain Node (no Workers runtime needed).

New behaviour needs a test. Bug fixes need a test that fails against the old
code; if it passes before your fix, it isn't testing the bug. `test/auth.test.ts`
is the model here: its fail-closed cases return 200 against the pre-fix
implementation and 503 after.

There are no integration tests against the Workers runtime yet. The app is
smoke-tested by hand on `wrangler dev` with a local D1.

## Pull requests

- Conventional commit subjects: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Explain *why* in the body. The diff shows what changed.
- `npm test` and `npm run typecheck` must pass. CI runs both.
- Never commit a real tenant profile, an `ACCESS_TOKEN`, or a `.dev.vars`.

## Things deliberately left undone

Not bugs, and PRs are welcome if you want them:

- Editable settings in D1 behind a settings screen (today: edit the profile, redeploy).
- A live distance lookup. There's a `DistanceProvider` seam in
  `src/domain/mileage.ts` sized for Google Maps Distance Matrix.
- Email invoice delivery (`/invoices/:id/send` marks sent; it doesn't send).
- Multi-user auth. See `SECURITY.md` for what the current model is and isn't.
