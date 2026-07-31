import type { Customer, Invoice, InvoiceContents, InvoiceLine } from '../db';
import type { ProfileBusiness } from '../config/profile';
import { formatCents } from '../domain/money';
import { amountCentsFor, billableHours, billableSeconds, type BillingTerms } from '../domain/billing';
import { esc, nl2br } from './html';

/** A clean, printable invoice. "Print to PDF" from the browser is the R1 output. */
export function renderInvoice(args: {
  business: ProfileBusiness;
  customer: Customer;
  invoice: Invoice;
  contents: InvoiceContents;
  /**
   * The tenant's terms. Read ONLY when falling back for an invoice issued
   * before line items were persisted; a stored invoice ignores them entirely,
   * which is the whole point.
   */
  terms: BillingTerms;
  /** The lines as issued. Empty for invoices predating persistence. */
  lines: InvoiceLine[];
}): string {
  const { business, customer, invoice, contents, terms, lines } = args;
  const money = (c: number) => formatCents(c, invoice.currency);

  // A stored invoice renders from what it recorded. Recomputing would let a
  // later change to the increment, the minimum call-out or the timezone restate
  // a document that has already been sent and possibly paid.
  const storedRows = lines.map(
    (l) => `<tr>
      <td>${esc(l.description)}</td>
      <td class="num">${l.quantity.toFixed(2)}${l.unit === 'mi' ? ' mi' : ''}</td>
      <td class="num">${money(l.rate_cents)}/${esc(l.unit)}</td>
      <td class="num">${money(l.amount_cents)}</td>
    </tr>`,
  );

  // Fallback for invoices issued before lines were persisted. Best available,
  // but it IS a recomputation, so it can disagree with the stored totals if the
  // terms have moved since.
  const legacyTimeRows = groupTime(contents, terms).map(
    (t) => `<tr>
      <td>${esc(t.name)}</td>
      <td class="num">${billableHours(t.seconds).toFixed(2)}</td>
      <td class="num">${money(t.rate)}/hr</td>
      <td class="num">${money(t.amount)}</td>
    </tr>`,
  );
  const legacyMileageRows = contents.mileage.map(
    (m) => `<tr>
      <td>Mileage: ${esc(m.occurred_local.slice(0, 10))} <span class="muted">(${esc(m.reason)})</span></td>
      <td class="num">${m.miles} mi</td>
      <td class="num">${money(m.rate_cents_per_mile)}/mi</td>
      <td class="num">${money(Math.round((m.miles * m.rate_cents_per_mile)))}</td>
    </tr>`,
  );

  const timeRows = lines.length > 0 ? storedRows : legacyTimeRows;
  const mileageRows = lines.length > 0 ? [] : legacyMileageRows;

  const period =
    invoice.period_start && invoice.period_end
      ? `${esc(invoice.period_start)} – ${esc(invoice.period_end)}`
      : '';

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(invoice.number || `Invoice #${invoice.id}`)}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;color:#1f2328;max-width:48rem;margin:1.5rem auto;padding:0 1rem}
  .top{display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem}
  h1{font-size:1.6rem;margin:.2rem 0}
  .muted{color:#656d76;font-size:.85rem}
  .parties{display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin:1.5rem 0}
  table{width:100%;border-collapse:collapse;margin-top:1rem}
  th,td{text-align:left;padding:.5rem .4rem;border-bottom:1px solid #d0d7de}
  th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
  tfoot td{border:0;padding-top:.4rem}
  tfoot .total{font-weight:700;font-size:1.15rem;border-top:2px solid #1f2328}
  .actions{margin:1.5rem 0}
  button{font-size:1rem;padding:.55rem 1rem;border-radius:.4rem;border:0;background:#1f6feb;color:#fff;cursor:pointer}
  button.secondary{background:#eaeef2;color:#1f2328}
  @media print{.actions,.nav{display:none}}
  .nav{margin-bottom:1rem}
  .nav a{color:#656d76}
</style></head>
<body>
  <div class="nav"><a href="/">← Dashboard</a></div>
  <div class="top">
    <div>
      <h1>${esc(business.name)}</h1>
      <div class="muted">${nl2br(business.address)}</div>
      <div class="muted">${esc(business.email)} · ${esc(business.phone)}</div>
    </div>
    <div style="text-align:right">
      <h1>INVOICE</h1>
      <div class="muted">${esc(invoice.number || `#${invoice.id}`)}</div>
      <div class="muted">Issued ${esc(invoice.created_at.slice(0, 10))}</div>
      <div class="muted">Status: ${esc(invoice.status)}</div>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="muted">Bill to</div>
      <strong>${esc(customer.name)}</strong>
      <div class="muted">${nl2br(customer.address)}</div>
      <div class="muted">${esc(customer.email)}</div>
    </div>
    <div style="text-align:right">
      <div class="muted">Service period</div>
      <div>${period || '&mdash;'}</div>
    </div>
  </div>

  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>
      ${timeRows.join('')}
      ${mileageRows.join('')}
    </tbody>
    <tfoot>
      <tr><td colspan="3" class="num muted">Time</td><td class="num">${money(invoice.time_subtotal_cents)}</td></tr>
      <tr><td colspan="3" class="num muted">Mileage</td><td class="num">${money(invoice.mileage_subtotal_cents)}</td></tr>
      <tr class="total"><td colspan="3" class="num">Total due</td><td class="num">${money(invoice.total_cents)}</td></tr>
    </tfoot>
  </table>

  <div class="actions">
    <button onclick="window.print()">Print / Save PDF</button>
    ${
      invoice.status === 'draft'
        ? `<form method="post" action="/invoices/${invoice.id}/send" style="display:inline">
             <input type="hidden" name="method" value="print">
             <button class="secondary" type="submit">Mark sent</button>
           </form>`
        : ''
    }
  </div>
</body></html>`;
}

function groupTime(contents: InvoiceContents, terms: BillingTerms) {
  const map = new Map<number, { name: string; rate: number; seconds: number; amount: number }>();
  for (const e of contents.timeEntries) {
    const raw = Math.max(
      0,
      Math.round((Date.parse(e.stoppedAt as string) - Date.parse(e.startedAt)) / 1000),
    );
    const g = map.get(e.taskId) ?? { name: e.taskName, rate: e.rateCentsPerHour, seconds: 0, amount: 0 };
    // Rounded PER ATTENDANCE before summing, exactly as createInvoiceForCustomer
    // does it, because the minimum applies to each confirmed attendance.
    g.seconds += billableSeconds(raw, terms, e.startedAt);
    map.set(e.taskId, g);
  }
  for (const g of map.values()) {
    // From the same seconds the quantity is rendered from, so the row always
    // multiplies out.
    g.amount = amountCentsFor(g.seconds, g.rate);
  }
  return [...map.values()];
}
