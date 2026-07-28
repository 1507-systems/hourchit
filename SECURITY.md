# Security policy

## Reporting a vulnerability

Report privately through [GitHub Security
Advisories](https://github.com/1507-systems/hourchit/security/advisories/new).
Please don't open a public issue for anything exploitable.

Expect an acknowledgement within a few days. This is a small project maintained
part-time; there is no bounty program.

## What this software is, security-wise

Be realistic about the threat model before deploying it.

**Authentication is a single shared token.** One secret gates the whole
application; there are no user accounts, no roles, and no audit trail of who did
what. It is designed for a business of one. If two people need separate logins,
or if you need to know which of them edited an invoice, this is the wrong tool
until that changes.

**The gate fails closed.** If `ACCESS_TOKEN` is unset, every gated route returns
503 rather than serving data. There is no "open" mode, in production or locally
— local development supplies the token through `.dev.vars`. An earlier revision
did fail open, which meant a deploy that skipped `wrangler secret put` would
serve billing data to anyone with the URL. That is fixed and covered by tests in
`test/auth.test.ts`.

**The session cookie holds the token itself**, `HttpOnly`, `Secure`,
`SameSite=Lax`, 30-day expiry. There is no server-side session store and no
revocation short of rotating `ACCESS_TOKEN`, which logs out every device. Rotate
it if a device is lost.

**Tenant profiles are configuration, not secrets, but they are personal data.**
A profile carries a business address, a billing email, and the home address used
to compute the mileage route. Keep real profiles out of public repositories —
this repo's `.gitignore` enforces that, and `docs/TENANTS.md` explains the split.

## Deployment checklist

- [ ] `ACCESS_TOKEN` set as a Worker secret, long and random — not a password you use elsewhere.
- [ ] The worker is on HTTPS (any `workers.dev` or Cloudflare-fronted custom domain is).
- [ ] `npm test` passes, including the `requireAuth` fail-closed cases.
- [ ] No real tenant profile is committed: `git ls-files profiles/` should show only `core.json` and `example.json`.

## Supported versions

The `main` branch is the only supported version. There are no backports.
