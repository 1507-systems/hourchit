import { esc } from './html';
import { layout } from './layout';
import { formatCents } from '../domain/money';
import type { Invoice } from '../db';

/**
 * The confirmation step before an invoice leaves the building.
 *
 * A FULL PAGE RATHER THAN A JAVASCRIPT confirm(). Bryce asked for a confirm,
 * and a dialog reading "Send this invoice?" answers the wrong question: the
 * operator already knows they clicked send. What they cannot see from the
 * button is WHO IT GOES TO, and the address is the part that is actually wrong
 * sometimes -- a stale contact, a typo made months ago on the client record, a
 * personal address where accounts payable was meant. So the page shows the
 * recipient, the amount and the subject, which is what makes the confirmation
 * worth stopping for.
 *
 * It is also a GET, so it survives a refresh and can be linked to. A modal
 * cannot be reasoned about after the fact; a page can be screenshotted into a
 * bug report.
 */

export interface InvoiceSendView {
  business: string;
  invoice: Invoice;
  customerName: string;
  /** Where it will go. Null when the client record has no billing email. */
  to: string | null;
  from: string;
  subject: string;
  /** The rendered email, shown as-is so nothing goes out unseen. */
  previewHtml: string;
  /** Set when this invoice has already been sent once. */
  alreadySent: { at: string; method: string } | null;
}

export function renderInvoiceSend(v: InvoiceSendView, flash = ''): string {
  const money = formatCents(v.invoice.total_cents, v.invoice.currency);

  if (!v.to) {
    return layout({
      title: `Send ${v.invoice.number}`,
      business: v.business,
      body: `<h1>Send invoice ${esc(v.invoice.number)}</h1>
${flash}
<div class="card">
  <p class="flash err"><strong>${esc(v.customerName)} has no billing email address.</strong>
    Add one on the client record, then come back — there is nowhere to send this yet.</p>
  <p><a class="btnlink" href="/clients/${v.invoice.customer_id}"><button type="button">Edit ${esc(v.customerName)}</button></a></p>
  <p><a href="/invoices/${v.invoice.id}">Back to the invoice</a></p>
</div>`,
    });
  }

  return layout({
    title: `Send ${v.invoice.number}`,
    business: v.business,
    body: `<h1>Send invoice ${esc(v.invoice.number)}</h1>
${flash}

${
  v.alreadySent
    ? `<div class="card">
    <p class="flash err"><strong>This invoice has already been sent.</strong>
      It went out on ${esc(v.alreadySent.at.slice(0, 16).replace('T', ' '))} by
      ${esc(v.alreadySent.method)}. Sending it again means ${esc(v.customerName)} receives a second
      copy of the same invoice number — which reads as either a duplicate charge or a chase, and
      accounts payable departments treat those very differently. Send again only if you know the
      first one did not arrive.</p>
  </div>`
    : ''
}

<div class="card">
  <h2>Check before it goes</h2>
  <table><tbody>
    <tr><td>To</td><td class="num"><strong>${esc(v.to)}</strong></td></tr>
    <tr><td>From</td><td class="num">${esc(v.from)}</td></tr>
    <tr><td>Subject</td><td class="num">${esc(v.subject)}</td></tr>
    <tr><td>Amount</td><td class="num"><strong>${esc(money)}</strong></td></tr>
  </tbody></table>
  <p class="muted">The invoice is in the body of the email rather than behind a link or an
    attachment, so the recipient can read the whole thing without clicking anything. An unexpected
    email with an amount and a link to a domain nobody recognises is what invoice fraud looks like.</p>

  <form method="post" action="/invoices/${v.invoice.id}/email">
    ${
      v.alreadySent
        ? `<label><input type="checkbox" name="confirmResend" value="1" required style="width:auto">
             Yes, send ${esc(v.customerName)} a second copy of ${esc(v.invoice.number)}</label>`
        : ''
    }
    <div class="row" style="margin-top:.8rem">
      <button type="submit">${v.alreadySent ? 'Send again' : 'Send it'}</button>
      <a class="btnlink" href="/invoices/${v.invoice.id}" style="flex:0 0 auto">
        <button type="button" class="secondary" style="width:auto">Cancel</button></a>
    </div>
  </form>
</div>

<div class="card">
  <h2>What they will see</h2>
  <div style="background:#fff;border:1px solid var(--line);border-radius:.4rem;overflow-x:auto">
    ${v.previewHtml}
  </div>
</div>`,
  });
}
