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
 * anything the mail app does afterward, so this page copies the full email body, opens a draft,
 * and hands over the PDF to attach by hand. Neither path marks the invoice sent on its own -- only the operator
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
  <p>Send from your own email account using the steps below. The email body contains the
    same invoice details as HourChit's direct send. Attach the downloaded PDF before sending.</p>
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
  <p class="muted">Save the invoice PDF, then attach that file to your email in step 3.</p>
  <a href="/invoices/${v.invoice.id}/pdf?download=1" target="_blank" rel="noopener" style="text-decoration:none">
    <button type="button" class="secondary">Download PDF</button></a>
</div>

<div class="card">
  <h2>2. Copy the email body</h2>
  <table><tbody>
    <tr><td>To</td><td class="num"><strong>${v.to ? esc(v.to) : '<em>blank — fill in</em>'}</strong></td></tr>
    <tr><td>Subject</td><td class="num">${esc(v.draft.subject)}</td></tr>
  </tbody></table>
  <label for="email-body-text">Email body</label>
  <textarea id="email-body-text" readonly rows="12" style="width:100%;box-sizing:border-box">${esc(v.draft.body)}</textarea>
  <textarea id="email-body-html" hidden aria-hidden="true">${esc(v.draft.html)}</textarea>
  <button type="button" id="copy-email-body">Copy body</button>
  <p id="email-copy-status" role="status" aria-live="polite">Copies formatting where supported, with a plain-text version for other mail clients.</p>
  <noscript><p>Select the email body above and copy it using your device's Copy command.</p></noscript>
</div>

<div class="card">
  <h2>3. Open your email, paste and attach</h2>
  <a href="${esc(v.mailtoHref)}" class="btnlink">Open in your mail app</a>
  <p>Paste the copied body into the message, attach the PDF from step 1, check the recipient and send.</p>
  <p class="muted">The recipient and subject are filled in when your mail app supports email links.
    If nothing opens, start a message yourself using the recipient and subject shown above.</p>
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
    <button type="submit">Mark as sent manually</button>
  </form>
</div>

<p><a href="/invoices/${v.invoice.id}">Back to the invoice</a></p>
<script>
(function () {
  var button = document.getElementById('copy-email-body');
  var text = document.getElementById('email-body-text');
  var html = document.getElementById('email-body-html');
  var status = document.getElementById('email-copy-status');
  button.addEventListener('click', async function () {
    button.disabled = true;
    try {
      var copied = false;
      if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        try {
          await navigator.clipboard.write([new ClipboardItem({
            'text/plain': new Blob([text.value], { type: 'text/plain' }),
            'text/html': new Blob([html.value], { type: 'text/html' })
          })]);
          copied = true;
        } catch (_) { /* Unsupported rich clipboard: try plain text next. */ }
      }
      if (!copied) {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text.value);
      }
      status.textContent = 'Body copied. Paste it into your email, then attach the downloaded PDF.';
    } catch (_) {
      text.focus();
      text.select();
      text.setSelectionRange(0, text.value.length);
      status.textContent = 'Automatic copying is unavailable. The body is selected; use your device’s Copy command, then paste it into your email and attach the PDF.';
    } finally {
      button.disabled = false;
    }
  });
})();
</script>`,
  });
}
