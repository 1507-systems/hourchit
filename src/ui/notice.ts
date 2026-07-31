import { esc } from './html';
import { layout } from './layout';
import { formatCents } from '../domain/money';
import { describeDuration } from '../domain/duration';
import { parseMinimumCallOut } from '../domain/terms';

/**
 * A letter giving notice that billing terms are changing.
 *
 * WHY THE APP WRITES THIS RATHER THAN JUST STORING THE DATE. Recording a term
 * version is a bookkeeping act; it changes what future invoices say and nothing
 * else. The CONTRACT requires that the client be told, in writing, a set number
 * of days beforehand. Nothing in a database can do that, and the gap between
 * "the system knows" and "the client was told" is precisely where a disputed
 * invoice is lost -- the operator is certain they mentioned it, and has no
 * paper.
 *
 * So the page produces the paper, in the two forms that constitute service:
 * something to email, and something to print and post. It deliberately does not
 * claim to have sent anything.
 */

export interface NoticeTerms {
  incrementMinutes: number;
  /** Stored form: minutes, or {"weekday":n,"weekend":n}. */
  minimum: string;
  mileageCents: number;
  mileageBillable: boolean;
}

export interface NoticeView {
  business: { name: string; address: string; email: string; phone: string };
  /** Today, written out, as the date the letter is served. */
  todayLabel: string;
  /** The date the change bites, written out. */
  effectiveLabel: string;
  noticeDays: number;
  /** Whole days between today and the effective date, so short notice is visible. */
  daysGiven: number;

  before: NoticeTerms | null;
  after: NoticeTerms;
  note: string;

  /** Addressee, when one has been chosen. */
  recipient: { id: number; name: string; address: string; email: string } | null;
  /** Everyone the letter could be addressed to. */
  customers: Array<{ id: number; name: string }>;
  versionId: number;
}

function describeMinimum(stored: string): string {
  try {
    const m = parseMinimumCallOut(stored);
    if (typeof m === 'number') return describeDuration(m);
    return `${describeDuration(m.weekday)} on weekdays, ${describeDuration(m.weekend)} at weekends`;
  } catch {
    return stored;
  }
}

function describeTerms(t: NoticeTerms): string[] {
  return [
    `Billing increment: ${t.incrementMinutes} minutes, rounded up`,
    `Minimum call-out: ${describeMinimum(t.minimum)}`,
    `Mileage: ${formatCents(t.mileageCents, 'USD')} per mile${t.mileageBillable ? '' : ' (recorded, not charged)'}`,
  ];
}

/** The letter as plain text, for the clipboard and for a mail client. */
export function noticeText(v: NoticeView): string {
  const lines: string[] = [];
  lines.push(v.business.name, ...v.business.address.split('\n'), '', v.todayLabel, '');
  if (v.recipient) {
    lines.push(v.recipient.name, ...v.recipient.address.split('\n'), '');
  }
  lines.push('NOTICE OF CHANGE TO BILLING TERMS', '');
  lines.push(
    `This is written notice that the billing terms of our agreement will change with effect from ` +
      `${v.effectiveLabel}. Work performed before that date is unaffected and will be invoiced at the ` +
      `terms currently in force.`,
    '',
  );
  if (v.before) {
    lines.push('Current terms:', ...describeTerms(v.before).map((s) => `  - ${s}`), '');
  }
  lines.push(`Terms from ${v.effectiveLabel}:`, ...describeTerms(v.after).map((s) => `  - ${s}`), '');
  if (v.note.trim()) lines.push(v.note.trim(), '');
  lines.push(
    'Please contact us if you would like to discuss this.',
    '',
    v.business.name,
    v.business.email,
    v.business.phone,
  );
  return lines.join('\n');
}

