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
  createMileage,
  getInvoice,
  getRoute,
  getTask,
  invoiceContents,
  invoiceLines,
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
import { getThread, listThreads, storeOutbound, threadMessages } from './inbox';
import { sendMail } from './mail/send';
import { renderInvoice } from './ui/invoice';

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
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    tenant: c.env.TENANT_PROFILE,
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
