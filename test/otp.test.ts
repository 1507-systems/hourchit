import { describe, it, expect } from 'vitest';
import {
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  checkCode,
  expiryFrom,
  generateCode,
  generateSessionToken,
  hashSecret,
  isAllowedLogin,
  isoUtc,
  normalizeEmail,
  rateWindowStart,
  timingSafeEqualHex,
} from '../src/domain/otp';

describe('code generation', () => {
  it('is always six digits, zero padded', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });

  it('pads a small draw rather than emitting a short code', () => {
    // A code of "7" would still verify, but it is a 1-in-10 guess rather than
    // 1-in-a-million, and it looks like a bug to whoever receives it.
    expect(generateCode(() => 7)).toBe('000007');
  });

  it('rejects draws in the biased tail instead of taking them modulo', () => {
    // 0xffffffff sits in the final partial bucket. Taking it % 1e6 would be
    // legal but skews low codes; the generator must redraw instead.
    const draws = [0xffffffff, 0xfffffff0, 42];
    let i = 0;
    expect(generateCode(() => draws[i++])).toBe('000042');
    expect(i).toBe(3); // both biased draws were discarded
  });

  it('produces session tokens long enough not to be guessed', () => {
    const t = generateSessionToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSessionToken()).not.toBe(t);
  });
});

describe('hashing', () => {
  it('never returns the input', async () => {
    expect(await hashSecret('123456')).not.toContain('123456');
  });

  it('is stable and distinct', async () => {
    expect(await hashSecret('123456')).toBe(await hashSecret('123456'));
    expect(await hashSecret('123456')).not.toBe(await hashSecret('123457'));
  });
});

describe('timingSafeEqualHex', () => {
  it('matches identical strings and rejects everything else', () => {
    expect(timingSafeEqualHex('abc', 'abc')).toBe(true);
    expect(timingSafeEqualHex('abc', 'abd')).toBe(false);
    expect(timingSafeEqualHex('abc', 'ab')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(true);
  });
});

describe('login allowlist', () => {
  it('is case and whitespace insensitive', () => {
    expect(isAllowedLogin('  Tarnsby@BPSMail.net ', ['tarnsby@bpsmail.net'])).toBe(true);
  });

  it('refuses an address that is not configured', () => {
    // The whole point: without this, the login form is a way to make the app
    // send mail to anyone in the world.
    expect(isAllowedLogin('attacker@example.com', ['tarnsby@bpsmail.net'])).toBe(false);
  });

  it('refuses a near miss rather than matching loosely', () => {
    expect(isAllowedLogin('tarnsby@bpsmail.net.evil.com', ['tarnsby@bpsmail.net'])).toBe(false);
    expect(isAllowedLogin('tarnsby@bpsmail.ne', ['tarnsby@bpsmail.net'])).toBe(false);
  });

  it('normalizes both sides', () => {
    expect(normalizeEmail(' A@B.COM ')).toBe('a@b.com');
  });
});

describe('checkCode', () => {
  const now = '2026-07-30 12:00:00';
  const base = { code_hash: 'aaaa', expires_at: '2026-07-30 12:05:00', consumed_at: null, attempts: 0 };

  it('accepts a live, unused, correct code', () => {
    expect(checkCode(base, 'aaaa', now)).toEqual({ ok: true });
  });

  it('rejects a wrong code', () => {
    expect(checkCode(base, 'bbbb', now)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects an expired code even when it is correct', () => {
    const expired = { ...base, expires_at: '2026-07-30 11:59:59' };
    expect(checkCode(expired, 'aaaa', now)).toEqual({ ok: false, reason: 'expired' });
  });

  it('treats the expiry instant itself as expired', () => {
    const exactly = { ...base, expires_at: now };
    expect(checkCode(exactly, 'aaaa', now)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a code that was already redeemed', () => {
    const used = { ...base, consumed_at: '2026-07-30 11:58:00' };
    expect(checkCode(used, 'aaaa', now)).toEqual({ ok: false, reason: 'consumed' });
  });

  it('stops accepting a correct code once the attempt cap is hit', () => {
    // Six digits is a million combinations, which an unattended script gets
    // through. The cap is what makes the code space actually finite.
    const burned = { ...base, attempts: MAX_ATTEMPTS };
    expect(checkCode(burned, 'aaaa', now)).toEqual({ ok: false, reason: 'too-many-attempts' });
  });

  it('checks consumption and expiry BEFORE comparing the hash', () => {
    // A dead code must not be distinguishable from a live one by which
    // rejection it returns, and a burned row must not be grindable.
    const dead = { ...base, consumed_at: '2026-07-30 11:00:00', attempts: MAX_ATTEMPTS };
    expect(checkCode(dead, 'wrong', now)).toEqual({ ok: false, reason: 'consumed' });
  });
});

describe('time helpers', () => {
  it('formats to the shape SQLite datetime() produces, so string compares work', () => {
    expect(isoUtc(new Date('2026-07-30T12:00:00.000Z'))).toBe('2026-07-30 12:00:00');
  });

  it('expires a code TTL minutes out', () => {
    const now = new Date('2026-07-30T12:00:00.000Z');
    expect(expiryFrom(now)).toBe('2026-07-30 12:10:00');
    expect(CODE_TTL_MINUTES).toBe(10);
  });

  it('looks backwards for the rate window', () => {
    expect(rateWindowStart(new Date('2026-07-30T12:00:00.000Z'))).toBe('2026-07-30 11:45:00');
  });

  it('orders lexically the same way it orders chronologically', () => {
    // The whole scheme relies on this: expiry is compared with `>=` on strings.
    const a = isoUtc(new Date('2026-07-30T12:00:00Z'));
    const b = isoUtc(new Date('2026-07-30T12:00:01Z'));
    expect(a < b).toBe(true);
  });
});
