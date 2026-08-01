import { formatCents } from '../domain/money';
import type { Invoice, InvoiceLine } from '../db';

/**
 * The invoice, as an email.
 *
 * WHY THE INVOICE IS IN THE BODY RATHER THAN BEHIND A LINK. Bryce, 2026-07-30,
 * on a link to a hosted copy: "I LIKE the link to invoice but that also feels
 * phishy." He is right, and it is not a matter of taste. An unexpected email
 * from a small vendor, containing a payment amount and a link to a domain the
 * recipient does not recognise, is indistinguishable from an invoice-fraud
 * attempt -- which is one of the most common frauds aimed at accounts payable
 * departments precisely because it works. The reader should be able to see the
 * whole thing without clicking anything.
 *
 * WHY THE HTML IS BUILT SEPARATELY FROM ui/invoice.ts. That page is a web page:
 * its CSS lives in <head>, and Gmail and Outlook discard <head> entirely. Every
 * rule has to be an inline style attribute on the element it applies to, laid
 * out with tables, or the client receives an unstyled column of text. Sharing
 * one renderer between web and email means one of them is silently broken, and
 * it is always the one nobody looks at.
 *
 * A PLAIN TEXT PART IS NOT A COURTESY. Some accounts-payable systems ingest
 * text only, and a message with no text/plain part scores worse with spam
 * filters -- an invoice in the junk folder is an invoice that does not get paid.
 */

export interface InvoiceEmailView {
  invoice: Invoice;
  lines: InvoiceLine[];
  business: { name: string; address: string; email: string; phone: string };
  customer: { name: string };
  /**
   * True when this is going out over HourChit's shared sending domain rather
   * than the tenant's own. Drives the sent-on-behalf-of disclosure; see
   * onBehalfOfText.
   */
  viaHourChit: boolean;
}

/**
 * The sent-on-behalf-of line, and it does real work.
 *
 * A client of Matt's A/V receives an invoice from hosted.hourchit.app -- a
 * domain they have never heard of, on a demand for money. That is the single
 * most suspicious thing about this email, and the fix is not to hide it but to
 * explain it in the same breath, the way every white-labelled service does.
 *
 * The wording is lifted from a Bristlecone/RangeWorks confirmation Bryce
 * received and liked: name the business in BOLD first, because that is who the
 * reader has a relationship with, then say plainly what the platform does. The
 * tenant is the party; HourChit is the plumbing.
 *
 * It appears ONLY when sending over the shared domain. A tenant who has
 * configured their own mail is sending as themselves, and a disclosure naming a
 * vendor who is not in the path would be untrue as well as unnecessary.
 */
export function onBehalfOfText(businessName: string): string {
  return (
    `This message was sent on behalf of ${businessName}. HourChit provides the time tracking, ` +
    'invoicing, and billing services used by the business.'
  );
}

export function invoiceEmailSubject(v: InvoiceEmailView): string {
  // The invoice number leads, because accounts payable file and search by it,
  // and a subject that starts with the vendor name is one of a hundred.
  return `Invoice ${v.invoice.number} from ${v.business.name} — ${formatCents(
    v.invoice.total_cents,
    v.invoice.currency,
  )}`;
}

function period(inv: Invoice): string | null {
  if (!inv.period_start || !inv.period_end) return null;
  return inv.period_start === inv.period_end
    ? inv.period_start
    : `${inv.period_start} – ${inv.period_end}`;
}

export function invoiceEmailText(v: InvoiceEmailView): string {
  const money = (cents: number) => formatCents(cents, v.invoice.currency);
  const out: string[] = [];

  out.push(`${v.business.name}`, ...v.business.address.split('\n'), '');
  out.push(`INVOICE ${v.invoice.number}`, `Issued ${v.invoice.created_at.slice(0, 10)}`);
  const p = period(v.invoice);
  if (p) out.push(`Service period ${p}`);
  out.push('', `Bill to: ${v.customer.name}`, '');

  for (const l of v.lines) {
    // Quantity and rate only where they mean something. A mileage line reading
    // "1 x $0.00" is noise that invites a question.
    const detail = l.rate_cents > 0 ? `  ${l.quantity} ${l.unit} @ ${money(l.rate_cents)}` : '';
    out.push(`${l.description}${detail}`, `    ${money(l.amount_cents)}`);
  }

  out.push('', `TOTAL DUE  ${money(v.invoice.total_cents)}`, '');
  out.push(`Questions: ${v.business.email} · ${v.business.phone}`);
  if (v.viaHourChit) out.push('', '--', onBehalfOfText(v.business.name));
  return out.join('\n');
}

