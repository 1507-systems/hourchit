import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from './env';
import { esc } from './ui/html';
import { BRAND_TOKENS, WORDMARK_STYLE, wordmark } from './ui/theme';
import { loadProfile } from './config/profiles';
import { generateCode, isAllowedLogin, normalizeEmail } from './domain/otp';
import { isRateLimited, redeemCode, revokeSession, sessionEmail, storeCode } from './sessions';
import { loginCodeMessage, sendMail } from './mail/send';

const COOKIE = 'hourchit_session';

type Ctx = Context<{ Bindings: Env }>;

/**
 * Compare two strings in time independent of how many leading characters
 * match, so an attacker can't recover the token one character at a time by
 * timing responses. The loop always walks the longer of the two inputs; the
 * length mismatch itself is folded into the result rather than short-circuiting.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) {
    // Out-of-range indices read as undefined; `?? 0` keeps the XOR well-defined
    // without breaking out of the loop early.
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * The addresses allowed to receive a login code.
 *
 * Derived from the tenant profile rather than from a table, because the set of
 * people who may sign in is a deployment decision, not something the app should
 * be able to grow on its own. `business.email` is always included: the operator
 * is whoever reads the business mailbox.
 */
export function allowedLoginEmails(env: Env): string[] {
  const profile = loadProfile(env.TENANT_PROFILE);
  const extra = profile.settings.loginEmails ?? [];
  return [profile.business.email, ...extra].map(normalizeEmail);
}

/**
 * Gate every real route.
 *
 * TWO ways in, in priority order:
 *   1. A session cookie minted by redeeming an emailed code. This is the normal
 *      path and the one the operator uses.
 *   2. The static ACCESS_TOKEN, presented as the cookie value. BREAK-GLASS.
 *      It stays because an auth system whose only path runs through a third
 *      party's mail is one that locks you out of your own invoices the morning
 *      that mail breaks -- which is also the morning you need to send one.
 *
 * FAILS CLOSED. With no ACCESS_TOKEN configured the app 503s rather than
 * opening: an earlier revision called next() in that case, which meant a deploy
 * that forgot `wrangler secret put` served a client's billing data to anyone who
 * found the workers.dev URL.
 */
export async function requireAuth(c: Ctx, next: Next): Promise<Response | void> {
  const token = c.env.ACCESS_TOKEN;
  if (!token) {
    return c.text(
      'HourChit is not configured: ACCESS_TOKEN is unset. Set it as a Worker ' +
        'secret (production) or in .dev.vars (local) before using this app.',
      503,
    );
  }
  const cookie = getCookie(c, COOKIE);
  if (!cookie) return c.redirect('/login');

  // Break-glass first: a constant-time string compare with no database round
  // trip, so it cannot be told apart from a session miss by timing.
  if (timingSafeEqual(cookie, token)) return next();

  // A session lookup that throws (no DB binding, D1 unavailable) must deny
  // rather than 500. An auth check is the one place where an unexpected error
  // has to resolve to "not signed in", never to "assume the best".
  try {
    if (await sessionEmail(c.env, cookie, new Date())) return next();
  } catch (e) {
    console.error('session lookup failed, denying:', (e as Error).message);
  }

  return c.redirect('/login');
}

// ---- Pages -----------------------------------------------------------------

