import { describe, expect, it } from 'vitest';
import {
  addressList,
  bareAddress,
  matchThread,
  parseReferences,
  resolveSender,
  subjectKey,
  tenantFromAddress,
} from '../src/domain/inbound';

describe('bareAddress', () => {
  it('strips a display name', () => {
    expect(bareAddress('Deb Ryan <deryan@bridgeport.edu>')).toBe('deryan@bridgeport.edu');
  });
  it('lowercases, because mail addresses are compared case-insensitively', () => {
    expect(bareAddress('DeRyan@Bridgeport.EDU')).toBe('deryan@bridgeport.edu');
  });
});

describe('addressList', () => {
  it('splits several addresses', () => {
    expect(addressList('a@x.com, Bob <b@x.com>')).toEqual(['a@x.com', 'b@x.com']);
  });
  it('does not split on a comma inside a quoted display name', () => {
    // "Ryan, Deb" is one recipient. Splitting on the comma invents a second.
    expect(addressList('"Ryan, Deb" <deryan@bridgeport.edu>, t@x.com'))
      .toEqual(['deryan@bridgeport.edu', 't@x.com']);
  });
  it('returns empty for a missing header rather than throwing', () => {
    expect(addressList(null)).toEqual([]);
    expect(addressList('')).toEqual([]);
  });
});

describe('tenantFromAddress', () => {
  const D = 'hosted.hourchit.app';
  it('extracts the tenant', () => {
    expect(tenantFromAddress('mattsav@hosted.hourchit.app', D)).toBe('mattsav');
  });
  it('strips subaddressing, which Cloudflare delivers to the base rule', () => {
    expect(tenantFromAddress('mattsav+booking@hosted.hourchit.app', D)).toBe('mattsav');
  });
  it('rejects another domain, so one tenant cannot be addressed via another zone', () => {
    expect(tenantFromAddress('mattsav@evil.example', D)).toBeNull();
  });
  it('rejects the apex, which is HourChit\'s own mail and not a tenant', () => {
    expect(tenantFromAddress('billing@hourchit.app', D)).toBeNull();
  });
  it('is case insensitive on the domain', () => {
    expect(tenantFromAddress('MattsAV@Hosted.HourChit.App', D)).toBe('mattsav');
  });
});

describe('subjectKey', () => {
  it('strips a single reply prefix', () => {
    expect(subjectKey('Re: Commencement')).toBe('commencement');
  });
  it('strips stacked and mixed prefixes', () => {
    // Left alone, a five-message exchange becomes five separate threads.
    expect(subjectKey('Re: Fwd: RE: Commencement')).toBe('commencement');
  });
  it('handles the numbered form some clients emit', () => {
    expect(subjectKey('Re[2]: Commencement')).toBe('commencement');
  });
  it('collapses whitespace so wrapped subjects still match', () => {
    expect(subjectKey('Re:  Commencement   2027')).toBe('commencement 2027');
  });
  it('survives an empty subject', () => {
    expect(subjectKey('')).toBe('');
  });
});

describe('parseReferences', () => {
  it('extracts ids in order', () => {
    expect(parseReferences('<a@x> <b@x>')).toEqual(['<a@x>', '<b@x>']);
  });
  it('tolerates a missing header', () => {
    expect(parseReferences(undefined)).toEqual([]);
  });
});

describe('matchThread', () => {
  const known = new Map<string, number>([['<first@ub>', 7]]);
  const candidates = [{ id: 9, customer_id: 1, subject_key: 'commencement' }];

  it('prefers In-Reply-To over subject', () => {
    // The subject would match thread 9, but In-Reply-To says 7. A statement
    // beats a guess.
    const t = matchThread({
      inReplyTo: '<first@ub>',
      subject: 'Re: Commencement',
      customerId: 1,
      knownMessageThread: known,
      candidatesBySubject: candidates,
    });
    expect(t).toBe(7);
  });

  it('walks References from the nearest ancestor backwards', () => {
    const t = matchThread({
      references: '<unknown@x> <first@ub>',
      subject: 'something else entirely',
      customerId: 1,
      knownMessageThread: known,
      candidatesBySubject: candidates,
    });
    expect(t).toBe(7);
  });

  it('falls back to subject when the client dropped the reference headers', () => {
    const t = matchThread({
      subject: 'RE: Commencement',
      customerId: 1,
      knownMessageThread: known,
      candidatesBySubject: candidates,
    });
    expect(t).toBe(9);
  });

  it('never joins threads across customers on subject alone', () => {
    // Two clients can both send "Invoice question". They are not one conversation.
    const t = matchThread({
      subject: 'Commencement',
      customerId: 2,
      knownMessageThread: known,
      candidatesBySubject: candidates,
    });
    expect(t).toBeNull();
  });

  it('starts a new thread when the subject is empty rather than lumping them', () => {
    const t = matchThread({
      subject: '   ',
      customerId: 1,
      knownMessageThread: known,
      candidatesBySubject: [{ id: 9, customer_id: 1, subject_key: '' }],
    });
    expect(t).toBeNull();
  });
});

describe('resolveSender', () => {
  const contacts = [
    { id: 1, customer_id: 5, email: 'deryan@bridgeport.edu' },
    { id: 2, customer_id: 5, email: 'trhender@bridgeport.edu' },
  ];

  it('attributes a known sender to their contact and customer', () => {
    expect(resolveSender('Deb Ryan <deryan@bridgeport.edu>', contacts))
      .toEqual({ contactId: 1, customerId: 5 });
  });

  it('matches case-insensitively', () => {
    expect(resolveSender('DERYAN@BRIDGEPORT.EDU', contacts).contactId).toBe(1);
  });

  it('returns nulls for an unknown sender rather than guessing a customer', () => {
    // Unknown mail is still stored -- it is attributed to nobody, not discarded.
    expect(resolveSender('stranger@example.com', contacts))
      .toEqual({ contactId: null, customerId: null });
  });

  it('still attributes a DEACTIVATED contact', () => {
    // The caller passes deactivated contacts in on purpose: a cancellation sent
    // in March by someone who left in June must remain attributable, because
    // that attribution is the evidence the cancellation was valid.
    const withGone = [...contacts, { id: 3, customer_id: 5, email: 'gone@bridgeport.edu' }];
    expect(resolveSender('gone@bridgeport.edu', withGone).contactId).toBe(3);
  });
});
