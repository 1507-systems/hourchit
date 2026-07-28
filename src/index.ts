import { Hono } from 'hono';
import type { Env } from './env';
// Written by scripts/generate-build-info.mjs. Run `npm run codegen` if your
// editor flags this as missing.
import { CONFIG_SHA, GIT_SHA } from './build-info.generated';
import { handleLogin, handleLogout, loginPage, requireAuth } from './auth';
import { loadProfile } from './config/profiles';
import { mileageRuleFromSettings } from './config/profile';
import { classifyTrip, routeTableDistance } from './domain/mileage';
import { durationSeconds } from './domain/time';
import { mileageAmountCents, timeAmountCents } from './domain/money';
import {
  createInvoiceForCustomer,
  createMileage,
  getInvoice,
  getRoute,
  getTask,
  invoiceContents,
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
import { renderInvoice } from './ui/invoice';

const app = new Hono<{ Bindings: Env }>();

// Health check — unauthenticated, and deliberately so: it is what a deploy
// pipeline reads back to confirm the deploy actually took effect. A deploy
// that silently no-ops is otherwise indistinguishable from a successful one.
// It reports only the build identity and which tenant is configured — never
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
app.get('/login', (c) => loginPage(c));
app.post('/login', (c) => handleLogin(c));
app.get('/logout', (c) => handleLogout(c));

// Everything below requires the shared-secret cookie.
app.use('*', requireAuth);

app.get('/', async (c) => {
  const env = c.env;
  const profile = loadProfile(env.TENANT_PROFILE);
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

  const timeCents = taskViews.reduce(
    (acc, t) => acc + timeAmountCents(t.unbilledSeconds, t.rateCentsPerHour),
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
  return c.redirect('/?ok=' + encodeURIComponent(`Logged ${miles} mi — ${verdict}`));
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
  return c.html(renderInvoice({ business: profile.business, customer, invoice, contents }));
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

export default app;
