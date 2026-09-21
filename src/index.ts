import { Hono, type Context } from 'hono';
import { handleEmail } from './email';
import { handleQueue } from './queue';
import { mailboxFor } from './domain/inbound';
import type { Env } from './env';
// Written by scripts/generate-build-info.mjs. Run `npm run codegen` if your
// editor flags this as missing.
import { CONFIG_SHA, GIT_SHA } from './build-info.generated';
import {
  handleLoginRequest,
  handleLoginVerify,
  handleLogout,
  handleTokenLogin,
  loginPage,
  requireAuth,
  type AuthVariables,
  tokenLoginPage,
} from './auth';
import { loadProfile } from './config/profiles';
import { mileageRuleFromSettings, termsFor } from './config/profile';
import { classifyTrip, routeTableDistance } from './domain/mileage';
import { addMinutesIso, durationSeconds } from './domain/time';
import { mileageAmountCents } from './domain/money';
import {
  createInvoiceForCustomer,
  cancelInvoice,
  createCustomer,
  createMileage,
  createRoute,
  createTask,
  getInvoice,
  getRoute,
  getTask,
  invoiceContents,
  invoiceDelivery,
  invoiceLines,
  createTermVersion,
  latestInvoicedWorkAt,
  listAllCustomers,
  listTermVersions,
  listAllRoutes,
  listAllTasks,
  setCustomerArchived,
  setRouteActive,
  setTaskActive,
  updateCustomer,
  listCustomers,
  listInvoices,
  listRecentMileage,
  listRoutes,
  listTasks,
  logManualEntry,
  markInvoiceSent,
  markInvoiceSentManually,
  startTimer,
  stopTimer,
  unbilledMileage,
  unbilledTimeEntries,
  getCustomer,
  getRunningEntry,
  getDashboardPreferences,
  saveDashboardPreferences,
  getInvoiceDeliveryDefault,
  setInvoiceDeliveryDefault,
  getPendingBillingDisplay,
  setPendingBillingDisplay,
  taskRateHistory,
} from './db';
import {
  billableTimeEntries,
  selectionIds,
  parsePendingBillingDisplay,
} from './domain/pending-billing';
import type { PendingBillingRow } from './ui/pending-billing';
import { buildInvoice, aggregateInvoiceTime } from './domain/invoicing';
import { renderDashboard, TaskView } from './ui/dashboard';
import { renderMailList, renderThread } from './ui/mail';
import { renderClient, renderClients } from './ui/clients';
import { renderSettings } from './ui/settings';
import {
  conflictsWithInvoicedWork,
  earliestEffectiveFrom,
  noticeDaysForTenantChange,
  parseTermBasis,
  parseMinimumCallOut,
  serializeMinimumCallOut,
  versionAt,
} from './domain/terms';
import { formatDuration, parseDuration } from './domain/duration';
import { localDateString, utcToZonedWallTime, zonedWallTimeToUtc } from './domain/localtime';
import { renderNotice } from './ui/notice';
import type { MinimumCallOut } from './domain/billing';
import { getThread, listThreads, openOutboundThread, storeOutbound, threadMessages } from './inbox';
import { sendMail } from './mail/send';
import { renderInvoice } from './ui/invoice';
import { renderInvoiceSend } from './ui/invoice-send';
import { renderInvoiceMailApp } from './ui/invoice-mail-app';
import { invoiceEmailHtml, invoiceEmailText } from './mail/invoice-email';
import { buildInvoiceComposition, invoiceMailAppDraft, mailtoHref } from './mail/invoice-composition';
import { invoicePdfFilename, renderPdf } from './mail/invoice-pdf';
import { describeDelivery } from './domain/delivery';
import { normalizeChargeCode, normalizeEventName } from './domain/invoicing';
import {
  isDashboardModuleId,
  moveDashboardModuleSkipping,
  setDashboardModuleHidden,
} from './domain/dashboard-preferences';
import {
  hostedSendDenialReason,
  parseInvoiceDeliveryMode,
  resolveNewClientMode,
} from './domain/invoice-delivery';

type AppBindings = { Bindings: Env; Variables: AuthVariables };
type AppContext = Context<AppBindings>;

const app = new Hono<AppBindings>();

// Health check, unauthenticated, and deliberately so: it is what a deploy
// pipeline reads back to confirm the deploy actually took effect. A deploy
// that silently no-ops is otherwise indistinguishable from a successful one.
// It reports only the build identity and which tenant is configured, never
// the profile contents, which are the client's business.
/**
 * The newest migration this database has actually applied.
 *
 * READ THROUGH THE WORKER, deliberately, because the Worker has a D1 binding
 * and the deploy pipeline does not: the API token Cloudflare Workers Builds
 * issues itself carries no D1 permission, so nothing in CI can ask D1 anything.
 * The Worker can, and it is already being asked whether the deploy took effect.
 *
 * This closes a hole that a green deploy could not see. On 2026-07-31 migration
 * 0009's code shipped, /health reported the right commit, every signal said
 * success -- and the column did not exist, so a validation rule silently did
 * not fire. A matching git SHA proves the CODE is live. It says nothing about
 * whether the SCHEMA that code assumes is there.
 *
 * `d1_migrations` is wrangler's own tracking table. Null means no migration has
 * ever been applied, or D1 is unreachable; the verifier treats either as a
 * mismatch rather than guessing.
 */
async function appliedSchema(env: Env): Promise<string | null> {
  try {
    const row = await env.DB.prepare(
      'SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1',
    ).first<{ name: string }>();
    return row?.name ?? null;
  } catch {
    return null;
  }
}

app.get('/health', async (c) =>
  c.json({
    status: 'ok',
    tenant: c.env.TENANT_PROFILE,
    // The newest applied migration, so a deploy can verify the SCHEMA moved and
    // not merely the code. A public filename from a public repo; no client data.
    schema: await appliedSchema(c.env),
    // The core commit that is running. A drift check compares this against
    // this repository's main; it is the application code, not the config.
    version: GIT_SHA,
    // The tenant-config commit that produced this deploy, for a managed
    // deployment where a private repo pins the core. '' when the core repo was
    // built directly. A commit id, never anything about the client.
    config: CONFIG_SHA,
    // Surfaced so a misconfigured deploy is visible from outside rather than
    // only when someone tries to log in and gets a 503.
    configured: Boolean(c.env.ACCESS_TOKEN),
  }),
);

// Auth endpoints (registered before the gate so they stay reachable).
// Emailed one-time code: the ordinary way in.
app.get('/login', (c) => loginPage(c));
app.post('/login', (c) => handleLoginRequest(c));
app.post('/login/verify', (c) => handleLoginVerify(c));

// Shared token: break-glass for when mail is unavailable.
app.get('/login/token', (c) => tokenLoginPage(c));
app.post('/login/token', (c) => handleTokenLogin(c));

app.get('/logout', (c) => handleLogout(c));

