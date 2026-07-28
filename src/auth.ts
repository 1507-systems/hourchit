import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from './env';
import { esc } from './ui/html';

const COOKIE = 'hourchit_session';

type Ctx = Context<{ Bindings: Env }>;

/**
 * Shared-secret gate. Good enough to keep a single-user tool off the open web;
 * a future round can swap in real accounts. If ACCESS_TOKEN is unset the app
 * runs open — intended only for local `wrangler dev`.
 */
export async function requireAuth(c: Ctx, next: Next): Promise<Response | void> {
  const token = c.env.ACCESS_TOKEN;
  if (!token) return next();
  if (getCookie(c, COOKIE) === token) return next();
  return c.redirect('/login');
}

export function loginPage(c: Ctx, error = ''): Response {
  return c.html(`<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · hourchit</title>
<style>body{font-family:system-ui,sans-serif;max-width:22rem;margin:4rem auto;padding:0 1rem}
input,button{font-size:1rem;padding:.6rem;width:100%;box-sizing:border-box;margin:.3rem 0}
button{background:#1f6feb;color:#fff;border:0;border-radius:.4rem}
.err{color:#c00}</style></head>
<body><h1>hourchit</h1>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/login">
<label>Access token<input type="password" name="token" autofocus></label>
<button type="submit">Sign in</button>
</form></body></html>`);
}

export async function handleLogin(c: Ctx): Promise<Response> {
  const body = await c.req.parseBody();
  const token = String(body.token ?? '');
  if (c.env.ACCESS_TOKEN && token === c.env.ACCESS_TOKEN) {
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
