import { esc } from './html';
import { layout } from './layout';
import { formatCents } from '../domain/money';
import { DURATION_INPUT_PATTERN, describeDuration, formatDuration } from '../domain/duration';
import { parseMinimumCallOut, type TermVersion } from '../domain/terms';

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
 * normal case, not an edge case -- and because a contract that requires notice
 * makes "now" impossible by definition.
 */

export interface SettingsView {
  business: string;

  /** The date the "in force" panel is answering for, as YYYY-MM-DD local. */
  asOfDate: string;
  /** The same date written out, for the heading. */
  asOfLabel: string;
  /** Where the shown terms came from, so a surprising answer is explainable. */
  asOfSource: string;
  /**
   * Set when a version takes effect LATER on the selected day, so the panel
   * cannot claim a single answer for a day that has two.
   */
  changesLaterThatDay: string | null;

  increment: number;
  /** Stored form: minutes, or {"weekday":n,"weekend":n}. */
  minimum: string;
  mileageCents: number;
  mileageBillable: boolean;

  /** Effective dates arrive pre-formatted in LOCAL time; see renderSettings. */
  versions: Array<TermVersion & { effectiveLabel: string }>;
  /** id of the version in force at asOf, so the history can mark it. */
  inForceVersionId: number | null;

  /** Null when nothing has been invoiced; otherwise the guard boundary, written out. */
  latestInvoicedLabel: string | null;
  timezone: string;

  /**
   * TWO FLOORS UNDER THE EFFECTIVE DATE, and either can be the binding one.
   *
   * They are reported separately because a single "earliest accepted" date
   * attributed to the wrong rule is a confidently wrong explanation: telling an
   * operator that thirty days' notice lands on 15 September, when that date
   * actually came from an invoice, teaches them the wrong arithmetic.
   */
  noticeDays: number;
  /** Whose SOW set the longest period, so the number is traceable to a contract. */
  noticeLongestFrom: string | null;
  /** Clients whose notice period nobody has recorded yet. */
  noticeUnstated: Array<{ id: number; name: string }>;
  noticeFloorLabel: string;
  /** The later of the two, which is what the form will actually take. */
  acceptedFromLabel: string;
  /** "YYYY-MM-DDTHH:MM" local form of that, for the input's min and default. */
  acceptedFromWall: string;
}

/** Read a stored minimum for display, tolerating a value we cannot parse. */
function describeMinimum(stored: string): string {
  try {
    const m = parseMinimumCallOut(stored);
    if (typeof m === 'number') return describeDuration(m);
    return `weekday ${describeDuration(m.weekday)} · weekend ${describeDuration(m.weekend)}`;
  } catch {
    return `<span class="tag">unreadable</span> ${esc(stored)}`;
  }
}

/** Split the stored minimum into the three form fields, whichever form it is in. */
function minimumFields(stored: string): { mode: string; flat: string; weekday: string; weekend: string } {
  try {
    const m = parseMinimumCallOut(stored);
    if (typeof m === 'number') {
      return { mode: 'flat', flat: formatDuration(m), weekday: formatDuration(m), weekend: formatDuration(m) };
    }
    return {
      mode: 'split',
      flat: formatDuration(m.weekday),
      weekday: formatDuration(m.weekday),
      weekend: formatDuration(m.weekend),
    };
  } catch {
    return { mode: 'flat', flat: '0:00', weekday: '0:00', weekend: '0:00' };
  }
}