// Everything below requires the shared-secret cookie.
app.use('*', requireAuth);

app.get('/', async (c) => {
  const env = c.env;
  const profile = loadProfile(env.TENANT_PROFILE);
  const terms = termsFor(profile);
  const customers = await listCustomers(env);
  const customer = customers[0] ?? null;
  const tasks = customer ? await listTasks(env, customer.id) : [];

  const running = await getRunningEntry(env);
  let runningView: {
    taskName: string;
    eventName: string;
    startedAtMs: number;
  } | null = null;
  if (running) {
    const rt = await getTask(env, running.taskId);
    runningView = {
      taskName: rt?.name ?? 'Task',
      eventName: running.note ?? '',
      startedAtMs: Date.parse(running.startedAt),
    };
  }

  const unbilledTime = customer ? await unbilledTimeEntries(env, customer.id) : [];
  const taskViews: TaskView[] = tasks.map((t) => ({ id: t.id, name: t.name }));

  const mileage = customer ? await unbilledMileage(env, customer.id) : [];
  const recentMileage = customer ? await listRecentMileage(env, customer.id) : [];
  const preferences = await getDashboardPreferences(env, c.get('userKey'));

  const termVersions = await listTermVersions(env);
  const rateHistory = await taskRateHistory(env);
  const pendingBillings: PendingBillingRow[] = unbilledTime.map((e) => ({
    id: e.id,
    kind: 'time',
    task: e.taskName,
    description: e.note ?? '',
    date: utcToZonedWallTime(e.startedAt, profile.settings.timezone).slice(0, 16).replace('T', ' '),
    seconds: durationSeconds(e.startedAt, e.stoppedAt as string),
    amountCents: buildInvoice(
      aggregateInvoiceTime(billableTimeEntries([e], terms, termVersions, rateHistory)),
      [],
      { mileageBillable: false },
    ).totalCents,
  }));
  if (profile.settings.mileageBillable) {
    pendingBillings.push(
      ...mileage.map((m) => ({
        id: m.id,
        kind: 'mileage' as const,
        task: 'Mileage',
        description: `Mileage: ${m.miles} mi (${m.reason})`,
        date: m.occurred_local.slice(0, 16).replace('T', ' '),
        seconds: 0,
        amountCents: mileageAmountCents(m.miles, m.rate_cents_per_mile),
      })),
    );
  }
  // A visible path to invoice selection remains even when the operator hid
  // the pending-billings dashboard module in their personal layout.
  if (c.req.query('showBillings') === '1')
    preferences.hidden = preferences.hidden.filter((id) => id !== 'unbilled');

  return c.html(
    renderDashboard({
      business: profile.business.name,
      currency: profile.settings.currency,
      mileageRateCentsPerMile: profile.settings.mileageRateCentsPerMile,
      afterHoursStart: profile.settings.afterHoursStart,
      customer,
      tasks: taskViews,
      running: runningView,
      routes: await listRoutes(env),
      recentMileage,
      invoices: await listInvoices(env),
      pendingBillings,
      pendingBillingDisplay: await getPendingBillingDisplay(env),
      preferences,
      customizing: c.req.query('customize') === '1',
      flash: readFlash(c.req.query('ok'), c.req.query('err')),
    }),
  );
});

app.post('/dashboard/preferences', async (c) => {
  const body = await c.req.parseBody();
  const moduleId = String(body.moduleId ?? '');
  const action = String(body.action ?? '');
  if (!isDashboardModuleId(moduleId)) {
    return c.redirect('/?customize=1&err=' + encodeURIComponent('Unknown dashboard module'));
  }

  const current = await getDashboardPreferences(c.env, c.get('userKey'));
  let updated;
  if (action === 'move-up' || action === 'move-down') {
    const customers = await listCustomers(c.env);
    const recentMileage = customers[0] ? await listRecentMileage(c.env, customers[0].id) : [];
    updated = moveDashboardModuleSkipping(
      current,
      moduleId,
      action === 'move-up' ? 'up' : 'down',
      recentMileage.length === 0 ? ['recent-mileage'] : [],
    );
  } else if (action === 'hide' || action === 'show') {
    updated = setDashboardModuleHidden(current, moduleId, action === 'hide');
  } else {
    return c.redirect('/?customize=1&err=' + encodeURIComponent('Unknown dashboard action'));
  }

  await saveDashboardPreferences(c.env, c.get('userKey'), updated);
  return c.redirect('/?customize=1');
});

app.post('/timer/start', async (c) => {
  const body = await c.req.parseBody();
  const taskId = Number(body.taskId);
  try {
    const eventName = normalizeEventName(String(body.eventName ?? ''));
    const chargeCode = normalizeChargeCode(String(body.chargeCode ?? ''));
    await startTimer(c.env, taskId, new Date().toISOString(), eventName, chargeCode);
    return c.redirect('/?ok=' + encodeURIComponent('Timer started'));
  } catch (e) {
    return c.redirect('/?err=' + encodeURIComponent((e as Error).message));
  }
});

app.post('/timer/stop', async (c) => {
  const secs = await stopTimer(c.env, new Date().toISOString());
  const msg = secs === null ? 'No timer was running' : `Logged ${Math.round(secs / 60)} min`;
  return c.redirect('/?ok=' + encodeURIComponent(msg));
});

// For work already done -- no timer needed, just the task, when it started,
// and how long it took.
app.post('/timer/manual', async (c) => {
  const env = c.env;
  const profile = loadProfile(env.TENANT_PROFILE);
  const body = await c.req.parseBody();
  const taskId = Number(body.taskId);

  try {
    const eventName = normalizeEventName(String(body.eventName ?? ''));
    const chargeCode = normalizeChargeCode(String(body.chargeCode ?? ''));
    const minutes = parseDuration(String(body.duration ?? ''));
    if (minutes <= 0) {
      throw new Error('Enter a duration greater than zero.');
    }
    const startedAt = zonedWallTimeToUtc(String(body.startedLocal ?? ''), profile.settings.timezone);
    const stoppedAt = addMinutesIso(startedAt, minutes);
    await logManualEntry(env, taskId, startedAt, stoppedAt, eventName, chargeCode);
    return c.redirect('/?ok=' + encodeURIComponent(`Logged ${formatDuration(minutes)}`));
  } catch (e) {
    return c.redirect('/?err=' + encodeURIComponent((e as Error).message));
  }
});

