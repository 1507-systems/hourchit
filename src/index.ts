import { Hono, type Context } from 'hono';
import { handleEmail } from './email';
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
  tokenLoginPage,
} from './auth';
import { loadProfile } from './config/profiles';
import { mileageRuleFromSettings, type TenantProfile } from './config/profile';
import { classifyTrip, routeTableDistance } from './domain/mileage';
import { durationSeconds } from './domain/time';
import { amountCentsFor, billableSeconds, type BillingTerms } from './domain/billing';
import { mileageAmountCents } from './domain/money';
import {
  createInvoiceForCustomer,
  createCustomer,
  createMileage,
  createRoute,
  createTask,
  getInvoice,
  getRoute,
  getTask,
  invoiceContents,
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
  markInvoiceSent,
  startTimer,
  stopTimer,
  unbilledMileage,
  unbilledTimeEntries,
  getCustomer,
  getRunningEntry,
} from './db';
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
import { parseDuration } from './domain/duration';
import { localDateString, utcToZonedWallTime, zonedWallTimeToUtc } from './domain/localtime';
import { renderNotice } from './ui/notice';
import type { MinimumCallOut } from './domain/billing';
import { getThread, listThreads, openOutboundThread, storeOutbound, threadMessages } from './inbox';
import { sendMail } from './mail/send';
import { renderInvoice } from './ui/invoice';
import { renderInvoiceSend } from './ui/invoice-send';
import { invoiceEmailHtml, invoiceEmailSubject, invoiceEmailText } from './mail/invoice-email';
import { invoicePdfFilename, renderPdf } from './mail/invoice-pdf';

const app = new Hono<{ Bindings: Env }>();

/**
 * The tenant's billing terms in one place, so every caller reads the same
 * fields. weekendDays and timezone travel with the terms because a day-split
 * minimum cannot be resolved without them.
 */
function termsFor(profile: TenantProfile): BillingTerms {
  return {
    incrementMinutes: profile.settings.billingIncrementMinutes,
    minimumCallOutMinutes: profile.settings.minimumCallOutMinutes,
    weekendDays: profile.settings.weekendDays,
    timezone: profile.settings.timezone,
  };
}

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
  let runningView: { taskName: string; startedAtMs: number } | null = null;
  if (running) {
    const rt = await getTask(env, running.taskId);
    runningView = { taskName: rt?.name ?? 'Task', startedAtMs: Date.parse(running.startedAt) };
  }

  const unbilledTime = customer ? await unbilledTimeEntries(env, customer.id) : [];
  const secByTask = new Map<number, number>();
  for (const e of unbilledTime) {
    secByTask.set(
      e.taskId,
      (secByTask.get(e.taskId) ?? 0) + durationSeconds(e.startedAt, e.stoppedAt as string),
    );
  }
  const taskViews: TaskView[] = tasks.map((t) => ({
    id: t.id,
    name: t.name,
    rateCentsPerHour: t.rate_cents_per_hour,
    unbilledSeconds: secByTask.get(t.id) ?? 0,
  }));

  const mileage = customer ? await unbilledMileage(env, customer.id) : [];
  const recentMileage = customer ? await listRecentMileage(env, customer.id) : [];

  // The MONEY is billable time; the H:MM shown per task stays actual elapsed.
  // Those are different questions -- "how long was I there" and "what does that
  // invoice as" -- and conflating them would either hide real hours worked or
  // preview a total the invoice then disagrees with.
  const billableByTask = new Map<number, number>();
  for (const e of unbilledTime) {
    billableByTask.set(
      e.taskId,
      (billableByTask.get(e.taskId) ?? 0) +
        billableSeconds(durationSeconds(e.startedAt, e.stoppedAt as string), terms, e.startedAt),
    );
  }
  const timeCents = taskViews.reduce(
    (acc, t) => acc + amountCentsFor(billableByTask.get(t.id) ?? 0, t.rateCentsPerHour),
    0,
  );
  const mileageCents = mileage.reduce(
    (acc, m) => acc + mileageAmountCents(m.miles, m.rate_cents_per_mile),
    0,
  );

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
      unbilledTotalCents: timeCents + mileageCents,
      flash: readFlash(c.req.query('ok'), c.req.query('err')),
    }),
  );
});