function page(title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · HourChit</title>
<style>
${BRAND_TOKENS}
${WORDMARK_STYLE}
body{font-family:var(--sans);background:var(--paper);color:var(--text);
  max-width:22rem;margin:4rem auto;padding:0 1rem}
h1{margin:0 0 1.6rem}
.wordmark{font-size:1.5rem}
label{display:block;font-family:var(--mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;
  color:var(--text-dim);margin:.6rem 0 .2rem}
input,button{font-size:1rem;padding:.6rem;width:100%;box-sizing:border-box;margin:.3rem 0;
  border-radius:.4rem;border:1px solid var(--rule);background:var(--paper);color:var(--text);font-family:var(--sans)}
/* The login form's only button is a neutral ink chip, same as everywhere
   else in the app -- signing in is not an "on the clock" action, so amber
   stays out of it entirely. */
button{background:var(--ink-2);color:var(--btn-ink-fg);border:0;cursor:pointer;font-weight:600}
input:focus-visible,button:focus-visible{outline:2px solid var(--ink-2);outline-offset:1px}
.err{color:var(--text);font-weight:600}
.err::before{content:"\\26A0  "}
.note{color:var(--text-dim);font-size:.9rem}
input[name=code]{font-size:1.6rem;letter-spacing:.4em;text-align:center;font-family:var(--mono)}
</style>
</head><body><h1>${wordmark()}</h1>
${body}
</body></html>`;
}

/** Step one: ask which mailbox to send a code to. */
export function loginPage(c: Ctx, error = '', prefill = ''): Response {
  return c.html(
    page(
      'Sign in',
      `${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/login">
<label>Email address<input type="email" name="email" autofocus required value="${esc(prefill)}"></label>
<button type="submit">Email me a code</button>
</form>`,
    ),
  );
}

/** Step two: enter the six digits. */
export function codePage(c: Ctx, email: string, error = ''): Response {
  return c.html(
    page(
      'Enter your code',
      `${error ? `<p class="err">${esc(error)}</p>` : ''}
<p class="note">If <strong>${esc(email)}</strong> can sign in, a six digit code is on its way.
It expires in 10 minutes.</p>
<form method="post" action="/login/verify">
<input type="hidden" name="email" value="${esc(email)}">
<label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code"
 pattern="[0-9]{6}" maxlength="6" autofocus required></label>
<button type="submit">Sign in</button>
</form>
<p class="note"><a href="/login">Use a different address</a></p>`,
    ),
  );
}

// ---- Handlers --------------------------------------------------------------

/**
 * Request a code.
 *
 * ALWAYS renders the same next screen, whether or not the address is allowed
 * and whether or not it was rate limited. Telling an anonymous visitor "that
 * address cannot sign in" hands them a way to test addresses one at a time, and
 * telling them "slow down" confirms the address is real.
 */
export async function handleLoginRequest(c: Ctx): Promise<Response> {
  const body = await c.req.parseBody();
  const raw = String(body.email ?? '');
  const email = normalizeEmail(raw);
  if (!email.includes('@')) return loginPage(c, 'Enter an email address.', raw);

  const now = new Date();
  if (isAllowedLogin(email, allowedLoginEmails(c.env)) && !(await isRateLimited(c.env, email, now))) {
    const code = generateCode();
    await storeCode(c.env, email, code, now);
    const profile = loadProfile(c.env.TENANT_PROFILE);
    try {
      await sendMail(
        c.env.EMAIL,
        c.env.LOGIN_MAIL_FROM,
        loginCodeMessage(email, code, profile.business.name),
      );
    } catch (e) {
      // The code is already stored, so failing loudly here would be worse than
      // useless: it would tell an anonymous visitor that this address is real.
      // Log it and show the same screen. The operator sees no code arrive and
      // can fall back to the break-glass token.
      console.error('login code send failed:', (e as Error).message);
    }
  }

  return codePage(c, email);
}

/** Redeem a code and start a session. */
export async function handleLoginVerify(c: Ctx): Promise<Response> {
  const body = await c.req.parseBody();
  const email = normalizeEmail(String(body.email ?? ''));
  const submitted = String(body.code ?? '');
  const result = await redeemCode(c.env, email, submitted, new Date());

  if (!result.ok) {
    const message =
      result.reason === 'too-many-attempts'
        ? 'Too many incorrect attempts. Request a new code.'
        : result.reason === 'expired'
          ? 'That code has expired. Request a new one.'
          : result.reason === 'consumed' || result.reason === 'no-code'
            ? 'That code has already been used. Request a new one.'
            : 'Incorrect code.';
    return codePage(c, email, message);
  }

  setSessionCookie(c, result.sessionToken);
  return c.redirect('/');
}

/**
 * The shared-token form, kept working for break-glass.
 *
 * Reachable at /login/token rather than /login, so the emailed-code flow is the
 * one anybody lands on.
 */
export function tokenLoginPage(c: Ctx, error = ''): Response {
  return c.html(
    page(
      'Break-glass sign in',
      `${error ? `<p class="err">${esc(error)}</p>` : ''}
<p class="note">For use when email is unavailable. The ordinary way in is
<a href="/login">a code sent to your email</a>.</p>
<form method="post" action="/login/token">
<label>Access token<input type="password" name="token" autofocus></label>
<button type="submit">Sign in</button>
</form>`,
    ),
  );
}

export async function handleTokenLogin(c: Ctx): Promise<Response> {
  const body = await c.req.parseBody();
  const token = String(body.token ?? '');
  if (c.env.ACCESS_TOKEN && timingSafeEqual(token, c.env.ACCESS_TOKEN)) {
    setSessionCookie(c, token);
    return c.redirect('/');
  }
  return tokenLoginPage(c, 'Incorrect token.');
}

export async function handleLogout(c: Ctx): Promise<Response> {
  const cookie = getCookie(c, COOKIE);
  // Revoke the row too, so the cookie is dead even if it was copied elsewhere.
  if (cookie) await revokeSession(c.env, cookie, new Date());
  deleteCookie(c, COOKIE, { path: '/' });
  return c.redirect('/login');
}

function setSessionCookie(c: Ctx, value: string): void {
  setCookie(c, COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}
