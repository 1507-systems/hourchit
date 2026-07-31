import type { Customer, Route, Task } from '../db';
import { esc, nl2br } from './html';
import { layout } from './layout';
import { formatCents } from '../domain/money';

/**
 * Client management.
 *
 * This is what turns HourChit from a configured deployment into a product. The
 * stated design target is a business scaling to a few tens of clients with no
 * rewrite, and until now customers, tasks and routes arrived only through the
 * tenant profile's seed block -- so client number two meant editing JSON and
 * redeploying. Seeding still gives a new tenant its first client; it is simply
 * no longer the only way data can arrive.
 *
 * NOTHING HERE DELETES. Customers archive, tasks and routes deactivate. Every
 * one of them is referenced by money that has already moved: an invoice names
 * its customer, a line names its task, a mileage row names its route. Removing
 * any of them would orphan the meaning of a payment years after the fact, and
 * "who was this for" is exactly the question asked late.
 */

function money(cents: number): string {
  return formatCents(cents, 'USD');
}

export function renderClients(business: string, customers: Customer[], flash = ''): string {
  const rows = customers.length
    ? customers
        .map(
          (c) => `<tr${c.archived ? ' class="muted"' : ''}>
      <td><a href="/clients/${c.id}">${esc(c.name)}</a>${c.archived ? ' <span class="tag">archived</span>' : ''}</td>
      <td class="muted">${esc(c.email)}</td>
      <td class="muted">${c.workdrive_folder_id ? 'filed' : '—'}</td>
    </tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="muted">No clients yet.</td></tr>';

  return layout({
    title: 'Clients',
    business,
    body: `<h1>Clients</h1>
${flash}
<div class="card">
  <table><thead><tr><th>Name</th><th>Billing email</th><th>WorkDrive</th></tr></thead>
  <tbody>${rows}</tbody></table>
</div>

<div class="card">
  <h2>Add a client</h2>
  <form method="post" action="/clients">
    <label>Name<input name="name" required></label>
    <label>Address<textarea name="address" rows="3"></textarea></label>
    <label>Billing email<input name="email" type="email"></label>
    <button type="submit">Add client</button>
  </form>
</div>`,
  });
}

export function renderClient(
  business: string,
  customer: Customer,
  tasks: Task[],
  routes: Route[],
  flash = '',
): string {
  const taskRows = tasks.length
    ? tasks
        .map(
          (t) => `<tr${t.active ? '' : ' class="muted"'}>
      <td>${esc(t.name)}${t.active ? '' : ' <span class="tag">inactive</span>'}
        <div class="muted" style="font-size:.85rem">${esc(t.description)}</div></td>
      <td class="num">${money(t.rate_cents_per_hour)}/hr</td>
      <td><form method="post" action="/tasks/${t.id}/active" style="margin:0">
        <input type="hidden" name="active" value="${t.active ? '0' : '1'}">
        <button class="linkish" type="submit">${t.active ? 'deactivate' : 'reactivate'}</button>
      </form></td>
    </tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="muted">No tasks yet.</td></tr>';

  const routeRows = routes.length
    ? routes
        .map(
          (r) => `<tr${r.active ? '' : ' class="muted"'}>
      <td>${esc(r.label)}${r.active ? '' : ' <span class="tag">inactive</span>'}</td>
      <td class="num">${r.one_way_miles} mi each way</td>
      <td><form method="post" action="/routes/${r.id}/active" style="margin:0">
        <input type="hidden" name="active" value="${r.active ? '0' : '1'}">
        <button class="linkish" type="submit">${r.active ? 'deactivate' : 'reactivate'}</button>
      </form></td>
    </tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="muted">No routes yet.</td></tr>';

  return layout({
    title: customer.name,
    business,
    body: `<p><a href="/clients">&larr; Clients</a></p>
<h1>${esc(customer.name)}</h1>
${flash}

<div class="card">
  <h2>Details</h2>
  <form method="post" action="/clients/${customer.id}">
    <label>Name<input name="name" value="${esc(customer.name)}" required></label>
    <label>Address<textarea name="address" rows="3">${esc(customer.address)}</textarea></label>
    <label>Billing email<input name="email" type="email" value="${esc(customer.email)}"></label>
    <label>WorkDrive folder id
      <input name="workdriveFolderId" value="${esc(customer.workdrive_folder_id ?? '')}"
             placeholder="where this client's documents get filed"></label>
    <label>Notes<textarea name="notes" rows="3">${esc(customer.notes)}</textarea></label>
    <button type="submit">Save</button>
  </form>
</div>

<div class="card">
  <h2>Tasks</h2>
  <table><thead><tr><th>Task</th><th class="num">Rate</th><th></th></tr></thead>
  <tbody>${taskRows}</tbody></table>
  <h3 style="font-size:.95rem;margin-top:1rem">Add a task</h3>
  <form method="post" action="/clients/${customer.id}/tasks">
    <label>Name<input name="name" required></label>
    <label>Description<input name="description"></label>
    <label>Rate, dollars per hour<input name="rate" type="number" step="0.01" min="0" required></label>
    <button type="submit">Add task</button>
  </form>
</div>

<div class="card">
  <h2>Routes</h2>
  <p class="muted" style="font-size:.85rem">Shared across clients. Mileage is recorded even when
    it is not billable, because unreimbursed business travel is exactly what is deductible.</p>
  <table><thead><tr><th>Route</th><th class="num">Distance</th><th></th></tr></thead>
  <tbody>${routeRows}</tbody></table>
  <h3 style="font-size:.95rem;margin-top:1rem">Add a route</h3>
  <form method="post" action="/routes">
    <label>Label<input name="label" required></label>
    <label>From<textarea name="fromAddress" rows="2"></textarea></label>
    <label>To<textarea name="toAddress" rows="2"></textarea></label>
    <label>One-way miles<input name="oneWayMiles" type="number" step="0.1" min="0.1" required></label>
    <button type="submit">Add route</button>
  </form>
</div>

${customer.notes ? `<div class="card"><h2>Notes</h2><p>${nl2br(esc(customer.notes))}</p></div>` : ''}

<div class="card">
  <h2>${customer.archived ? 'Restore' : 'Archive'}</h2>
  <p class="muted" style="font-size:.85rem">Clients are archived, never deleted. Invoices, time and
    mileage all name the client they were for, and removing one would orphan the meaning of money
    that has already moved.</p>
  <form method="post" action="/clients/${customer.id}/archived">
    <input type="hidden" name="archived" value="${customer.archived ? '0' : '1'}">
    <button type="submit">${customer.archived ? 'Restore client' : 'Archive client'}</button>
  </form>
</div>`,
  });
}
