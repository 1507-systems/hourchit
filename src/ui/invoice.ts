import type { Customer, Invoice, InvoiceContents } from '../db';
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
   * The tenant's terms, so the displayed lines are computed the SAME way the
   * stored totals were. They used to be computed twice from different inputs,
   * which is how an invoice came to show a line of $0.03 above a total of
   * $125.00 -- the totals had the minimum call-out applied and the line did not.
   */
  terms: BillingTerms;
}): string {
  const { business, customer, invoice, contents, terms } = args;
  const money = (c: number) => formatCents(c, invoice.currency);

  const timeRows = groupTime(contents, terms).map(
    (t) => `<tr>
      <td>${esc(t.name)}</td>
      <td class="num">${billableHours(t.seconds).toFixed(2)}</td>
      <td class="num">${money(t.rate)}/hr</td>
      <td class="num">${money(t.amount)}</td>
    </tr>`,
  );

  const mileageRows = contents.mileage.map(
    (m) => `<tr>
      <td>Mileage: ${esc(m.occurred_local.slice(0, 10))} <span class="muted">(${esc(m.reason)})</span></td>
      <td class="num">${m.miles} mi</td>
      <td class="num">${money(m.rate_cents_per_mile)}/mi</td>
      <td class="num">${money(Math.round((m.miles * m.rate_cents_per_mile)))}</td>
    </tr>`,
  );

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