app.post('/timer/start', async (c) => {
  const body = await c.req.parseBody();
  const taskId = Number(body.taskId);
  try {
    await startTimer(c.env, taskId, new Date().toISOString());
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
function flashHtml(c: Context<{ Bindings: Env }>): string {
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

function tenantAddress(c: Context<{ Bindings: Env }>): string {
  const domain = c.env.HOSTED_MAIL_DOMAIN ?? 'hosted.hourchit.app';
  return `${c.env.TENANT_PROFILE}@${domain}`;
}

/**
 * Who an invoice comes FROM, and it is not the same address as a login code.
 *
 * Bryce's four-party rule, 2026-07-30: anything from HourChit (the 1507
 * product) to ITS users -- a tenant like Matt's A/V -- comes from the hourchit
 * apex, because that is the app speaking as itself. Anything from a TENANT to
 * THEIR OWN clients comes from hosted.hourchit.app, unless that tenant has
 * configured their own mail. "Think of it like how Zoho runs."
 *
 * An invoice is squarely the second: Matt's A/V billing the University of
 * Bridgeport. Sending it from noreply@hourchit.app would put a vendor the
 * client has never heard of on a demand for money, which is both confusing and
 * exactly the shape of an invoice-fraud email.
 */
function invoiceMailFrom(c: Context<{ Bindings: Env }>): string {
  return tenantAddress(c);
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

  return c.html(
    renderSettings(
      {
        business: profile.business.name,
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
  return c.html(renderClients(profile.business.name, await listAllCustomers(c.env), flashHtml(c)));
});

app.post('/clients', async (c) => {
  const b = await c.req.parseBody();
  const name = String(b.name ?? '').trim();
  if (!name) return c.redirect('/clients?err=' + encodeURIComponent('A client needs a name'));
  const id = await createCustomer(c.env, {
    name,
    address: String(b.address ?? ''),
    email: String(b.email ?? ''),
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
      flashHtml(c),
    ),
  );
});

app.post('/clients/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  const folder = String(b.workdriveFolderId ?? '').trim();
  await updateCustomer(c.env, id, {
    name: String(b.name ?? '').trim(),
    address: String(b.address ?? ''),
    email: String(b.email ?? ''),
    notes: String(b.notes ?? ''),
    workdriveFolderId: folder.length > 0 ? folder : null,
    // Blank means UNSTATED, not zero. Coercing an empty field to 0 would
    // record that this client agreed to no notice at all, which is a term
    // nobody negotiated -- and it would then shorten the floor for every other
    // client, since the binding period is the longest across them.
    noticeDays: noticeDaysFromForm(b.noticeDays),
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

  const from = tenantAddress(c);
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
  const body = await c.req.parseBody();
  const customerId = Number(body.customerId);
  try {
    const invoice = await createInvoiceForCustomer(
      env,
      customerId,
      profile.settings.invoicePrefix,
      profile.settings.currency,
      profile.settings.mileageBillable,
      termsFor(profile),
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
  return c.html(
    renderInvoice({
      business: profile.business,
      customer,
      invoice,
      contents,
      terms: termsFor(profile),
      lines,
    }),
  );
});

app.post('/invoices/:id/send', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  const method = String(body.method ?? 'print');
  // Email delivery is a pluggable stub for round one; "print" just marks it sent.
  await markInvoiceSent(c.env, id, method, new Date().toISOString());
  return c.redirect(`/invoices/${id}`);
});


// ---- Sending an invoice ----------------------------------------------------

/**
 * Everything needed to compose and send one invoice, or a reason we cannot.
 *
 * Assembled once and shared by the confirm page and the send itself, so what
 * the operator was shown and what actually goes out cannot drift apart. Two
 * separate assemblies would eventually disagree, and the confirm step exists
 * precisely so that nothing goes out unseen.
 */
async function invoiceEmailFor(c: Context<{ Bindings: Env }>, id: number) {
  const invoice = await getInvoice(c.env, id);
  if (!invoice) return null;
  const profile = loadProfile(c.env.TENANT_PROFILE);
  const customer = await getCustomer(c.env, invoice.customer_id);
  const lines = await invoiceLines(c.env, id);

  const from = invoiceMailFrom(c);
  const view = {
    invoice,
    lines,
    business: profile.business,
    customer: { name: customer?.name ?? 'Client' },
    // The disclosure belongs on mail leaving over HourChit's shared domain. A
    // tenant sending from their own would be naming a vendor not in the path.
    viaHourChit: from.endsWith(`@${c.env.HOSTED_MAIL_DOMAIN ?? 'hosted.hourchit.app'}`),
  };
  return {
    invoice,
    customer,
    profile,
    view,
    from,
    to: customer?.email?.trim() ? customer.email.trim() : null,
    subject: invoiceEmailSubject(view),
    /** The web invoice, rendered for the PDF attachment. */
    printHtml: () =>
      renderInvoice({
        business: profile.business,
        customer: customer as NonNullable<typeof customer>,
        invoice,
        contents: { timeEntries: [], mileage: [] },
        terms: termsFor(profile),
        lines,
      }),
  };
}

app.get('/invoices/:id/email', async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await invoiceEmailFor(c, id);
  if (!ctx) return c.notFound();

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
  const ctx = await invoiceEmailFor(c, id);
  if (!ctx) return c.notFound();

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

function readFlash(ok?: string, err?: string) {
  if (ok) return { kind: 'ok' as const, text: ok };
  if (err) return { kind: 'err' as const, text: err };
  return undefined;
}

// The Hono app is exported by name so tests can drive it with app.request()
// without going through the Worker entry object.
export { app };

// Both entry points. `email` is Cloudflare Email Routing; see src/email.ts.
export default {
  fetch: app.fetch,
  email: handleEmail,
};
