import { describe, expect, it } from 'vitest';
import {
  ContactRef,
  missingRecipients,
  resolveRecipients,
  Role,
} from '../src/domain/recipients';

function contact(
  id: number,
  name: string,
  roles: [Role, boolean][],
  active = 1,
): ContactRef {
  return {
    id,
    name,
    email: `${name.toLowerCase().replace(/\W/g, '')}@example.edu`,
    active,
    roles: roles.map(([role, is_primary]) => ({ role, is_primary: is_primary ? 1 : 0 })),
  };
}

// Mirrors the real shape this was written for: two people who may each book or
// cancel, two in accounts payable, and one person holding two roles at once.
const DEB = contact(1, 'Deb', [['booking', true], ['signatory', true]]);
const TRINA = contact(2, 'Trina', [['booking', false]]);
const STEPHEN = contact(3, 'Stephen', [['ap', true]]);
const CRAIG = contact(4, 'Craig', [['ap', false]]);
const ALL = [DEB, TRINA, STEPHEN, CRAIG];

const names = (cs: { name: string }[]) => cs.map((c) => c.name).sort();

describe('resolveRecipients', () => {
  it('addresses an invoice to accounts payable, never to the booking contacts', () => {
    const env = resolveRecipients('invoice', ALL);
    expect(names(env.to)).toEqual(['Stephen']);
    expect(names(env.cc)).toEqual(['Craig']);
    // The booking contacts are a valid address for a cancellation and an
    // invalid one for an invoice. An invoice sent to them is misaddressed.
    expect(names([...env.to, ...env.cc])).not.toContain('Deb');
  });

  it('copies the rest of the role rather than dropping them', () => {
    // Either booking contact can bind the client, so a confirmation only one of
    // them sees leaves the other unaware of a commitment they could have made.
    const env = resolveRecipients('cancellation_confirmation', ALL, { triggeredBy: TRINA.id });
    expect(names(env.to)).toEqual(['Trina']);
    expect(names(env.cc)).toEqual(['Deb']);
  });

  it('replies to whoever actually wrote, not to the configured primary', () => {
    const env = resolveRecipients('booking_confirmation', ALL, { triggeredBy: TRINA.id });
    // Deb is primary, but Trina sent the request. Replying to Deb instead would
    // strand the thread.
    expect(names(env.to)).toEqual(['Trina']);
  });

  it('falls back to the primary when nothing triggered the message', () => {
    const env = resolveRecipients('booking_confirmation', ALL);
    expect(names(env.to)).toEqual(['Deb']);
    expect(names(env.cc)).toEqual(['Trina']);
  });

  it('addresses the whole role when no primary is set', () => {
    // Better to mail both than to silently address nobody.
    const noPrimary = [contact(9, 'Ann', [['ap', false]]), contact(10, 'Bo', [['ap', false]])];
    const env = resolveRecipients('invoice', noPrimary);
    expect(names(env.to)).toEqual(['Ann', 'Bo']);
    expect(env.cc).toHaveLength(0);
  });

  it('never writes to a deactivated contact', () => {
    // Deactivated contacts are retained so old messages still resolve to a
    // person -- not so we keep emailing someone who has left.
    const gone = contact(5, 'Former', [['ap', true]], 0);
    const env = resolveRecipients('invoice', [...ALL, gone]);
    expect(names([...env.to, ...env.cc])).not.toContain('Former');
  });

  it('still resolves a deactivated contact as the trigger without mailing them', () => {
    const gone = contact(6, 'Gone', [['booking', false]], 0);
    const env = resolveRecipients('cancellation_confirmation', [DEB, TRINA, gone], {
      triggeredBy: gone.id,
    });
    // They triggered it but cannot receive it, so the message still goes to the
    // live holders of the role rather than nowhere.
    expect(names([...env.to, ...env.cc])).not.toContain('Gone');
    expect(env.to.length).toBeGreaterThan(0);
  });

  it('bccs the operator so the record outlives the app', () => {
    const env = resolveRecipients('invoice', ALL, { operatorEmail: 'op@example.com' });
    expect(env.bcc).toEqual(['op@example.com']);
    // BCC, not CC: the client must not see a self-addressed copy.
    expect(names(env.cc)).not.toContain('op@example.com');
  });

  it('flags an empty To rather than composing a message addressed to nobody', () => {
    const env = resolveRecipients('invoice', [DEB, TRINA]); // nobody in AP
    expect(missingRecipients(env)).toBe(true);
    // Most transports accept an empty To and cheerfully deliver to no one.
  });

  it('treats a person holding two roles as one contact, not two', () => {
    const env = resolveRecipients('booking_confirmation', ALL);
    expect(env.to.concat(env.cc).filter((c) => c.name === 'Deb')).toHaveLength(1);
  });
});