app.post('/mileage', async (c) => {
  const env = c.env;
  const profile = loadProfile(env.TENANT_PROFILE);
  const body = await c.req.parseBody();
  const routeId = Number(body.routeId);
  const occurredLocal = String(body.occurredLocal ?? '');
  const note = body.note ? String(body.note) : null;

  const route = await getRoute(env, routeId);
  const customers = await listCustomers(env);
  const customer = customers[0] ?? null;
  if (!route || !customer) {
    return c.redirect('/?err=' + encodeURIComponent('Pick a route first'));
  }

  let classification;
  try {
    classification = classifyTrip(occurredLocal, mileageRuleFromSettings(profile.settings));
  } catch {
    return c.redirect('/?err=' + encodeURIComponent('Enter a valid date/time'));
  }

  const miles = routeTableDistance.roundTripMiles({ oneWayMiles: route.one_way_miles });
  await createMileage(env, {
    customerId: customer.id,
    taskId: null,
    routeId: route.id,
    occurredLocal,
    miles,
    billable: classification.billable,
    reason: classification.reason,
    rateCentsPerMile: profile.settings.mileageRateCentsPerMile,
    note,
  });

  const verdict = classification.billable
    ? `Billable (${classification.reason})`
    : 'Not billable (daytime)';
  return c.redirect('/?ok=' + encodeURIComponent(`Logged ${miles} mi: ${verdict}`));
});

/**
 * The tenant's own outward address, <tenant>@<hosted mail domain>.
 *
 * Distinct from LOGIN_MAIL_FROM, which is HourChit's product mail to the
 * operator and rides 1507 Systems' domain. Client-facing mail must come from
 * the tenant's identity, because the client has a relationship with the tenant.
 */
function flashHtml(c: AppContext): string {
  const ok = c.req.query('ok');
  const err = c.req.query('err');
  if (err) return `<p class="err">${escapeText(err)}</p>`;
  if (ok) return `<p class="ok">${escapeText(ok)}</p>`;
  return '';
}

function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  );
}

/**
 * Which of this tenant's mailboxes to answer a thread from.
 *
 * Whichever one the inbound message was addressed to, so a reply continues the
 * conversation the correspondent started rather than appearing to come from a
 * different desk. Falls back to hello@, the general mailbox, when the stored
 * recipient is unreadable or was on some older address.
 */
function replyFromAddress(c: AppContext, toAddrs: string): string {
  const domain = c.env.TENANT_MAIL_DOMAIN ?? '';
  try {
    for (const addr of JSON.parse(toAddrs) as string[]) {
      const mailbox = mailboxFor(addr, domain);
      if (mailbox) return `${mailbox}@${domain}`;
    }
  } catch {
    // Fall through to the default below.
  }
  return `hello@${domain}`;
}

// ---- Billing terms ---------------------------------------------------------

/** A date written out for a person, in the tenant's own zone. */
function longDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Date.parse(iso)));
}

/**
 * As longDate, but keeping the time of day when there is one.
 *
 * The invoiced-work floor lands wherever the last billed job did, which is
 * rarely midnight. Rounding it down to a bare date describes a floor the form
 * does not actually have -- it reads as though the whole day were available
 * while the input silently refuses the morning.
 */
function longMoment(iso: string, timeZone: string): string {
  const wall = utcToZonedWallTime(iso, timeZone);
  if (wall.endsWith('T00:00')) return longDate(iso, timeZone);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(Date.parse(iso)));
  return `${longDate(iso, timeZone)} at ${time}`;
}

/**
 * The soonest date the terms form will accept.
 *
 * Two floors, and the later one wins. The NOTICE floor comes from the contract:
 * a change cannot bite before the client has had the notice they are owed. The
 * INVOICED floor comes from the books: a date inside an already-billed period
 * would make a stored invoice disagree with the terms that explain it. They are
 * independent, and either can be the binding one.
 */
async function effectiveDateFloor(
  c: { env: Env },
  nowIso: string,
  timeZone: string,
): Promise<{
  floor: string;
  noticeFloor: string;
  invoicedFloor: string | null;
  invoicedUpTo: string | null;
  notice: ReturnType<typeof noticeDaysForTenantChange>;
}> {
  // Active clients only. A change cannot owe notice to an engagement that has
  // ended, and an archived client's SOW would otherwise hold the floor down
  // forever.
  const notice = noticeDaysForTenantChange(await listCustomers(c.env));
  const noticeFloor = earliestEffectiveFrom(nowIso, notice.days, timeZone);
  const invoicedUpTo = await latestInvoicedWorkAt(c.env);
  // A minute past the last invoiced instant: conflictsWithInvoicedWork treats
  // the boundary itself as a conflict, so the floor has to clear it.
  const invoicedFloor = invoicedUpTo
    ? new Date(Date.parse(invoicedUpTo) + 60_000).toISOString()
    : null;
  const floor = invoicedFloor && invoicedFloor > noticeFloor ? invoicedFloor : noticeFloor;
  return { floor, noticeFloor, invoicedFloor, invoicedUpTo, notice };
}

app.get('/settings', async (c) => {
  const profile = loadProfile(c.env.TENANT_PROFILE);
  const tz = profile.settings.timezone;
  const versions = await listTermVersions(c.env);
  const nowIso = new Date().toISOString();

  // Which day is the panel answering for? Terms resolve against the day work
  // was PERFORMED, so the honest question is "what does a given day bill at",
  // not "what is set right now" -- and past days are exactly the ones somebody
  // queries when an old invoice is challenged.
  const asked = c.req.query('asOf') ?? '';
  const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : localDateString(nowIso, tz);
  const asOfInstant = zonedWallTimeToUtc(`${asOfDate}T00:00`, tz);

  const v = versionAt(versions, asOfInstant);

  // A version taking effect LATER on the selected day means the day has two
  // answers. Saying so beats showing one of them as though it were the whole
  // truth, which is how a half-day at the wrong rate gets defended.
  const dayEnd = zonedWallTimeToUtc(
    `${new Date(Date.parse(asOfInstant) + 86_400_000).toISOString().slice(0, 10)}T00:00`,
    tz,
  );
  const later = versions
    .filter((t) => t.effective_from > asOfInstant && t.effective_from < dayEnd)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];

  const { floor, invoicedFloor, noticeFloor, invoicedUpTo, notice } = await effectiveDateFloor(
    c,
    nowIso,
    tz,
  );
  // Display-only fallback: an unset default only renders as 'hosted' here so the
  // page has something to preselect. POST /clients does not use this value -- it
  // reads the stored default itself and refuses client creation when unset.
  const invoiceDeliveryDefault = (await getInvoiceDeliveryDefault(c.env)) ?? 'hosted';

  return c.html(
    renderSettings(
      {
        business: profile.business.name,
        invoiceDeliveryDefault,
        pendingBillingDisplay: await getPendingBillingDisplay(c.env),
        asOfDate,
        asOfLabel: longDate(asOfInstant, tz),
        asOfSource: v
          ? `From the version effective ${longDate(v.effective_from, tz)}, recorded ${v.recorded_at.slice(0, 10)}.`
          : 'From the tenant profile — no recorded version covers this date.',
        changesLaterThatDay: later ? utcToZonedWallTime(later.effective_from, tz).slice(11) : null,

        // Fall back to the profile when no version covers the date, so the page
        // shows what is genuinely in force rather than an empty state.
        increment: v ? v.billing_increment_minutes : profile.settings.billingIncrementMinutes,
        minimum: v
          ? v.minimum_callout
          : serializeMinimumCallOut(profile.settings.minimumCallOutMinutes),
        mileageCents: v ? v.mileage_rate_cents : profile.settings.mileageRateCentsPerMile,
        mileageBillable: v ? v.mileage_billable === 1 : profile.settings.mileageBillable,

        // Effective dates are stored as UTC instants but MEAN a local date.
        // Slicing the ISO string would show 31 August for a boundary the
        // operator set to 1 September, on exactly the tenants west of UTC.
        versions: versions.map((t) => ({ ...t, effectiveLabel: longDate(t.effective_from, tz) })),
        inForceVersionId: v?.id ?? null,
        latestInvoicedLabel: invoicedUpTo ? longMoment(invoicedUpTo, tz) : null,
        timezone: tz,
        noticeDays: notice.days,
        noticeLongestFrom: notice.longestFrom,
        noticeUnstated: notice.unstated,
        noticeFloorLabel: longDate(noticeFloor, tz),
        acceptedFromLabel: longMoment(floor, tz),
        acceptedFromWall: utcToZonedWallTime(floor, tz),
        // An AGREED change owes no notice, so the only thing under it is work
        // already invoiced. Empty means nothing constrains it at all -- an
        // agreement can legitimately be backdated to the day it was reached.
        agreedFloorWall: invoicedFloor ? utcToZonedWallTime(invoicedFloor, tz) : '',
        agreedFloorLabel: invoicedFloor ? longMoment(invoicedFloor, tz) : '',
      },
      flashHtml(c),
    ),
  );
});

