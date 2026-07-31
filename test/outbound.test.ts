import { describe, expect, it, vi } from 'vitest';
import { loginCodeMessage, sendMail, threadingHeaders } from '../src/mail/send';

describe('threadingHeaders', () => {
  it('emits nothing when there is no parent', () => {
    expect(threadingHeaders({ to: 'a@b.test', subject: 's', text: 't' })).toEqual({});
  });

  it('sets In-Reply-To to the direct parent and seeds References', () => {
    expect(
      threadingHeaders({ to: 'a@b.test', subject: 's', text: 't', inReplyTo: '<p1@x>' }),
    ).toEqual({ 'In-Reply-To': '<p1@x>', References: '<p1@x>' });
  });

  it('accumulates the chain oldest first, which is what clients walk', () => {
    const h = threadingHeaders({
      to: 'a@b.test',
      subject: 's',
      text: 't',
      inReplyTo: '<p3@x>',
      references: '<p1@x> <p2@x>',
    });
    expect(h.References).toBe('<p1@x> <p2@x> <p3@x>');
    expect(h['In-Reply-To']).toBe('<p3@x>');
  });

  it('does not repeat an id already in the chain', () => {
    const h = threadingHeaders({
      to: 'a@b.test',
      subject: 's',
      text: 't',
      inReplyTo: '<p2@x>',
      references: '<p1@x> <p2@x>',
    });
    expect(h.References).toBe('<p1@x> <p2@x>');
  });

  it('caps the chain at 100, keeping the NEWEST', () => {
    // Cloudflare rejects a reply with more than 100 References entries, to stop
    // loops. Keeping the newest is right: those are the ids a client actually
    // matches a conversation against.
    const many = Array.from({ length: 130 }, (_, i) => `<old${i}@x>`).join(' ');
    const h = threadingHeaders({
      to: 'a@b.test',
      subject: 's',
      text: 't',
      inReplyTo: '<newest@x>',
      references: many,
    });
    const ids = h.References.split(' ');
    expect(ids).toHaveLength(100);
    expect(ids[ids.length - 1]).toBe('<newest@x>');
    expect(ids).not.toContain('<old0@x>');
  });
});

describe('sendMail', () => {
  it('returns the Message-ID the binding assigned', async () => {
    // This is what makes a reply thread back: the recipient's client puts this
    // id in In-Reply-To, and inbound matching only works on ids we recorded.
    const binding = { send: vi.fn(async () => ({ messageId: '<assigned@x>' })) };
    const res = await sendMail(binding, 'me@x.test', { to: 'you@y.test', subject: 's', text: 't' });
    expect(res.messageId).toBe('<assigned@x>');
  });

  it('reports null rather than inventing an id when the binding gives none', async () => {
    const binding = { send: vi.fn(async () => undefined) };
    const res = await sendMail(binding, 'me@x.test', { to: 'you@y.test', subject: 's', text: 't' });
    expect(res.messageId).toBeNull();
  });

  it('passes threading headers through to the binding', async () => {
    const binding = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    await sendMail(binding, 'me@x.test', {
      to: 'you@y.test',
      subject: 's',
      text: 't',
      inReplyTo: '<parent@x>',
    });
    expect(binding.send).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'In-Reply-To': '<parent@x>', References: '<parent@x>' } }),
    );
  });

  it('omits the headers key entirely for a fresh message', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const binding = {
      send: async (m: Record<string, unknown>) => {
        sent.push(m);
        return { messageId: '<m@x>' };
      },
    };
    await sendMail(binding, 'me@x.test', { to: 'you@y.test', subject: 's', text: 't' });
    expect(sent[0]).not.toHaveProperty('headers');
  });

  it('throws rather than silently dropping mail when unconfigured', async () => {
    await expect(
      sendMail(undefined, 'me@x.test', { to: 'a@b.test', subject: 's', text: 't' }),
    ).rejects.toThrow(/not configured/);
    await expect(
      sendMail({ send: vi.fn() }, undefined, { to: 'a@b.test', subject: 's', text: 't' }),
    ).rejects.toThrow(/not configured/);
  });
});

describe('loginCodeMessage', () => {
  it('puts the code in the subject so it reads from a lock screen', () => {
    const m = loginCodeMessage('op@x.test', '123456', 'Tarnsby A/V Services LLC');
    expect(m.subject).toContain('123456');
    expect(m.text).toContain('123456');
    expect(m.to).toBe('op@x.test');
  });

  it('contains no link, so the code cannot be phished by forwarding', () => {
    const m = loginCodeMessage('op@x.test', '123456', 'X');
    expect(m.text).not.toMatch(/https?:\/\//);
  });
});
