import { esc } from './html';
import { layout } from './layout';
import type { Invoice } from '../db';
import type { MailAppDraft } from '../mail/invoice-composition';

/**
 * "Send with your mail app": composes the invoice email in the operator's own
 * mail client rather than HourChit sending it.
 *
 * Browser-only. The native iOS shell never navigates here at all -- it
 * intercepts the "Compose invoice email" button on the invoice page itself
 * and calls `window.native.composeMail` directly with the full hosted-quality
 * body and the PDF genuinely attached (see `invoice.ts` and the
 * `/invoices/:id/mail-app/compose` route). A plain browser has no such
 * capability: it cannot attach a file to a mailto: draft and cannot confirm
 * anything the mail app does afterward, so this page does the two things it
 * honestly can -- open a pre-filled draft, and hand over the PDF to attach by
 * hand. Neither path marks the invoice sent on its own -- only the operator
 * saying so does that, because nothing here can detect whether the mail
 * actually went.
 */

export interface InvoiceMailAppView {
  business: string;
  invoice: Invoice;
  customerName: string;
  /** Null when the client record has no billing email; the operator can still fill it in themselves. */
  to: string | null;
  draft: MailAppDraft;
  mailtoHref: string;
  /** Set when this invoice already has a mark-sent record. */
  alreadySent: { at: string; method: string } | null;
}

export function renderInvoiceMailApp(v: InvoiceMailAppView, flash = ''): string {
  return layout({
    title: `Send ${v.invoice.number}`,
    business: v.business,
    body: `<h1>Send invoice ${esc(v.invoice.number)} with your mail app</h1>
${flash}

<div class="card">
  <p class="flash err"><strong>HourChit does not send this one.</strong> A browser can open a
    pre-filled draft in your mail app, but it cannot attach the PDF for you and cannot see
    whether you actually hit send. Do the three steps below, then confirm it went out.</p>
</div>

${
  !v.to
    ? `<div class="card">
    <p class="flash err"><strong>${esc(v.customerName)} has no billing email address on file.</strong>
      The draft below opens with the "To" field blank — add one on the client record so it
      fills in next time, or type the address in yourself.</p>
  </div>`
    : ''
}

${
  v.alreadySent
    ? `<div class="card">
    <p class="flash err"><strong>Already marked sent</strong> on
      ${esc(v.alreadySent.at.slice(0, 16).replace('T', ' '))} by ${esc(v.alreadySent.method)}.
      Confirming again overwrites that record with today's date -- only do this if the first
      confirmation was a mistake or the invoice genuinely went out a second time.</p>
  </div>`
    : ''
}

<div class="card">
  <h2>1. Download the PDF</h2>
  <p class="muted">Save it somewhere you can find it in the next step.</p>
  <a href="/invoices/${v.invoice.id}/pdf" target="_blank" style="text-decoration:none">
    <button type="button" class="secondary">Download PDF</button></a>
</div>

<div class="card">
  <h2>2. Open the draft</h2>
  <table><tbody>
    <tr><td>To</td><td class="num"><strong>${v.to ? esc(v.to) : '<em>blank — fill in</em>'}</strong></td></tr>
    <tr><td>Subject</td><td class="num">${esc(v.draft.subject)}</td></tr>
  </tbody></table>
  <p class="muted" style="white-space:pre-wrap">${esc(v.draft.body)}</p>
  <a href="${v.mailtoHref}" style="text-decoration:none">
    <button type="button">Open in your mail app</button></a>
</div>

<div class="card">
  <h2>3. Attach the PDF and send</h2>
  <p class="muted">Attach the file you downloaded in step 1, then send it the way you normally would.</p>
</div>

<div class="card">
  <h2>Then confirm it went out</h2>
  <p class="muted">This is the only thing that marks the invoice sent — HourChit has no way to
    tell on its own.</p>
  <form method="post" action="/invoices/${v.invoice.id}/send">
    <input type="hidden" name="method" value="mail_app">
    ${
      v.alreadySent
        ? `<label><input type="checkbox" name="confirmResend" value="1" required style="width:auto">
             Yes, overwrite the existing sent record with today's date</label>`
        : ''
    }
    <button type="submit">I sent this invoice</button>
  </form>
</div>

<p><a href="/invoices/${v.invoice.id}">Back to the invoice</a></p>`,
  });
}