export function renderNotice(v: NoticeView): string {
  const text = noticeText(v);
  const subject = `Notice of change to billing terms, effective ${v.effectiveLabel}`;
  const mailto = `mailto:${encodeURIComponent(v.recipient?.email ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

  const short = v.daysGiven < v.noticeDays;

  const options = v.customers
    .map(
      (c) =>
        `<option value="${c.id}"${v.recipient?.id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`,
    )
    .join('');

  const termsList = (t: NoticeTerms): string =>
    `<ul>${describeTerms(t)
      .map((s) => `<li>${esc(s)}</li>`)
      .join('')}</ul>`;

  return layout({
    title: 'Notice of changed terms',
    business: v.business.name,
    body: `<div class="noprint">
  <h1>Notice of changed terms</h1>

  <div class="card">
    <h2>How to serve this</h2>
    <p class="muted">Send it <strong>by email and by post</strong>, not one or the other. Email is what the
      client will actually read; the posted copy is what survives a dispute, because a mail server log is the
      operator's own record and an email that was never opened is easy to deny. If the change is likely to be
      argued about — a rate rise, a new minimum — post it <strong>certified with return receipt</strong>, and
      keep the receipt with the signed agreement. Most contracts that specify a notice period also specify
      what counts as service; check yours before relying on email alone.</p>
    <p class="muted">HourChit does not send this for you. Nothing here records that notice was given —
      put the date you served it in the version's note so the two can be read together later.</p>
    ${
      short
        ? `<p class="flash err"><strong>This is short notice.</strong> The effective date is
             ${v.daysGiven} day${v.daysGiven === 1 ? '' : 's'} away and the contract requires ${v.noticeDays}.
             Serving it now does not make it valid; move the effective date instead.</p>`
        : `<p class="muted">Served today, this gives ${v.daysGiven} days' notice against the
             ${v.noticeDays} the contract requires.</p>`
    }
  </div>

  <div class="card">
    <h2>Address it</h2>
    <form method="get" class="row">
      <label style="flex:2">Recipient
        <select name="customer" onchange="this.form.submit()">
          <option value="">— not addressed —</option>
          ${options}
        </select></label>
      <button type="submit" class="secondary" style="flex:0 0 auto">Show</button>
    </form>
    <p class="muted">Terms are tenant-wide, so every client under them needs their own copy.
      Pick each in turn and send one letter per client.</p>
  </div>

  <div class="card">
    <h2>Send or print</h2>
    <div class="row">
      <a class="btnlink" href="${esc(mailto)}"><button type="button" style="width:100%">Open in email</button></a>
      <button type="button" class="secondary" onclick="window.print()">Print or save PDF</button>
      <button type="button" class="secondary" id="copy">Copy the text</button>
    </div>
    <p class="muted">"Open in email" hands the letter to your own mail client, so the sent copy lands in
      your mailbox where you can find it again. "Print or save PDF" gives you the copy to post.</p>
  </div>
</div>

<div class="card">
  <p><strong>${esc(v.business.name)}</strong><br>${esc(v.business.address).replace(/\n/g, '<br>')}</p>
  <p>${esc(v.todayLabel)}</p>
  ${
    v.recipient
      ? `<p>${esc(v.recipient.name)}<br>${esc(v.recipient.address).replace(/\n/g, '<br>')}</p>`
      : '<p class="muted noprint">Not addressed to anyone yet — choose a recipient above.</p>'
  }

  <h2>Notice of change to billing terms</h2>

  <p>This is written notice that the billing terms of our agreement will change with effect from
    <strong>${esc(v.effectiveLabel)}</strong>. Work performed before that date is unaffected and will be
    invoiced at the terms currently in force.</p>

  ${v.before ? `<p><strong>Current terms</strong></p>${termsList(v.before)}` : ''}
  <p><strong>Terms from ${esc(v.effectiveLabel)}</strong></p>
  ${termsList(v.after)}

  ${v.note.trim() ? `<p>${esc(v.note.trim())}</p>` : ''}

  <p>Please contact us if you would like to discuss this.</p>

  <p>${esc(v.business.name)}<br>${esc(v.business.email)}<br>${esc(v.business.phone)}</p>
</div>

<pre id="noticetext" hidden>${esc(text)}</pre>

<script>
(function () {
  var btn = document.getElementById('copy');
  var src = document.getElementById('noticetext');
  if (!btn || !src) return;
  btn.addEventListener('click', function () {
    var done = function () {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = 'Copy the text'; }, 1600);
    };
    // Clipboard needs a secure context; fall back rather than doing nothing
    // visible, because a copy button that silently fails looks like it worked.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(src.textContent).then(done, fallback);
    } else { fallback(); }
    function fallback() {
      src.hidden = false;
      var r = document.createRange(); r.selectNodeContents(src);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = 'Select and copy above'; }
    }
  });
})();
</script>`,
  });
}
