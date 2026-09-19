import { renderPendingBilling, type PendingBillingRow } from './pending-billing';
import type { PendingBillingDisplay } from '../domain/pending-billing';
import type { Customer, Invoice, Route, MileageRow } from '../db';
import { DURATION_INPUT_PATTERN } from '../domain/duration';
import { formatCents } from '../domain/money';
import { esc } from './html';
import { layout } from './layout';
import {
  sanitizeDashboardPreferences,
  type DashboardModuleId,
  type DashboardPreferences,
} from '../domain/dashboard-preferences';

export interface TaskView {
  id: number;
  name: string;
}

export interface DashboardData {
  business: string;
  currency: string;
  mileageRateCentsPerMile: number;
  afterHoursStart: string;
  customer: Customer | null;
  tasks: TaskView[];
  running: { taskName: string; eventName: string; startedAtMs: number } | null;
  routes: Route[];
  recentMileage: MileageRow[];
  invoices: Invoice[];
  pendingBillings?: PendingBillingRow[];
  pendingBillingDisplay?: PendingBillingDisplay;
  preferences?: DashboardPreferences;
  customizing?: boolean;
  flash?: { kind: 'ok' | 'err'; text: string };
}

export function renderDashboard(d: DashboardData): string {
  const money = (c: number) => formatCents(c, d.currency);
  const preferences = sanitizeDashboardPreferences(d.preferences ?? null);

  const flash = d.flash
    ? `<div class="flash ${d.flash.kind}">${esc(d.flash.text)}</div>`
    : '';

  const timer = d.running
    ? `<div class="card">
        <div class="on-clock">On the clock: ${esc(d.running.taskName)} · ${esc(d.running.eventName)}</div>
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
          <div>
            <label>Event description</label>
            <input name="eventName" placeholder="e.g. Awards Ceremony" required>
          </div>
          <div>
            <label>GL charge code (optional)</label>
            <input name="chargeCode" placeholder="e.g. GL 5678">
          </div>
          <div style="flex:0 0 auto"><button type="submit">Start</button></div>
        </form>
      </div>`;

  const manualHoursForm = `<div class="card">
    <h2>Log hours worked</h2>
    <form method="post" action="/timer/manual">
      <div class="row">
        <div>
          <label>Task</label>
          <select name="taskId" required>
            ${d.tasks.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Started (local)</label>
          <input type="datetime-local" name="startedLocal" id="startedLocal" required>
        </div>
        <div>
          <label>Duration (h:mm)</label>
          <input type="text" name="duration" placeholder="3:00" pattern="${DURATION_INPUT_PATTERN}" required>
        </div>
      </div>
      <label>Event description</label>
      <input type="text" name="eventName" placeholder="e.g. Awards Ceremony" required>
      <label>GL charge code (optional)</label>
      <input type="text" name="chargeCode" placeholder="e.g. GL 5678">
      <button type="submit">Log hours</button>
    </form>
  </div>`;

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

  const mileageList = `<table><thead><tr><th>Date</th><th>Miles</th><th>Billable</th><th>Why</th></tr></thead><tbody>
        ${d.recentMileage
          .map(
            (m) => `<tr>
              <td class="mono">${esc(m.occurred_local.slice(0, 16).replace('T', ' '))}</td>
              <td class="num">${m.miles}</td>
              <td>${m.billable ? 'yes' : 'no'}</td>
              <td class="muted">${esc(m.reason)}</td>
            </tr>`,
          )
          .join('')}
      </tbody></table>`;

  const invoiceRows = d.invoices.length
    ? `<table><thead><tr><th>#</th><th>Status</th><th class="num">Total</th><th></th></tr></thead><tbody>
        ${d.invoices
          .map(
            (i) => `<tr>
              <td class="mono">${esc(i.number || `#${i.id}`)}</td>
              <td>${
                i.status === 'draft'
                  ? `<span class="status-draft">${esc(i.status)}</span>`
                  : esc(i.status)
              }</td>
              <td class="num">${money(i.total_cents)}</td>
              <td><a class="btnlink" href="/invoices/${i.id}">view</a></td>
            </tr>`,
          )
          .join('')}
      </tbody></table>`
    : '<p class="muted">No invoices yet.</p>';

  const createInvoice =
    d.customer && d.pendingBillings?.length
      ? '<p><a class="btnlink" href="/?showBillings=1#pending-billing">Choose entries to invoice</a></p>'
      : '<p class="muted">Nothing unbilled to invoice yet.</p>';

  const labels: Record<DashboardModuleId, string> = {
    timer: 'Timer',
    'manual-hours': 'Log hours worked',
    mileage: 'Log mileage',
    mail: 'Mail',
    invoices: 'Invoices',
    unbilled: 'Pending billings',
    'recent-mileage': 'Recent mileage',
  };
  const modules: Record<DashboardModuleId, string> = {
    timer,
    'manual-hours': manualHoursForm,
    mileage: mileageForm,
    mail: `<div class="card"><h2>Mail</h2>
      <p style="margin:.2rem 0"><a href="/mail">Open mail</a></p>
      <p class="muted" style="margin:.2rem 0;font-size:.85rem">Messages to this business, kept with the job rather than in a personal inbox.</p></div>`,
    invoices: `<div class="card"><h2>Invoices</h2>${createInvoice}<div style="margin-top:.8rem">${invoiceRows}</div></div>`,
    unbilled: `<div class="card"><h2>Pending billings${d.customer ? ` · ${esc(d.customer.name)}` : ''}</h2>
      ${d.customer ? renderPendingBilling(d.customer.id, d.pendingBillings ?? [], d.pendingBillingDisplay ?? 'task', d.currency) : '<p class="muted">No client yet.</p>'}</div>`,
    'recent-mileage': `<div class="card"><h2>Recent mileage</h2>${mileageList}</div>`,
  };

  const availableOrder = preferences.order.filter(
    (id) => id !== 'recent-mileage' || d.recentMileage.length > 0,
  );

  function dashboardModule(id: DashboardModuleId, index: number): string {
    const hidden = preferences.hidden.includes(id);
    if (hidden && !d.customizing) return '';
    const label = labels[id];
    const controls = d.customizing
      ? `<form class="module-controls noprint" method="post" action="/dashboard/preferences">
          <input type="hidden" name="moduleId" value="${id}">
          <button class="secondary" name="action" value="move-up" aria-label="Move ${esc(label)} up"${index === 0 ? ' disabled' : ''}>↑</button>
          <button class="secondary" name="action" value="move-down" aria-label="Move ${esc(label)} down"${index === availableOrder.length - 1 ? ' disabled' : ''}>↓</button>
          <button class="secondary" name="action" value="${hidden ? 'show' : 'hide'}" aria-label="${hidden ? 'Show' : 'Hide'} ${esc(label)}">${hidden ? 'Show' : 'Hide'}</button>
        </form>`
      : '';
    if (hidden) {
      return `<div class="card dashboard-module dashboard-module-hidden" data-module="${id}"><h2>${esc(label)}</h2>${controls}<p class="muted">Hidden</p></div>`;
    }
    return modules[id].replace(
      '<div class="card">',
      `<div class="card dashboard-module" data-module="${id}">${controls}`,
    );
  }

  const renderedModules = availableOrder.map(dashboardModule);
  // Two columns on a desktop, ONE on a phone, and the phone is the design
  // target -- this is a business run from a pocket. The split is doing rather
  // than reading: everything on the left is something the operator ACTS on
  // while the job is happening (start a timer, log the trip home, answer a
  // message), everything on the right is what they LOOK AT afterwards.
  //
  // Collapsed to one column the source order still reads correctly, act-first
  // then review, so the phone does not need its own ordering rules.
  const body = `<div class="dashboard">
    ${flash}
    <div class="cols">
      <div class="col">
        ${renderedModules.slice(0, 4).join('')}
      </div>

      <div class="col">
        ${renderedModules.slice(4).join('')}
      </div>
    </div>

    <script>
      // Prefill mileage/manual-hours time with the phone's local clock.
      (function () {
        var ids = ['occurredLocal', 'startedLocal'];
        var n = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
        var nowLocal = n.toISOString().slice(0, 16);
        for (var i = 0; i < ids.length; i++) {
          var el = document.getElementById(ids[i]);
          if (el && !el.value) el.value = nowLocal;
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
    </script></div>
  `;

  return layout({
    title: 'Dashboard',
    business: d.business,
    body,
    headerAction: d.customizing
      ? { href: '/', label: 'Done customizing' }
      : { href: '/?customize=1', label: 'Customize dashboard' },
  });
}
