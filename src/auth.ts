import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from './env';
import { esc } from './ui/html';

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
 * Shared-secret gate. Good enough to keep a single-user tool off the open web;
 * a future round can swap in real accounts.
 *
 * This FAILS CLOSED. An earlier revision called `next()` when ACCESS_TOKEN was
 * unset, which meant a deploy that forgot `wrangler secret put` would serve a
 * real client's billing data to anyone who found the workers.dev URL. There is
 * no "open" mode: local development supplies ACCESS_TOKEN through `.dev.vars`
 * (see `.dev.vars.example`), exactly like production supplies it as a secret.
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
  if (cookie && timingSafeEqual(cookie, token)) return next();
  return c.redirect('/login');
}

export function loginPage(c: Ctx, error = ''): Response {
  return c.html(`<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · HourChit</title>
<style>body{font-family:system-ui,sans-serif;max-width:22rem;margin:4rem auto;padding:0 1rem}
input,button{font-size:1rem;padding:.6rem;width:100%;box-sizing:border-box;margin:.3rem 0}
button{background:#1f6feb;color:#fff;border:0;border-radius:.4rem}
.err{color:#c00}</style></head>
<body><h1>HourChit</h1>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/login">
<label>Access token<input type="password" name="token" autofocus></label>
<button type="submit">Sign in</button>
</form></body></html>`);
}

export async function handleLogin(c: Ctx): Promise<Response> {
  const body = await c.req.parseBody();
  const token = String(body.token ?? '');
  if (c.env.ACCESS_TOKEN && timingSafeEqual(token, c.env.ACCESS_TOKEN)) {
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return c.redirect('/');
  }
  return loginPage(c, 'Incorrect token.');
}

export function handleLogout(c: Ctx): Response {
  deleteCookie(c, COOKIE, { path: '/' });
  return c.redirect('/login');
}