app.post('/settings/terms', async (c) => {
  const profile = loadProfile(c.env.TENANT_PROFILE);
  const tz = profile.settings.timezone;
  const nowIso = new Date().toISOString();
  const b = await c.req.parseBody();

  const raw = String(b.effectiveFrom ?? '').trim();
  if (!raw) return c.redirect('/settings?err=' + encodeURIComponent('An effective date is required'));

  // The input gives local wall time with no zone. Convert it to the UTC instant
  // it names, because that is what every stored work instant is -- comparing a
  // local string against an ISO instant sorts by accident rather than by time.
  let effectiveFrom: string;
  try {
    effectiveFrom = zonedWallTimeToUtc(raw, tz);
  } catch (e) {
    return c.redirect('/settings?err=' + encodeURIComponent((e as Error).message));
  }

  // WHICH CONTRACTUAL PATH decides which floor applies. A change the client has
  // already agreed to owes no notice -- there is nothing to give notice OF --
  // so applying the notice floor to it would refuse, for two months, to charge
  // a rate agreed last week. That teaches the operator to lie about the date,
  // and a date that was lied about is worthless in the dispute it exists for.
  const basis = parseTermBasis(b.basis);
  const agreedWith = String(b.agreedWith ?? '').trim();

  if (basis === 'agreement' && agreedWith.length === 0) {
    return c.redirect(
      '/settings?err=' +
        encodeURIComponent(
          'Name who agreed. An agreed change takes effect because a counterparty assented, and a ' +
            'record that cannot say who did is not evidence of anything.',
        ),
    );
  }

  const { noticeFloor, notice } = await effectiveDateFloor(c, nowIso, tz);

  if (basis === 'notice') {
    // Refuse outright while any active client's notice period is unknown. The
    // alternative is to compute a floor from the clients we HAVE read, which
    // looks identical to a correct answer and is short by however long the
    // unread SOW turns out to be.
    if (notice.unstated.length > 0) {
      return c.redirect(
        '/settings?err=' +
          encodeURIComponent(
            `The notice period is not recorded for ${notice.unstated.map((u) => u.name).join(', ')}. ` +
              'Set it on each client before changing terms — otherwise the earliest effective date is ' +
              'a guess.',
          ),
      );
    }

    if (effectiveFrom < noticeFloor) {
      return c.redirect(
        '/settings?err=' +
          encodeURIComponent(
            `${notice.days} days' notice is required${notice.longestFrom ? ` (the longest, for ${notice.longestFrom})` : ''}, ` +
              `so terms cannot take effect before ${longDate(noticeFloor, tz)}.`,
          ),
      );
    }
  }

  // Refuse to restate a period that has already been billed. The invoice's own
  // lines are frozen, but a stored invoice disagreeing with what the terms now
  // say is exactly what cannot be explained later.
  const guard = conflictsWithInvoicedWork(effectiveFrom, await latestInvoicedWorkAt(c.env));
  if (guard.conflicts) {
    return c.redirect(
      '/settings?err=' +
        encodeURIComponent(
          `That date would restate work already invoiced up to ` +
            `${longDate(guard.latestInvoicedWorkAt as string, tz)}. Choose a later effective date.`,
        ),
    );
  }

  const increment = Number(b.increment);
  const mileageCents = Number(b.mileageCents);
  if (!Number.isFinite(increment) || increment < 1 || !Number.isFinite(mileageCents) || mileageCents < 0) {
    return c.redirect('/settings?err=' + encodeURIComponent('Increment and mileage rate must be numbers'));
  }

  // The dropdown decides which fields are read. Reading the pair when "same
  // every day" is chosen -- or the single field when it is not -- is how a
  // weekend minimum gets typed in and quietly discarded.
  let minimum: MinimumCallOut;
  try {
    minimum =
      String(b.minimumMode ?? 'flat') === 'split'
        ? {
            weekday: parseDuration(String(b.minWeekday ?? '')),
            weekend: parseDuration(String(b.minWeekend ?? '')),
          }
        : parseDuration(String(b.minFlat ?? ''));
    // Round-trip it before storing: a value that cannot be read back would make
    // every later invoice fail rather than this form.
    parseMinimumCallOut(serializeMinimumCallOut(minimum));
  } catch (e) {
    return c.redirect('/settings?err=' + encodeURIComponent((e as Error).message));
  }

  const id = await createTermVersion(c.env, {
    effectiveFrom,
    basis,
    agreedWith: basis === 'agreement' ? agreedWith : '',
    billingIncrementMinutes: Math.round(increment),
    minimumCallOut: serializeMinimumCallOut(minimum),
    mileageRateCents: Math.round(mileageCents),
    mileageBillable: String(b.mileageBillable ?? '') === '1',
    recordedBy: 'operator',
    note: String(b.note ?? ''),
  });

  // Straight to the letter. Recording the version changes what HourChit will
  // invoice; it does not tell the client anything, and the only thing standing
  // between those two facts is somebody actually sending the notice.
  return c.redirect(
    `/settings/terms/${id}/notice?ok=` +
      encodeURIComponent(
        basis === 'agreement'
          ? 'Terms recorded. Send the confirmation — nothing has been sent yet.'
          : 'Terms recorded. Now serve the notice — nothing has been sent yet.',
      ),
  );
});

