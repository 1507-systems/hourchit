import type { Customer, Invoice, Route, MileageRow } from '../db';
import { formatCents } from '../domain/money';
import { formatHoursMinutes } from '../domain/time';
import { esc } from './html';
import { layout } from './layout';

export interface TaskView {
  id: number;
  name: string;
  rateCentsPerHour: number;
  unbilledSeconds: number;
}

export interface DashboardData {
  business: string;
  currency: string;
  mileageRateCentsPerMile: number;
  afterHoursStart: string;
  customer: Customer | null;
  tasks: TaskView[];
  running: { taskName: string; startedAtMs: number } | null;
  routes: Route[];
  recentMileage: MileageRow[];
  invoices: Invoice[];
  unbilledTotalCents: number;
  flash?: { kind: 'ok' | 'err'; text: string };
}

export function renderDashboard(d: DashboardData): string {
  const money = (c: number) => formatCents(c, d.currency);

  const flash = d.flash
    ? `<div class="flash ${d.flash.kind}">${esc(d.flash.text)}</div>`
    : '';

  const timer = d.running
    ? `<div class="card">
        <div class="muted">On the clock: ${esc(d.running.taskName)}</div>
        <div class="big" id="elapsed" data-start="${d.running.startedAtMs}">0:00:00</div>
        <form method="post" action="/timer/stop"><button class="stop" type="submit">Stop &amp; log</button></form>
      </div>`
    : `<div class="card">
        <div class="muted">No timer running</div>
        <form method="post" action="/timer/start" class="row">
          <div>
            <label>Task</label>
            <select name="taskId" required>
              ${d.tasks.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
            </select>
          </div>
          <div style="flex:0 0 auto"><button type="submit">Start</button></div>
        </form>
      </div>`;

  const taskRows = d.tasks
    .map(
      (t) => `<tr>
        <td>${esc(t.name)}</td>
        <td class="num">${money(t.rateCentsPerHour)}/hr</td>
        <td class="num">${formatHoursMinutes(t.unbilledSeconds)}</td>
      </tr>`,
    )
    .join('');

  const mileageForm = `<div class="card">
    <h2>Log mileage</h2>
    <form method="post" action="/mileage">
      <div class="row">
        <div>
          <label>Route</label>
          <select name="routeId" required>
            ${d.routes
              .map(
                (r) =>
                  `<option value="${r.id}">${esc(r.label)} (${r.one_way_miles} mi one-way)</option>`,
              )
              .join('')}
          </select>
        </div>
        <div>
          <label>When (local)</label>
          <input type="datetime-local" name="occurredLocal" id="occurredLocal" required>
        </div>
      </div>
      <label>Note (optional)</label>
      <input type="text" name="note" placeholder="e.g. on-site coverage">
      <p class="muted">Round trip is auto-billed when it starts at/after
        ${esc(d.afterHoursStart)} or on a weekend, at ${money(d.mileageRateCentsPerMile)}/mile.</p>
      <button type="submit">Log trip</button>
    </form>
  </div>`;

  const mileageList = d.recentMileage.length
    ? `<table><thead><tr><th>Date</th><th>Miles</th><th>Billable</th><th>Why</th></tr></thead><tbody>
        ${d.recentMileage
          .map(
            (m) => `<tr>
              <td>${esc(m.occurred_local.slice(0, 16).replace('T', ' '))}</td>
              <td class="num">${m.miles}</td>
              <td>${m.billable ? 'yes' : 'no'}</td>
              <td class="muted">${esc(m.reason)}</td>
            </tr>`,
          )
          .join('')}
      </tbody></table>`
    : '<p class="muted">No mileage logged yet.</p>';

  const invoiceRows = d.invoices.length
    ? `<table><thead><tr><th>#</th><th>Status</th><th class="num">Total</th><th></th></tr></thead><tbody>
        ${d.invoices
          .map(
            (i) => `<tr>
              <td>${esc(i.number || `#${i.id}`)}</td>
              <td>${esc(i.status)}</td>
              <td class="num">${money(i.total_cents)}</td>
              <td><a class="btnlink" href="/invoices/${i.id}">view</a></td>
            </tr>`,
          )
          .join('')}
      </tbody></table>`
    : '<p class="muted">No invoices yet.</p>';

  const createInvoice =
    d.customer && d.unbilledTotalCents > 0
      ? `<form method="post" action="/invoices">
           <input type="hidden" name="customerId" value="${d.customer.id}">
           <button type="submit">Create invoice: ${money(d.unbilledTotalCents)} unbilled</button>
         </form>`
      : `<p class="muted">Nothing unbilled to invoice yet.</p>`;

  const body = `
    ${flash}
    ${timer}

    <div class="card">
      <h2>Unbilled by task${d.customer ? ` · ${esc(d.customer.name)}` : ''}</h2>
      ${
        d.tasks.length
          ? `<table><thead><tr><th>Task</th><th class="num">Rate</th><th class="num">On the clock</th></tr></thead><tbody>${taskRows}</tbody></table>`
          : '<p class="muted">No tasks yet.</p>'
      }
    </div>

    ${mileageForm}

    <div class="card">
      <h2>Recent mileage</h2>
      ${mileageList}
    </div>

    <div class="card">
      <h2>Mail</h2>
      <p style="margin:.2rem 0"><a href="/mail">Open mail</a></p>
      <p class="muted" style="margin:.2rem 0;font-size:.85rem">
        Messages to this business, kept with the job rather than in a personal inbox.
      </p>
    </div>

    <div class="card">
      <h2>Invoices</h2>
      ${createInvoice}
      <div style="margin-top:.8rem">${invoiceRows}</div>
    </div>

    <script>
      // Prefill mileage time with the phone's local clock.
      (function () {
        var el = document.getElementById('occurredLocal');
        if (el && !el.value) {
          var n = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
          el.value = n.toISOString().slice(0, 16);
        }
      })();
      // Live-tick the running timer.
      (function () {
        var el = document.getElementById('elapsed');
        if (!el) return;
        var start = Number(el.getAttribute('data-start'));
        function pad(n){return String(n).padStart(2,'0');}
        function tick(){
          var s = Math.max(0, Math.floor((Date.now() - start) / 1000));
          el.textContent = Math.floor(s/3600) + ':' + pad(Math.floor(s%3600/60)) + ':' + pad(s%60);
        }
        tick(); setInterval(tick, 1000);
      })();
    </script>
  `;

  return layout({ title: 'Dashboard', business: d.business, body });
}
