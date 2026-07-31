import { esc } from './html';
import { layout } from './layout';
import { formatCents } from '../domain/money';
import type { TermVersion } from '../domain/terms';

/**
 * Billing terms, versioned.
 *
 * The form records a NEW VERSION rather than editing the current one. That is
 * the whole point: work performed before a change bills at the old terms, which
 * is only answerable if the old terms still exist. An editable settings row
 * would silently reprice every uninvoiced hour each time a rate moved.
 *
 * Effective date is a first-class field rather than "now", because terms are
 * commonly agreed in advance -- "decided today, effective the 1st" is the
 * normal case, not an edge case.
 */

export interface SettingsView {
  business: string;
  versions: TermVersion[];
  /** Resolved for right now, so the operator sees what is actually in force. */
  currentIncrement: number;
  currentMinimum: string;
  currentMileageCents: number;
  currentMileageBillable: boolean;
  /** Null when nothing has been invoiced; otherwise the guard boundary. */
  latestInvoicedWorkAt: string | null;
  fromProfileOnly: boolean;
  timezone: string;
}

function describeMinimum(raw: string): string {
  const t = raw.trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n === 0 ? 'none' : `${n} min`;
  }
  try {
    const o = JSON.parse(t) as { weekday: number; weekend: number };
    const part = (n: number) => (n === 0 ? 'none' : `${n} min`);
    return `weekday ${part(o.weekday)} · weekend ${part(o.weekend)}`;
  } catch {
    return esc(raw);
  }
}

export function renderSettings(v: SettingsView, flash = ''): string {
  const rows = v.versions.length
    ? v.versions
        .map(
          (t) => `<tr>
      <td>${esc(t.effective_from.slice(0, 16))}</td>
      <td class="num">${t.billing_increment_minutes} min</td>
      <td>${describeMinimum(t.minimum_callout)}</td>
      <td class="num">${formatCents(t.mileage_rate_cents, 'USD')}/mi${t.mileage_billable ? '' : ' <span class="tag">not billed</span>'}</td>
      <td class="muted">${esc(t.note)}</td>
    </tr>`,
        )
        .join('')
    : `<tr><td colspan="5" class="muted">No recorded versions yet — the tenant profile supplies the terms in force.</td></tr>`;

  const guard = v.latestInvoicedWorkAt
    ? `<p class="muted" style="font-size:.85rem">Work up to <strong>${esc(v.latestInvoicedWorkAt.slice(0, 16))}</strong>
         has already been invoiced. An effective date on or before that would restate a billed
         period, so it is refused.</p>`
    : `<p class="muted" style="font-size:.85rem">Nothing has been invoiced yet, so any effective date is accepted.</p>`;

  return layout({
    title: 'Billing terms',
    business: v.business,
    body: `<h1>Billing terms</h1>
${flash}

<div class="card">
  <h2>In force now</h2>
  <table><tbody>
    <tr><td>Billing increment</td><td class="num">${v.currentIncrement} min, rounded up</td></tr>
    <tr><td>Minimum call-out</td><td class="num">${describeMinimum(v.currentMinimum)}</td></tr>
    <tr><td>Mileage</td><td class="num">${formatCents(v.currentMileageCents, 'USD')}/mi ${v.currentMileageBillable ? '(billed)' : '(recorded, not billed)'}</td></tr>
    <tr><td>Timezone</td><td class="num">${esc(v.timezone)}</td></tr>
  </tbody></table>
  ${v.fromProfileOnly ? '<p class="muted" style="font-size:.85rem">These come from the tenant profile. Saving below records the first version.</p>' : ''}
</div>

<div class="card">
  <h2>Record new terms</h2>
  <p class="muted" style="font-size:.85rem">This adds a version rather than editing the current one.
    Work performed before the effective date keeps billing at the older terms — that is what makes
    an old invoice explainable.</p>
  ${guard}
  <form method="post" action="/settings/terms">
    <label>Effective from
      <input type="datetime-local" name="effectiveFrom" required></label>

    <label>Billing increment, minutes
      <input type="number" name="increment" min="1" step="1" value="${v.currentIncrement}" required></label>

    <label>Minimum call-out
      <select name="minimumMode">
        <option value="flat">Same every day</option>
        <option value="split">Different at weekends</option>
      </select></label>
    <label>— flat, or weekday minutes
      <input type="number" name="minWeekday" min="0" step="1" value="0"></label>
    <label>— weekend minutes (used only when "different at weekends" is chosen)
      <input type="number" name="minWeekend" min="0" step="1" value="0"></label>

    <label>Mileage rate, cents per mile
      <input type="number" name="mileageCents" min="0" step="1" value="${v.currentMileageCents}" required></label>
    <label><input type="checkbox" name="mileageBillable" value="1" ${v.currentMileageBillable ? 'checked' : ''}>
      Client reimburses travel</label>

    <label>Note — why these terms changed
      <input name="note" placeholder="e.g. rate review agreed 2026-09"></label>

    <button type="submit">Record terms</button>
  </form>
</div>

<div class="card">
  <h2>History</h2>
  <table><thead><tr><th>Effective</th><th class="num">Increment</th><th>Minimum</th><th class="num">Mileage</th><th>Note</th></tr></thead>
  <tbody>${rows}</tbody></table>
</div>`,
  });
}