app.post('/settings/pending-billing', async (c) => {
  const body = await c.req.parseBody();
  const mode = parsePendingBillingDisplay(body.pendingBillingDisplay);
  if (!mode)
    return c.redirect(
      '/settings?err=' + encodeURIComponent('Choose a valid pending billing display.'),
    );
  await setPendingBillingDisplay(c.env, mode);
  return c.redirect(
    '/settings?ok=' +
      encodeURIComponent('Pending billing display saved for this tenant. Invoices are unchanged.'),
  );
});

app.post('/settings/invoice-delivery', async (c) => {
  const b = await c.req.parseBody();
  const mode = parseInvoiceDeliveryMode(b.invoiceDeliveryDefault);
  if (!mode) {
    return c.redirect(
      '/settings?err=' + encodeURIComponent('Choose a valid invoice delivery default.'),
    );
  }
  await setInvoiceDeliveryDefault(c.env, mode);
  return c.redirect(
    '/settings?ok=' +
      encodeURIComponent('Default saved. Existing clients keep their own stored mode.'),
  );
});

/**
 * The notice letter for a recorded version.
 *
 * "Before" is the version in force the instant BEFORE this one takes effect,
 * which is what the client is currently being billed at -- not simply the
 * previous row, since versions can be recorded out of order.
 */
app.get('/settings/terms/:id/notice', async (c) => {
  const profile = loadProfile(c.env.TENANT_PROFILE);
  const tz = profile.settings.timezone;
  const id = Number(c.req.param('id'));
  const versions = await listTermVersions(c.env);
  const version = versions.find((t) => t.id === id);
  if (!version) return c.notFound();

  const justBefore = new Date(Date.parse(version.effective_from) - 1).toISOString();
  const prev = versionAt(
    versions.filter((t) => t.id !== id),
    justBefore,
  );

  const customers = await listCustomers(c.env);
  const wanted = Number(c.req.query('customer'));
  const recipient = customers.find((cu) => cu.id === wanted) ?? null;

  const nowIso = new Date().toISOString();
  const daysGiven = Math.floor(
    (Date.parse(zonedWallTimeToUtc(`${localDateString(version.effective_from, tz)}T00:00`, tz)) -
      Date.parse(zonedWallTimeToUtc(`${localDateString(nowIso, tz)}T00:00`, tz))) /
      86_400_000,
  );

  return c.html(
    renderNotice({
      business: profile.business,
      basis: version.basis,
      agreedWith: version.agreed_with,
      todayLabel: longDate(nowIso, tz),
      effectiveLabel: longDate(version.effective_from, tz),
      noticeDays: profile.settings.termsNoticeDays,
      daysGiven,
      before: prev
        ? {
            incrementMinutes: prev.billing_increment_minutes,
            minimum: prev.minimum_callout,
            mileageCents: prev.mileage_rate_cents,
            mileageBillable: prev.mileage_billable === 1,
          }
        : {
            incrementMinutes: profile.settings.billingIncrementMinutes,
            minimum: serializeMinimumCallOut(profile.settings.minimumCallOutMinutes),
            mileageCents: profile.settings.mileageRateCentsPerMile,
            mileageBillable: profile.settings.mileageBillable,
          },
      after: {
        incrementMinutes: version.billing_increment_minutes,
        minimum: version.minimum_callout,
        mileageCents: version.mileage_rate_cents,
        mileageBillable: version.mileage_billable === 1,
      },
      note: version.note,
      recipient: recipient
        ? { id: recipient.id, name: recipient.name, address: recipient.address, email: recipient.email }
        : null,
      customers: customers.map((cu) => ({ id: cu.id, name: cu.name })),
      versionId: version.id,
    }),
  );
});

/**
 * Read the notice-period field, distinguishing blank from zero.
 *
 * Both are legitimate: a client may genuinely have agreed to no notice period,
 * and a client may simply not have had their SOW read in yet. Storing them as
 * the same value throws away the difference between "none" and "nobody knows",
 * and the app needs that difference to decide whether it can offer an earliest
 * effective date at all.
 */
function noticeDaysFromForm(raw: unknown): number | null {
  const text = String(raw ?? '').trim();
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

// ---- Client management -----------------------------------------------------

app.get('/clients', async (c) => {
  const profile = loadProfile(c.env.TENANT_PROFILE);
  // Display-only fallback, same as GET /settings: this only preselects the
  // add-client form. POST /clients reads the stored default itself and
  // refuses creation when unset, so an unset default never reaches a client.
  const tenantDefault = (await getInvoiceDeliveryDefault(c.env)) ?? 'hosted';
  return c.html(
    renderClients(
      profile.business.name,
      await listAllCustomers(c.env),
      profile.settings.workdriveEnabled === true,
      tenantDefault,
      flashHtml(c),
    ),
  );
});

app.post('/clients', async (c) => {
  const b = await c.req.parseBody();
  const name = String(b.name ?? '').trim();
  if (!name) return c.redirect('/clients?err=' + encodeURIComponent('A client needs a name'));

  // The tenant default seeds every new client. An operator who has not yet
  // told the tenant what its own default is has not made a decision this app
  // can safely stand in for, so client creation refuses rather than guessing.
  const tenantDefault = await getInvoiceDeliveryDefault(c.env);
  if (!tenantDefault) {
    return c.redirect(
      '/clients?err=' +
        encodeURIComponent(
          "Set this business's invoice delivery default in Settings before adding a client.",
        ),
    );
  }
  const invoiceDeliveryMode = resolveNewClientMode(b.invoiceDeliveryMode, tenantDefault);

  const id = await createCustomer(c.env, {
    name,
    address: String(b.address ?? ''),
    email: String(b.email ?? ''),
    invoiceDeliveryMode,
  });
  return c.redirect(`/clients/${id}?ok=` + encodeURIComponent('Client added'));
});

app.get('/clients/:id', async (c) => {
  const profile = loadProfile(c.env.TENANT_PROFILE);
  const id = Number(c.req.param('id'));
  const customer = await getCustomer(c.env, id);
  if (!customer) return c.notFound();
  return c.html(
    renderClient(
      profile.business.name,
      customer,
      await listAllTasks(c.env, id),
      await listAllRoutes(c.env),
      profile.settings.workdriveEnabled === true,
      flashHtml(c),
    ),
  );
});

app.post('/clients/:id', async (c) => {
  const profile = loadProfile(c.env.TENANT_PROFILE);
  const id = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  const customer = await getCustomer(c.env, id);
  if (!customer) return c.notFound();

  const invoiceDeliveryMode = parseInvoiceDeliveryMode(b.invoiceDeliveryMode);
  if (!invoiceDeliveryMode) {
    return c.redirect(
      `/clients/${id}?err=` + encodeURIComponent('Choose a valid invoice delivery mode.'),
    );
  }

  // The field isn't rendered at all when this tenant doesn't have WorkDrive
  // enabled, so its absence from the form must not be read as "clear it" --
  // that would silently erase a value nobody was shown a way to change.
  const workdriveFolderId = profile.settings.workdriveEnabled
    ? (() => {
        const folder = String(b.workdriveFolderId ?? '').trim();
        return folder.length > 0 ? folder : null;
      })()
    : customer.workdrive_folder_id;
  await updateCustomer(c.env, id, {
    name: String(b.name ?? '').trim(),
    address: String(b.address ?? ''),
    email: String(b.email ?? ''),
    notes: String(b.notes ?? ''),
    workdriveFolderId,
    // Blank means UNSTATED, not zero. Coercing an empty field to 0 would
    // record that this client agreed to no notice at all, which is a term
    // nobody negotiated -- and it would then shorten the floor for every other
    // client, since the binding period is the longest across them.
    noticeDays: noticeDaysFromForm(b.noticeDays),
    invoiceDeliveryMode,
  });
  return c.redirect(`/clients/${id}?ok=` + encodeURIComponent('Saved'));
});

app.post('/clients/:id/archived', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  const archived = String(b.archived ?? '0') === '1';
  await setCustomerArchived(c.env, id, archived);
  return c.redirect(
    `/clients/${id}?ok=` + encodeURIComponent(archived ? 'Client archived' : 'Client restored'),
  );
});