/** Escape for an HTML attribute or text node. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

const CELL = 'padding:8px 6px;border-bottom:1px solid #d0d7de;font-size:14px';
const MUTED = 'color:#656d76;font-size:13px;margin:0';

export function invoiceEmailHtml(v: InvoiceEmailView): string {
  const money = (cents: number) => esc(formatCents(cents, v.invoice.currency));
  const p = period(v.invoice);

  const rows = v.lines
    .map(
      (l) => `<tr>
      <td style="${CELL}">${esc(l.description)}</td>
      <td style="${CELL};text-align:right;white-space:nowrap">${
        l.rate_cents > 0 ? `${esc(String(l.quantity))} ${esc(l.unit)}` : ''
      }</td>
      <td style="${CELL};text-align:right;white-space:nowrap">${
        l.rate_cents > 0 ? money(l.rate_cents) : ''
      }</td>
      <td style="${CELL};text-align:right;white-space:nowrap">${money(l.amount_cents)}</td>
    </tr>`,
    )
    .join('');

  // Colours are fixed light rather than theme-aware: an email is rendered by a
  // client whose theme we cannot query, and a dark-mode rule that half-applies
  // produces grey text on grey. Legible everywhere beats handsome somewhere.
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
  color:#1f2328;background:#ffffff;max-width:640px;margin:0 auto;padding:16px">

  <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:20px">
    <tr>
      <td style="vertical-align:top">
        <div style="font-size:20px;font-weight:700">${esc(v.business.name)}</div>
        <p style="${MUTED}">${esc(v.business.address).replace(/\n/g, '<br>')}</p>
      </td>
      <td style="vertical-align:top;text-align:right">
        <div style="font-size:20px;font-weight:700;letter-spacing:.04em">INVOICE</div>
        <p style="${MUTED}">${esc(v.invoice.number)}<br>
          Issued ${esc(v.invoice.created_at.slice(0, 10))}
          ${p ? `<br>Service period ${esc(p)}` : ''}</p>
      </td>
    </tr>
  </table>

  <p style="${MUTED}">Bill to</p>
  <p style="margin:0 0 20px;font-weight:600">${esc(v.customer.name)}</p>

  <table role="presentation" width="100%" style="border-collapse:collapse">
    <thead>
      <tr>
        <th align="left" style="${CELL};font-size:13px">Description</th>
        <th align="right" style="${CELL};font-size:13px">Qty</th>
        <th align="right" style="${CELL};font-size:13px">Rate</th>
        <th align="right" style="${CELL};font-size:13px">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="padding:12px 6px;text-align:right;font-weight:700;font-size:16px;
          border-top:2px solid #1f2328">Total due</td>
        <td style="padding:12px 6px;text-align:right;font-weight:700;font-size:16px;
          border-top:2px solid #1f2328;white-space:nowrap">${money(v.invoice.total_cents)}</td>
      </tr>
    </tfoot>
  </table>

  <p style="${MUTED};margin-top:24px">Questions about this invoice?
    ${esc(v.business.email)} · ${esc(v.business.phone)}</p>

  ${
    v.viaHourChit
      ? `<p style="${MUTED};margin-top:20px;padding-top:12px;border-top:1px solid #d0d7de">
           This message was sent on behalf of <strong>${esc(v.business.name)}</strong>.
           HourChit provides the time tracking, invoicing, and billing services used by the
           business.</p>`
      : ''
  }
</div>`;
}
