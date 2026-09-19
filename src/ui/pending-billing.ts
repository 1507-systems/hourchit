import { esc } from './html';
import { formatCents } from '../domain/money';
import { formatHoursMinutes } from '../domain/time';
import type { PendingBillingDisplay } from '../domain/pending-billing';

export interface PendingBillingRow {
  id: number;
  kind: 'time' | 'mileage';
  task: string;
  description: string;
  date: string;
  seconds: number;
  amountCents: number;
}

export function renderPendingBilling(
  customerId: number,
  rows: PendingBillingRow[],
  mode: PendingBillingDisplay,
  currency: string,
): string {
  if (!rows.length) return '<p class="muted">Nothing unbilled to invoice yet.</p>';
  return `<form method="post" action="/invoices" id="pending-billing" data-currency="${esc(currency)}">
    <input type="hidden" name="customerId" value="${customerId}">
    <p class="muted">Choose entries to add to a new invoice. Unchecked entries stay unbilled.</p>
    <div class="row"><button type="button" class="secondary" data-select="all">Select all</button>
      <button type="button" class="secondary" data-select="none">Deselect all</button></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Select</th><th>Date</th><th>${mode === 'task' ? 'Task' : mode === 'description' ? 'Description' : 'Task + description'}</th><th class="num">Hours worked</th><th class="num">Charge</th></tr></thead><tbody>
    ${rows
      .map((row) => {
        const label =
          row.kind === 'mileage'
            ? esc(row.description)
            : mode === 'task'
              ? esc(row.task)
              : mode === 'description'
                ? esc(row.description || 'No description')
                : `<strong>${esc(row.task)}</strong><br>${esc(row.description || 'No description')}`;
        return `<tr><td><input type="checkbox" style="width:auto" name="${row.kind === 'time' ? 'timeEntryIds' : 'mileageIds'}[]" value="${row.id}" data-seconds="${row.seconds}" data-cents="${row.amountCents}" aria-label="Select entry ${row.id} on ${esc(row.date)}"></td>
        <td>${esc(row.date)}</td><td>${label}</td><td class="num">${row.kind === 'time' ? formatHoursMinutes(row.seconds) : '—'}</td><td class="num">${formatCents(row.amountCents, currency)}</td></tr>`;
      })
      .join('')}
    </tbody></table></div>
    <p id="billing-selection-total" role="status" aria-live="polite">No entries selected.</p>
    <button type="submit" id="add-to-invoice">Add to invoice</button>
    <noscript><p>Select entries and submit. Your invoice will show the selected total.</p></noscript>
  </form>
  <script>
  (function () {
    var form = document.getElementById('pending-billing');
    if (!form) return;
    var boxes = Array.from(form.querySelectorAll('input[type="checkbox"]'));
    var button = document.getElementById('add-to-invoice');
    function update() {
      var selected = boxes.filter(function (box) { return box.checked; });
      var seconds = selected.reduce(function (sum, box) { return sum + Number(box.dataset.seconds); }, 0);
      var cents = selected.reduce(function (sum, box) { return sum + Number(box.dataset.cents); }, 0);
      var hours = Math.floor(seconds / 3600) + ':' + String(Math.floor(seconds % 3600 / 60)).padStart(2, '0');
      document.getElementById('billing-selection-total').textContent = selected.length + ' selected · ' + hours + ' hours worked · ' + new Intl.NumberFormat('en-US', { style: 'currency', currency: form.dataset.currency }).format(cents / 100);
      button.disabled = selected.length === 0;
    }
    form.addEventListener('change', update);
    form.querySelectorAll('[data-select]').forEach(function (control) {
      control.addEventListener('click', function () { boxes.forEach(function (box) { box.checked = control.dataset.select === 'all'; }); update(); });
    });
    form.addEventListener('submit', function (event) {
      if (!boxes.some(function (box) { return box.checked; })) { event.preventDefault(); return; }
      button.disabled = true;
      button.textContent = 'Creating invoice…';
    });
    window.addEventListener('pageshow', function () { button.textContent = 'Add to invoice'; update(); });
    update();
  })();
  </script>`;
}
