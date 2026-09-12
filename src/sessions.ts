/**
 * Storage for login codes and sessions.
 *
 * Kept out of db.ts because everything here is security-sensitive in a way the
 * billing tables are not: the single-use guarantee and the attempt cap are
 * enforced by the SQL in this file, not by the callers.
 */
import type { Env } from './env';
import {
  CodeRow,
  MAX_ATTEMPTS,
  MAX_CODES_PER_WINDOW,
  checkCode,
  expiryFrom,
  generateSessionToken,
  hashSecret,
  isoUtc,
  normalizeEmail,
  rateWindowStart,
  sessionExpiryFrom,
} from './domain/otp';

const db = (env: Env) => env.DB;

/**
 * Whether this address has asked for too many codes lately.
 *
 * The limit protects the OPERATOR'S MAILBOX as much as the app: without it,
 * anyone who knows the address can use the login form as a way to send them
 * unlimited mail from a domain they trust.
 */
export async function isRateLimited(env: Env, email: string, now: Date): Promise<boolean> {
  const row = await db(env)
    .prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at >= ?')
    .bind(normalizeEmail(email), rateWindowStart(now))
    .first<{ n: number }>();
  return (row?.n ?? 0) >= MAX_CODES_PER_WINDOW;
}

/**
 * Store a freshly generated code and return nothing.
 *
 * Any earlier live codes for the address are consumed first. Otherwise asking
 * for a second code because the first was slow leaves two valid codes in
 * flight, which doubles the guessing surface and means the cap on one row does
 * not cap the address.
 */
export async function storeCode(env: Env, email: string, code: string, now: Date): Promise<void> {
  const addr = normalizeEmail(email);
  await db(env)
    .prepare('UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL')
    .bind(isoUtc(now), addr)
    .run();
  await db(env)
    .prepare('INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, ?)')
    .bind(addr, await hashSecret(code), expiryFrom(now))
    .run();
}

export type RedeemResult =
  | { ok: true; sessionToken: string }
  | { ok: false; reason: 'no-code' | 'expired' | 'consumed' | 'too-many-attempts' | 'mismatch' };

/**
 * Redeem a submitted code, and on success mint a session.
 *
 * The single-use guarantee lives in the UPDATE's `consumed_at IS NULL` clause
 * rather than in a read-then-write: two requests carrying the same correct code
 * race, both read an unconsumed row, and only the one whose UPDATE reports a
 * changed row is allowed to proceed. Checking in application code and writing
 * afterwards would let both through.
 */
export async function redeemCode(
  env: Env,
  email: string,
  submitted: string,
  now: Date,
): Promise<RedeemResult> {
  const addr = normalizeEmail(email);
  const row = await db(env)
    .prepare(
      `SELECT id, code_hash, expires_at, consumed_at, attempts
         FROM login_codes WHERE email = ? ORDER BY id DESC LIMIT 1`,
    )
    .bind(addr)
    .first<CodeRow & { id: number }>();

  if (!row) return { ok: false, reason: 'no-code' };

  const verdict = checkCode(row, await hashSecret(submitted.trim()), isoUtc(now));

  if (!verdict.ok) {
    // Count the guess only when the code was otherwise usable. Incrementing on
    // an already-expired row would let an attacker burn a later code's budget.
    if (verdict.reason === 'mismatch') {
      await db(env)
        .prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?')
        .bind(row.id)
        .run();
    }
    return { ok: false, reason: verdict.reason };
  }

  const consumed = await db(env)
    .prepare('UPDATE login_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
    .bind(isoUtc(now), row.id)
    .run();
  if ((consumed.meta.changes ?? 0) === 0) return { ok: false, reason: 'consumed' };

  return { ok: true, sessionToken: await createSession(env, addr, now) };
}

/** Mint a session and return the raw token. Only its hash is stored. */
export async function createSession(env: Env, email: string, now: Date): Promise<string> {
  const token = generateSessionToken();
  await db(env)
    .prepare('INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(await hashSecret(token), normalizeEmail(email), sessionExpiryFrom(now))
    .run();
  return token;
}

/** The email behind a live session cookie, or null. */
export async function sessionEmail(env: Env, token: string, now: Date): Promise<string | null> {
  const row = await db(env)
    .prepare(
      `SELECT email FROM sessions
        WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(await hashSecret(token), isoUtc(now))
    .first<{ email: string }>();
  return row?.email ?? null;
}

export async function revokeSession(env: Env, token: string, now: Date): Promise<void> {
  await db(env)
    .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(isoUtc(now), await hashSecret(token))
    .run();
}

export { MAX_ATTEMPTS };