export function renderSettings(v: SettingsView, flash = ''): string {
  const f = minimumFields(v.minimum);

  const rows = v.versions.length
    ? v.versions
        .map(
          (t) => `<tr>
      <td>${esc(t.effectiveLabel)}
        ${t.id === v.inForceVersionId ? '<span class="tag">in force</span>' : ''}</td>
      <td class="num">${t.billing_increment_minutes} min</td>
      <td>${describeMinimum(t.minimum_callout)}</td>
      <td class="num">${formatCents(t.mileage_rate_cents, 'USD')}/mi${t.mileage_billable ? '' : ' <span class="tag">not billed</span>'}</td>
      <td class="muted">${esc(t.note)}</td>
      <td><a href="/settings/terms/${t.id}/notice">Notice</a></td>
    </tr>`,
        )
        .join('')
    : `<tr><td colspan="6" class="muted">No recorded versions yet — the tenant profile supplies the terms in force.</td></tr>`;

  const guard = v.latestInvoicedLabel
    ? `<p class="muted">Work up to <strong>${esc(v.latestInvoicedLabel)}</strong> has already been invoiced.
         An effective date on or before that would restate a billed period, so it is refused too — which is
         why this form accepts nothing before <strong>${esc(v.acceptedFromLabel)}</strong>.</p>`
    : `<p class="muted">Nothing has been invoiced yet, so the notice period is the only thing setting
         the earliest date.</p>`;

  return layout({
    title: 'Billing terms',
    business: v.business,
    body: `<h1>Billing terms</h1>
${flash}

<div class="card">
  <h2>In force for work as of ${esc(v.asOfLabel)}</h2>
  <p class="muted">Terms are resolved against the day work was PERFORMED, so this asks
    the same question an invoice asks. Change the date to see what any past or future day bills at.</p>
  <form method="get" action="/settings" class="row">
    <label style="flex:2">Show terms for work on
      <input type="date" name="asOf" value="${esc(v.asOfDate)}"></label>
    <button type="submit" class="secondary" style="flex:0 0 auto;width:auto">Show</button>
  </form>
  <table><tbody>
    <tr><td>Billing increment</td><td class="num">${v.increment} min, rounded up</td></tr>
    <tr><td>Minimum call-out</td><td class="num">${describeMinimum(v.minimum)}</td></tr>
    <tr><td>Mileage</td><td class="num">${formatCents(v.mileageCents, 'USD')}/mi ${v.mileageBillable ? '(billed)' : '(recorded, not billed)'}</td></tr>
    <tr><td>Timezone</td><td class="num">${esc(v.timezone)}</td></tr>
  </tbody></table>
  <p class="muted">${esc(v.asOfSource)}</p>
  ${
    v.changesLaterThatDay
      ? `<p class="flash err">Terms change during this day, at ${esc(v.changesLaterThatDay)} local.
           Work before that time bills at what is shown above; work after it does not.</p>`
      : ''
  }
</div>

<div class="card">
  <h2>Record new terms</h2>
  <p class="muted">This adds a version rather than editing the current one. Work performed before the
    effective date keeps billing at the older terms — that is what makes an old invoice explainable.</p>

  ${
    v.noticeUnstated.length > 0
      ? `<p class="flash err"><strong>Set a notice period for
           ${v.noticeUnstated.map((u) => `<a href="/clients/${u.id}">${esc(u.name)}</a>`).join(', ')}
           before changing terms.</strong> These terms apply to every client, so the earliest date a change
           may take effect is the LONGEST notice period among them — and until each client's SOW has been
           read in, any date offered here would be a guess that looks like an answer.</p>`
      : `<p class="flash err"><strong>Recording terms here does not give notice.</strong>
    ${
      v.noticeDays > 0
        ? `These terms apply to every client, so the binding period is the longest of them:
           <strong>${v.noticeDays} days</strong>${v.noticeLongestFrom ? `, from ${esc(v.noticeLongestFrom)}'s SOW` : ''}.
           Terms therefore cannot take effect before <strong>${esc(v.noticeFloorLabel)}</strong> —
           ${v.noticeDays} days plus one day to actually get the notice sent, since the contract's clock
           starts when it is served and that has not happened yet.`
        : `No client has a notice period longer than zero, so terms cannot take effect before
           <strong>${esc(v.noticeFloorLabel)}</strong>. They can never take effect today or in the past,
           whatever the contract says, because work performed this morning would reprice mid-day.`
    }
    Serve the notice yourself, then record it here. The next page gives you a letter to send.</p>`
  }

  ${guard}

  <form method="post" action="/settings/terms">
    <label>Effective from — the first moment work bills at these terms
      <input type="datetime-local" name="effectiveFrom" required
             min="${esc(v.acceptedFromWall)}" value="${esc(v.acceptedFromWall)}"></label>

    <label>Billing increment, minutes — billable time rounds up to a multiple of this
      <input type="number" name="increment" min="1" step="1" value="${v.increment}" required></label>

    <label>Minimum call-out
      <select name="minimumMode" id="minimumMode">
        <option value="flat"${f.mode === 'flat' ? ' selected' : ''}>Same every day</option>
        <option value="split"${f.mode === 'split' ? ' selected' : ''}>Varies — weekday vs weekend</option>
      </select></label>

    <div id="min-flat">
      <label>Minimum duration (h:mm)
        <input name="minFlat" value="${esc(f.flat)}" placeholder="1:00"
               pattern="${DURATION_INPUT_PATTERN}" inputmode="numeric"
               title="Hours and minutes, such as 4:00 for four hours"></label>
    </div>

    <div id="min-split">
      <div class="row">
        <label>Weekday minimum duration (h:mm)
          <input name="minWeekday" value="${esc(f.weekday)}" placeholder="0:00"
                 pattern="${DURATION_INPUT_PATTERN}" inputmode="numeric"
                 title="Hours and minutes, such as 4:00 for four hours"></label>
        <label>Weekend minimum duration (h:mm)
          <input name="minWeekend" value="${esc(f.weekend)}" placeholder="4:00"
                 pattern="${DURATION_INPUT_PATTERN}" inputmode="numeric"
                 title="Hours and minutes, such as 4:00 for four hours"></label>
      </div>
    </div>
    <noscript><p class="muted">Both sets of fields are shown because scripting is off.
      The dropdown decides which are used: "same every day" reads the single minimum, "varies" reads the pair.</p></noscript>

    <label>Mileage rate, cents per mile
      <input type="number" name="mileageCents" min="0" step="1" value="${v.mileageCents}" required></label>
    <label><input type="checkbox" name="mileageBillable" value="1" ${v.mileageBillable ? 'checked' : ''}
             style="width:auto"> Client reimburses travel</label>

    <label>Note — internal, and never shown to a client. Why these terms changed, and when notice was served
      <input name="note" placeholder="e.g. rate review agreed 2026-09; notice emailed and posted 2026-07-31"></label>

    <button type="submit">Record terms</button>
  </form>
</div>

<div class="card">
  <h2>History</h2>
  <table><thead><tr><th>Effective</th><th class="num">Increment</th><th>Minimum</th>
    <th class="num">Mileage</th><th>Note</th><th></th></tr></thead>
  <tbody>${rows}</tbody></table>
</div>

<script>
// The dropdown decides which fields exist, not merely which are enabled.
// Showing a weekend box that the chosen mode ignores is how a four hour weekend
// minimum gets typed in, saved, and silently dropped.
//
// The required flag moves with visibility because a hidden required field makes the
// browser refuse to submit while having nothing focusable to complain about --
// the form simply stops working with no message at all.
(function () {
  var mode = document.getElementById('minimumMode');
  var flat = document.getElementById('min-flat');
  var split = document.getElementById('min-split');
  if (!mode || !flat || !split) return;

  function apply() {
    var isSplit = mode.value === 'split';
    flat.hidden = isSplit;
    split.hidden = !isSplit;
    flat.querySelectorAll('input').forEach(function (i) { i.required = !isSplit; });
    split.querySelectorAll('input').forEach(function (i) { i.required = isSplit; });
  }
  mode.addEventListener('change', apply);
  apply();
})();
</script>`,
  });
}
