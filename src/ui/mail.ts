import { esc } from './html';

/**
 * The mail views.
 *
 * DELIBERATELY TRANSACTIONAL, NOT A MAIL CLIENT. There is no folder tree, no
 * search, no rich composer, no read/unread state and no bulk actions. The
 * operator already has a mail app and it is better than anything shipped here
 * would be. What this gives them is the one thing their mail app cannot: a
 * reply that is RECORDED AGAINST THE JOB, so the conversation that agreed a
 * booking, or cancelled one, sits with the booking rather than in a personal
 * inbox nobody else can reach.
 *
 * A tenant that would rather live entirely in their own mail server can: the
 * inbound record is kept either way, and replying from their own client still
 * threads. This view is the convenient path, not the required one.
 */

export interface ThreadSummary {
  id: number;
  subject: string;
  last_message_at: string;
  message_count: number;
  inbound_count: number;
}

export interface MessageView {
  id: number;
  direction: string;
  from_addr: string;
  subject: string;
  body_text: string;
  body_is_derived: number;
  received_at: string;
  attachment_count: number;
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · HourChit</title>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">
<style>
body{font-family:system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem;color:#111}
a{color:#1f6feb}
.row{display:block;padding:.7rem .2rem;border-bottom:1px solid #eee;text-decoration:none;color:inherit}
.row:hover{background:#fafafa}
.subj{font-weight:600}
.meta{color:#666;font-size:.85rem}
.msg{border:1px solid #e5e5e5;border-radius:.5rem;padding:.8rem;margin:.8rem 0}
.msg.out{background:#f4f8ff;border-color:#d6e4ff}
.msg pre{white-space:pre-wrap;word-wrap:break-word;font:inherit;margin:.5rem 0 0}
.tag{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#666}
.derived{color:#8a6d000;background:#fff8e1;border:1px solid #ffe8a3;color:#7a5d00;
  font-size:.75rem;padding:.15rem .4rem;border-radius:.25rem}
textarea{width:100%;box-sizing:border-box;font:inherit;padding:.6rem;min-height:7rem}
button{font-size:1rem;padding:.6rem 1rem;background:#1f6feb;color:#fff;border:0;border-radius:.4rem}
.empty{color:#666;padding:2rem 0}
.err{color:#c00}.ok{color:#0a7}
</style></head><body>
${body}
</body></html>`;
}

export function renderMailList(threads: ThreadSummary[], flash = ''): string {
  const rows = threads.length
    ? threads
        .map(
          (t) => `<a class="row" href="/mail/${t.id}">
  <div class="subj">${esc(t.subject || '(no subject)')}</div>
  <div class="meta">${t.message_count} message${t.message_count === 1 ? '' : 's'}
    · last ${esc(t.last_message_at)}</div>
</a>`,
        )
        .join('\n')
    : `<p class="empty">No mail yet. Messages sent to this tenant's address appear here.</p>`;

  return shell(
    'Mail',
    `<p><a href="/">&larr; Dashboard</a></p>
<h1>Mail</h1>
${flash}
${rows}`,
  );
}

export function renderThread(
  threadId: number,
  subject: string,
  messages: MessageView[],
  replyTo: string,
  flash = '',
): string {
  const items = messages
    .map(
      (m) => `<div class="msg ${m.direction === 'outbound' ? 'out' : ''}">
  <div class="tag">${m.direction === 'outbound' ? 'Sent' : 'Received'} ·
    ${esc(m.from_addr)} · ${esc(m.received_at)}
    ${m.attachment_count > 0 ? `· ${m.attachment_count} attachment${m.attachment_count === 1 ? '' : 's'}` : ''}
    ${m.body_is_derived ? '<span class="derived">text rebuilt from HTML</span>' : ''}
  </div>
  <pre>${esc(m.body_text || '(no text body)')}</pre>
</div>`,
    )
    .join('\n');

  // Replies go to whoever last wrote in, which for a transactional thread is
  // the only sensible target. No recipient field: choosing an arbitrary
  // recipient is what turns this into a mail client, and a send-anywhere box
  // inside a billing app is a spam vector as much as a feature.
  const composer = replyTo
    ? `<h2>Reply</h2>
<form method="post" action="/mail/${threadId}/reply">
  <p class="meta">To ${esc(replyTo)}</p>
  <textarea name="body" required placeholder="Type a short reply…"></textarea>
  <button type="submit">Send</button>
</form>`
    : `<p class="empty">Nothing to reply to in this thread yet.</p>`;

  return shell(
    subject || 'Thread',
    `<p><a href="/mail">&larr; Mail</a></p>
<h1>${esc(subject || '(no subject)')}</h1>
${flash}
${items}
${composer}`,
  );
}
