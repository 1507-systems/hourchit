import { esc } from './html';
import { layout } from './layout';
import type { Invoice } from '../db';
import type { MailAppDraft } from '../mail/invoice-composition';

/**
 * "Send with your mail app": composes the invoice email in the operator's own
 * mail client rather than HourChit sending it.
 *
 * Inside the native shell, the page hands the draft and the PDF (fetched as
 * base64) to `window.native.composeMail`, which presents the system mail
 * composer with the PDF genuinely attached -- see `NativeBridgeScript` and
 * `TenantWebView` in the hourchit-ios repo. A plain browser cannot attach a
 * file to a mailto: draft and cannot confirm anything the mail app does
 * afterward, so there the page instead does the two things it honestly can:
 * open a pre-filled draft, and hand over the PDF to attach by hand. Neither
 * path marks the invoice sent on its own -- only the operator saying so does
 * that, because nothing here can detect whether the mail actually went.
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

<div class="card" data-mail-app-step="download">
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
  <a id="mailAppOpen" href="${v.mailtoHref}" style="text-decoration:none">
    <button type="button">Open in your mail app</button></a>
</div>

<div class="card" data-mail-app-step="attach">
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

<p><a href="/invoices/${v.invoice.id}">Back to the invoice</a></p>

<span id="mailAppTo" hidden>${esc(v.to ?? '')}</span>
<span id="mailAppSubject" hidden>${esc(v.draft.subject)}</span>
<pre id="mailAppBody" hidden>${esc(v.draft.body)}</pre>
<span id="mailAppPdfUrl" hidden>${esc(`/invoices/${v.invoice.id}/pdf`)}</span>
<span id="mailAppPdfFilename" hidden>${esc(`${v.invoice.number}.pdf`)}</span>

<script>
(function () {
  // A browser has no window.native and keeps the plain mailto: link above,
  // which is the best a browser can honestly do. Inside the native shell,
  // window.native.capabilities.mailCompose means the shell can attach the
  // PDF for real, which is the entire reason this flow is worth being
  // native -- so replace the link's default (unattachable) behavior with a
  // call into it, and drop the two steps that instruction only exists for.
  var native = window.native;
  if (!native || !native.capabilities || !native.capabilities.mailCompose) return;

  var openLink = document.getElementById('mailAppOpen');
  if (!openLink) return;

  ['download', 'attach'].forEach(function (step) {
    var el = document.querySelector('[data-mail-app-step="' + step + '"]');
    if (el) el.hidden = true;
  });

  openLink.addEventListener('click', function (event) {
    event.preventDefault();
    var pdfUrl = document.getElementById('mailAppPdfUrl').textContent;
    fetch(pdfUrl)
      .then(function (response) { return response.blob(); })
      .then(function (blob) {
        var reader = new FileReader();
        reader.onloadend = function () {
          var base64 = String(reader.result).split(',')[1] || '';
          native.composeMail({
            to: document.getElementById('mailAppTo').textContent,
            subject: document.getElementById('mailAppSubject').textContent,
            body: document.getElementById('mailAppBody').textContent,
            pdfBase64: base64,
            pdfFilename: document.getElementById('mailAppPdfFilename').textContent,
          });
        };
        reader.readAsDataURL(blob);
      });
  });
})();
</script>`,
  });
}