app.post('/clients/:id/tasks', async (c) => {
  const customerId = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  const name = String(b.name ?? '').trim();
  const dollars = Number(b.rate);
  if (!name || !Number.isFinite(dollars) || dollars < 0) {
    return c.redirect(`/clients/${customerId}?err=` + encodeURIComponent('Task needs a name and a rate'));
  }
  await createTask(c.env, {
    customerId,
    name,
    description: String(b.description ?? ''),
    // Dollars in the form, cents in the database. Rounding here rather than
    // storing a float keeps every later multiplication exact.
    rateCentsPerHour: Math.round(dollars * 100),
  });
  return c.redirect(`/clients/${customerId}?ok=` + encodeURIComponent('Task added'));
});

app.post('/tasks/:id/active', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  const task = await getTask(c.env, id);
  await setTaskActive(c.env, id, String(b.active ?? '1') === '1');
  return c.redirect(task ? `/clients/${task.customer_id}` : '/clients');
});

app.post('/routes', async (c) => {
  const b = await c.req.parseBody();
  const label = String(b.label ?? '').trim();
  const miles = Number(b.oneWayMiles);
  if (!label || !Number.isFinite(miles) || miles <= 0) {
    // The zero-mileage guard again: a route with no distance bills nothing per
    // trip while looking like it works, which is the expensive kind of wrong.
    return c.redirect('/clients?err=' + encodeURIComponent('A route needs a label and a distance above zero'));
  }
  await createRoute(c.env, {
    label,
    fromAddress: String(b.fromAddress ?? ''),
    toAddress: String(b.toAddress ?? ''),
    oneWayMiles: miles,
  });
  return c.redirect(c.req.header('referer') ?? '/clients');
});

app.post('/routes/:id/active', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  await setRouteActive(c.env, id, String(b.active ?? '1') === '1');
  return c.redirect(c.req.header('referer') ?? '/clients');
});

app.get('/mail', async (c) => {
  const threads = await listThreads(c.env);
  return c.html(renderMailList(threads, flashHtml(c)));
});

app.get('/mail/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const thread = await getThread(c.env, id);
  if (!thread) return c.notFound();
  const messages = await threadMessages(c.env, id);
  // Reply to the last INBOUND sender: replying to our own last outbound would
  // mail ourselves, and picking an arbitrary recipient is what turns a
  // transactional thread view into a mail client.
  const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound');
  return c.html(
    renderThread(id, thread.subject, messages, lastInbound?.from_addr ?? '', flashHtml(c)),
  );
});

app.post('/mail/:id/reply', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  const text = String(body.body ?? '').trim();
  if (!text) return c.redirect(`/mail/${id}?err=` + encodeURIComponent('Write something first'));

  const thread = await getThread(c.env, id);
  if (!thread) return c.notFound();
  const messages = await threadMessages(c.env, id);
  const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound');
  if (!lastInbound) {
    return c.redirect(`/mail/${id}?err=` + encodeURIComponent('Nothing to reply to yet'));
  }

  // Reply from the mailbox the message ARRIVED AT. A conversation that came in
  // to hello@ should not be answered from billing@: the correspondent wrote to
  // an address for a reason, and switching it mid-thread breaks their filters
  // and reads as a different sender.
  const from = replyFromAddress(c, lastInbound.to_addrs);
  const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;

  try {
    const { messageId } = await sendMail(c.env.EMAIL, from, {
      to: lastInbound.from_addr,
      subject,
      text,
      inReplyTo: lastInbound.message_id,
      references: lastInbound.references_raw,
    });
    // Recorded only AFTER a successful send. A row claiming we sent something
    // we did not would later read as proof of a notice that never left.
    await storeOutbound(c.env, {
      threadId: id,
      messageId,
      inReplyTo: lastInbound.message_id,
      references: [lastInbound.references_raw, lastInbound.message_id]
        .filter(Boolean)
        .join(' ')
        .trim(),
      fromAddr: from,
      toAddrs: [lastInbound.from_addr],
      subject,
      bodyText: text,
    });
    return c.redirect(`/mail/${id}?ok=` + encodeURIComponent('Reply sent'));
  } catch (e) {
    return c.redirect(`/mail/${id}?err=` + encodeURIComponent((e as Error).message));
  }
});

app.post('/invoices', async (c) => {
  const env = c.env;
  const profile = loadProfile(env.TENANT_PROFILE);
  const body = await c.req.parseBody({ all: true });
  const customerId = Number(body.customerId);
  try {
    const invoice = await createInvoiceForCustomer(
      env,
      customerId,
      profile.settings.invoicePrefix,
      profile.settings.currency,
      profile.settings.mileageBillable,
      termsFor(profile),
      {
        timeEntryIds: selectionIds(body['timeEntryIds[]']),
        mileageIds: selectionIds(body['mileageIds[]']),
      },
    );
    return c.redirect(`/invoices/${invoice.id}`);
  } catch (e) {
    return c.redirect('/?err=' + encodeURIComponent((e as Error).message));
  }
});

