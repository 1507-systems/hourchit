/**
 * One-time login codes: generation, hashing, and the rules about when a code
 * may still be redeemed.
 *
 * Pure and side-effect free on purpose. Everything here is the part that is
 * easy to get subtly wrong and expensive to discover in production, so it is
 * the part that gets unit tests rather than a hopeful integration check.
 */

/** How long a freshly issued code stays redeemable. */
export const CODE_TTL_MINUTES = 10;

/** Wrong guesses allowed against a single code before it is dead. */
export const MAX_ATTEMPTS = 5;

/** Codes a single address may request inside RATE_WINDOW_MINUTES. */
export const MAX_CODES_PER_WINDOW = 3;
export const RATE_WINDOW_MINUTES = 15;

/** How long a session lasts once a code has been redeemed. */
export const SESSION_TTL_DAYS = 30;

const DIGITS = 6;

/**
 * A six digit code, uniformly distributed.
 *
 * The obvious `random % 1000000` is biased: 2^32 is not a multiple of 10^6, so
 * the low codes come up slightly more often than the high ones. The bias is
 * small but it is free to avoid, and "slightly more likely" is exactly the
 * property an attacker guessing codes wants. Values landing in the final
 * partial bucket are discarded and redrawn instead.
 */
export function generateCode(randomUint32: () => number = cryptoUint32): string {
  const limit = 10 ** DIGITS; // 1_000_000
  const ceiling = Math.floor(0xffffffff / limit) * limit;
  let n = randomUint32();
  while (n >= ceiling) n = randomUint32();
  return String(n % limit).padStart(DIGITS, '0');
}

function cryptoUint32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

/**
 * A session token. 32 bytes of randomness, hex encoded: far beyond guessing,
 * and safe to put in a cookie because only its hash is ever stored.
 */
export function generateSessionToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256, hex. Used for codes and session tokens alike.
 *
 * NOT a password hash, and deliberately not one: these are high-entropy values
 * with a ten minute (or thirty day) life, so there is nothing for bcrypt-style
 * work factors to protect against, and a slow hash on every request would be a
 * denial-of-service surface rather than a defence.
 */
export async function hashSecret(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Normalize an address for comparison and storage. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether `candidate` is allowed to receive a login code.
 *
 * An allowlist, not a lookup: a code must only ever be deliverable to an
 * address the tenant configured. Without this, anyone could make the app send
 * mail to any address in the world, which is both an account takeover vector
 * and a way to get the sending domain blacklisted.
 */
export function isAllowedLogin(candidate: string, allowed: string[]): boolean {
  const c = normalizeEmail(candidate);
  return allowed.some((a) => normalizeEmail(a) === c);
}

export interface CodeRow {
  code_hash: string;
  expires_at: string;
  consumed_at: string | null;
  attempts: number;
}

export type CodeRejection = 'expired' | 'consumed' | 'too-many-attempts' | 'mismatch';

/**
 * Decide whether a submitted code redeems a stored one.
 *
 * Order matters. Expiry, consumption and the attempt cap are all checked BEFORE
 * the hash comparison, so a dead code costs an attacker nothing to distinguish
 * from a live one by timing, and so a burned code cannot be ground against.
 */
export function checkCode(
  row: CodeRow,
  submittedHash: string,
  nowIso: string,
): { ok: true } | { ok: false; reason: CodeRejection } {
  if (row.consumed_at !== null) return { ok: false, reason: 'consumed' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too-many-attempts' };
  if (nowIso >= row.expires_at) return { ok: false, reason: 'expired' };
  if (!timingSafeEqualHex(row.code_hash, submittedHash)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

/**
 * Compare two hex digests without leaking where they diverge.
 *
 * Both inputs here are SHA-256 output rather than user text, so this is belt
 * and braces, but a comparison that short-circuits is the kind of thing that
 * gets copied to somewhere it does matter.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** ISO-8601 in the same shape SQLite's datetime('now') produces. */
export function isoUtc(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function expiryFrom(now: Date, minutes = CODE_TTL_MINUTES): string {
  return isoUtc(new Date(now.getTime() + minutes * 60_000));
}

export function sessionExpiryFrom(now: Date, days = SESSION_TTL_DAYS): string {
  return isoUtc(new Date(now.getTime() + days * 24 * 60 * 60_000));
}

export function rateWindowStart(now: Date, minutes = RATE_WINDOW_MINUTES): string {
  return isoUtc(new Date(now.getTime() - minutes * 60_000));
}