app.get('/invoices/:id', async (c) => {
  const env = c.env;
  const profile = loadProfile(env.TENANT_PROFILE);
  const id = Number(c.req.param('id'));
  const invoice = await getInvoice(env, id);
  if (!invoice) return c.notFound();
  const customer = await getCustomer(env, invoice.customer_id);
  if (!customer) return c.notFound();
  const contents = await invoiceContents(env, id);
  const lines = await invoiceLines(env, id);

  // What the receiving mail server did, if this went out by email. Absent for
  // an invoice handed over on paper -- and that absence is meaningful, so it is
  // passed through as null rather than defaulted to a hopeful "sent".
  const sent = await invoiceDelivery(env, id);
  const d = sent ? describeDelivery(sent.status) : null;

  return c.html(
    renderInvoice({
      business: profile.business,
      manualSendHandoffEnabled: profile.settings.manualSendHandoffEnabled === true,
      customer,
      invoice,
      contents,
      terms: termsFor(profile),
      lines,
      flash: flashHtml(c),
      delivery:
        sent && d
          ? { ...d, at: sent.at || sent.sentAt, recipient: sent.recipient }
          : null,
    }),
  );
});

// The methods this route will record as `sent_method`. An allow-list rather
// than any posted string: `sent_method` is the audit record of HOW an invoice
// actually left, and the mail_app confirm button now posts here too, making
// that field load-bearing for a real workflow decision rather than a stub.
const MARK_SENT_METHODS = ['print', 'mail_app', 'email'] as const;

app.post('/invoices/:id/send', async (c) => {
  const id = Number(c.req.param('id'));
  const invoice = await getInvoice(c.env, id);
  if (!invoice) return c.notFound();
  if (invoice.status !== 'draft' && invoice.status !== 'sent') {
    return c.redirect(`/invoices/${id}?err=` + encodeURIComponent(`A ${invoice.status} invoice cannot be sent.`));
  }
  const body = await c.req.parseBody();
  const method = String(body.method ?? 'print');
  if (!(MARK_SENT_METHODS as readonly string[]).includes(method)) {
    return c.redirect(`/invoices/${id}?err=` + encodeURIComponent('Unrecognized send method.'));
  }
  // Confirming a second time silently overwrites the first sent_at/sent_method
  // with no trace of the original -- the same reasoning as the hosted resend
  // checkbox, so a mis-click or a revisited mail-app page cannot quietly
  // rewrite when an invoice actually went out.
  if (invoice.sent_at && String(body.confirmResend ?? '') !== '1') {
    return c.redirect(
      `/invoices/${id}?err=` +
        encodeURIComponent('This invoice is already marked sent. Confirm again to update the record.'),
    );
  }
  const updated = await markInvoiceSentManually(
    c.env,
    id,
    method,
    new Date().toISOString(),
    invoice.sent_at,
  );
  if (!updated)
    return c.redirect(
      `/invoices/${id}?err=` +
        encodeURIComponent(
          'Invoice changed before confirmation. Review its current status before trying again.',
        ),
    );
  return c.redirect(`/invoices/${id}?ok=` + encodeURIComponent('Invoice marked as sent manually.'));
});

app.post('/invoices/:id/cancel', async (c) => {
  const id = Number(c.req.param('id'));
  try {
    const body = await c.req.parseBody();
    const disposition = String(body.disposition ?? '');
    if (disposition !== 'return' && disposition !== 'delete') {
      throw new Error('Choose whether to return or delete the invoice hours.');
    }
    await cancelInvoice(c.env, id, disposition, new Date().toISOString());
    const message = disposition === 'return'
      ? 'Invoice canceled; entries returned to unbilled'
      : 'Invoice canceled; source entries deleted from future billing';
    return c.redirect(`/invoices/${id}?ok=` + encodeURIComponent(message));
  } catch (error) {
    return c.redirect(`/invoices/${id}?err=` + encodeURIComponent((error as Error).message));
  }
});

// ---- Sending an invoice ----------------------------------------------------

/**
 * The invoice as a PDF, byte for byte what gets attached to the email.
 *
 * Exists so the artifact can be LOOKED AT rather than assumed. A PDF that is
 * only ever produced inside a send is a PDF nobody checks, and the first
 * reviewer is then the client. Also useful in its own right: an operator who
 * wants to hand over a file, or post one, does not have to send an email to
 * get it.
 */
app.get('/invoices/:id/pdf', async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await buildInvoiceComposition(c.env, id);
  if (!ctx) return c.notFound();

  try {
    const pdf = await renderPdf(c.env.BROWSER, ctx.printHtml());
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        // Only successful PDF responses get attachment disposition. An error
        // stays a readable error page instead of downloading as a broken PDF.
        'Content-Disposition': `${c.req.query('download') === '1' ? 'attachment' : 'inline'}; filename="${invoicePdfFilename(ctx.invoice.number)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return c.text(`Could not render the invoice PDF: ${(e as Error).message}`, 502);
  }
});

app.get('/invoices/:id/email', async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await buildInvoiceComposition(c.env, id);
  if (!ctx) return c.notFound();
  // FAIL CLOSED on a missing customer record rather than `ctx.customer && ...`,
  // which would short-circuit to falsy (not denied) with no customer to check
  // a mode against.
  const denial = ctx.customer
    ? hostedSendDenialReason(ctx.customer.invoice_delivery_mode)
    : 'This invoice has no linked customer record.';
  if (denial) return c.text(denial, 403);
  if (ctx.invoice.status !== 'draft' && ctx.invoice.status !== 'sent') {
    return c.redirect(`/invoices/${id}?err=` + encodeURIComponent(`A ${ctx.invoice.status} invoice cannot be emailed.`));
  }

  return c.html(
    renderInvoiceSend(
      {
        business: ctx.profile.business.name,
        invoice: ctx.invoice,
        customerName: ctx.customer?.name ?? 'Client',
        to: ctx.to,
        from: ctx.from,
        subject: ctx.subject,
        previewHtml: invoiceEmailHtml(ctx.view),
        alreadySent: ctx.invoice.sent_at
          ? { at: ctx.invoice.sent_at, method: ctx.invoice.sent_method ?? 'unknown' }
          : null,
      },
      flashHtml(c),
    ),
  );
});

app.post('/invoices/:id/email', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  const ctx = await buildInvoiceComposition(c.env, id);
  if (!ctx) return c.notFound();
  // FAIL CLOSED on a missing customer record rather than `ctx.customer && ...`,
  // which would short-circuit to falsy (not denied) with no customer to check
  // a mode against.
  const denial = ctx.customer
    ? hostedSendDenialReason(ctx.customer.invoice_delivery_mode)
    : 'This invoice has no linked customer record.';
  if (denial) return c.text(denial, 403);
  if (ctx.invoice.status !== 'draft' && ctx.invoice.status !== 'sent') {
    return c.redirect(`/invoices/${id}?err=` + encodeURIComponent(`A ${ctx.invoice.status} invoice cannot be emailed.`));
  }

  if (!ctx.to) {
    return c.redirect(
      `/invoices/${id}/email?err=` +
        encodeURIComponent(`${ctx.customer?.name ?? 'This client'} has no billing email address.`),
    );
  }

  // A resend needs an explicit acknowledgement, not just a second click. The
  // client receives a second copy of the SAME invoice number, which reads as a
  // duplicate charge or a chase depending on who opens it -- and accounts
  // payable treat those very differently.
  if (ctx.invoice.sent_at && String(b.confirmResend ?? '') !== '1') {
    return c.redirect(
      `/invoices/${id}/email?err=` +
        encodeURIComponent(
          'This invoice was already sent. Tick the box to confirm a second copy should go out.',
        ),
    );
  }

  const from = ctx.from;
  const text = invoiceEmailText(ctx.view);
  const html = invoiceEmailHtml(ctx.view);

  // Render the PDF BEFORE sending, and refuse the send if it fails. Bryce:
  // "there needs to be a PDF attached." Sending without it would leave the
  // operator believing a document went out that did not -- and they would only
  // find out when the client asked for one.
  let pdf: ArrayBuffer;
  try {
    pdf = await renderPdf(c.env.BROWSER, ctx.printHtml());
  } catch (e) {
    return c.redirect(
      `/invoices/${id}/email?err=` +
        encodeURIComponent(`Not sent — the invoice PDF could not be rendered: ${(e as Error).message}`),
    );
  }

  // Re-check the delivery mode against a FRESH read, immediately before the
  // irreversible send. The check above ran before renderPdf's real network
  // round-trip to Browser Run, and a client edit landing in that window (a
  // second tab, a second operator, an automated correction) must still stop
  // this send -- the snapshot taken at the top of the request is stale by now.
  const currentCustomer = await getCustomer(c.env, ctx.invoice.customer_id);
  const currentDenial = currentCustomer
    ? hostedSendDenialReason(currentCustomer.invoice_delivery_mode)
    : 'This invoice has no linked customer record.';
  if (currentDenial) {
    return c.redirect(`/invoices/${id}/email?err=` + encodeURIComponent(`Not sent: ${currentDenial}`));
  }

  let messageId: string | null = null;
  try {
    const sent = await sendMail(c.env.EMAIL, from, {
      to: ctx.to,
      subject: ctx.subject,
      text,
      html,
      attachments: [
        {
          content: pdf,
          filename: invoicePdfFilename(ctx.invoice.number),
          type: 'application/pdf',
          disposition: 'attachment',
        },
      ],
    });
    messageId = sent.messageId;
  } catch (e) {
    // Do NOT mark it sent. An invoice recorded as sent that never left is worse
    // than one that failed loudly: the operator stops chasing it, and the first
    // anyone notices is when payment does not arrive.
    return c.redirect(
      `/invoices/${id}/email?err=` +
        encodeURIComponent(`Not sent: ${(e as Error).message}`),
    );
  }

  // Log it where the client's reply will land. Recording the Message-ID is what
  // lets their answer thread back onto this invoice rather than arriving as an
  // orphan about "your email".
  const threadId = await openOutboundThread(c.env, ctx.invoice.customer_id, ctx.subject);
  await storeOutbound(c.env, {
    threadId,
    messageId,
    inReplyTo: null,
    references: '',
    fromAddr: from,
    toAddrs: [ctx.to],
    subject: ctx.subject,
    bodyText: text,
  });

  await markInvoiceSent(c.env, id, 'email', new Date().toISOString());
  return c.redirect(
    `/invoices/${id}?ok=` + encodeURIComponent(`Sent to ${ctx.to}`),
  );
});

/**
 * The web fallback for a client set to send with their own mail app.
 *
 * A GET, same reasoning as the hosted send confirmation page: it survives a
 * refresh and can be linked to, and it never sends or marks anything by
 * itself. Reachable only for a client actually in mail_app mode, for the
 * same reason hosted send is reachable only in hosted mode -- the stored
 * per-client policy decides which one route applies, and this route is not
 * a second way to reach a client who is not configured for it.
 */
app.get('/invoices/:id/mail-app', async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await buildInvoiceComposition(c.env, id);
  if (!ctx) return c.notFound();
  if (ctx.customer?.invoice_delivery_mode !== 'mail_app') {
    return c.text('This client does not use the mail-app delivery mode.', 403);
  }
  if (ctx.invoice.status !== 'draft' && ctx.invoice.status !== 'sent') {
    return c.redirect(`/invoices/${id}?err=` + encodeURIComponent(`A ${ctx.invoice.status} invoice cannot be sent.`));
  }

  const draft = invoiceMailAppDraft({ ...ctx.view, to: ctx.to });

  return c.html(
    renderInvoiceMailApp(
      {
        business: ctx.profile.business.name,
        invoice: ctx.invoice,
        customerName: ctx.customer?.name ?? 'Client',
        to: ctx.to,
        draft,
        mailtoHref: mailtoHref(draft),
        alreadySent: ctx.invoice.sent_at
          ? { at: ctx.invoice.sent_at, method: ctx.invoice.sent_method ?? 'unknown' }
          : null,
      },
      flashHtml(c),
    ),
  );
});

/**
 * What the native iOS shell hands to `MFMailComposeViewController` for a
 * mail_app client -- the SAME composition a hosted client's email would get
 * (full line items, total, the shared subject line), also used by the browser
 * copy-body flow. A native compose sheet can attach the PDF directly; this
 * bridge was for a mail_app client to see an invoice indistinguishable from
 * what hosted delivery sends, just carried by the operator's own mail
 * account instead of HourChit's.
 *
 * `viaHourChit` is forced false: this is explicitly NOT sent over HourChit's
 * transport, so the sent-on-behalf-of disclosure that only makes sense for
 * hosted mail would be inaccurate here.
 */
app.get('/invoices/:id/mail-app/compose', async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await buildInvoiceComposition(c.env, id);
  if (!ctx) return c.notFound();
  if (ctx.customer?.invoice_delivery_mode !== 'mail_app') {
    return c.text('This client does not use the mail-app delivery mode.', 403);
  }
  if (ctx.invoice.status !== 'draft' && ctx.invoice.status !== 'sent') {
    return c.text(`A ${ctx.invoice.status} invoice cannot be sent.`, 409);
  }

  c.header('Cache-Control', 'private, no-store');
  return c.json({
    body: invoiceEmailText({ ...ctx.view, viaHourChit: false }),
    to: ctx.to,
    subject: ctx.subject,
    html: invoiceEmailHtml({ ...ctx.view, viaHourChit: false }),
    pdfUrl: `/invoices/${id}/pdf`,
    pdfFilename: invoicePdfFilename(ctx.invoice.number),
  });
});

function readFlash(ok?: string, err?: string) {
  if (ok) return { kind: 'ok' as const, text: ok };
  if (err) return { kind: 'err' as const, text: err };
  return undefined;
}

// The Hono app is exported by name so tests can drive it with app.request()
// without going through the Worker entry object.
export { app };

// Three entry points. `email` is Cloudflare Email Routing (src/email.ts);
// `queue` consumes Email Sending delivery events (src/queue.ts).
export default {
  fetch: app.fetch,
  email: handleEmail,
  queue: handleQueue,
};
