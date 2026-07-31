/**
 * D1 data layer. Thin, typed wrappers around SQL. Duration/mileage/invoice math
 * lives in domain/* (pure + tested); this module only reads and writes rows.
 */
import type { Env } from './env';
import { durationSeconds, TimeEntry } from './domain/time';
import { buildInvoice, invoiceNumber, MileageItem, TaskTimeAggregate } from './domain/invoicing';
import { billableSeconds, type BillingTerms } from './domain/billing';

export interface Customer {
  id: number;
  name: string;
  address: string;
  email: string;
  archived: number;
}

export interface Task {
  id: number;
  customer_id: number;
  name: string;
  description: string;
  rate_cents_per_hour: number;
  active: number;
}

export interface Route {
  id: number;
  label: string;
  from_address: string;
  to_address: string;
  one_way_miles: number;
}

export interface Invoice {
  id: number;
  customer_id: number;
  number: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  time_subtotal_cents: number;
  mileage_subtotal_cents: number;
  total_cents: number;
  currency: string;
  created_at: string;
  sent_at: string | null;
  sent_method: string | null;
}

export interface MileageRow {
  id: number;
  customer_id: number;
  task_id: number | null;
  route_id: number | null;
  occurred_local: string;
  miles: number;
  billable: number;
  reason: string;
  rate_cents_per_mile: number;
  note: string | null;
  invoice_id: number | null;
}

const db = (env: Env) => env.DB;

// ---- Customers -------------------------------------------------------------

export async function listCustomers(env: Env): Promise<Customer[]> {
  const { results } = await db(env)
    .prepare('SELECT * FROM customers WHERE archived = 0 ORDER BY name')
    .all<Customer>();
  return results ?? [];
}

export async function getCustomer(env: Env, id: number): Promise<Customer | null> {
  return db(env).prepare('SELECT * FROM customers WHERE id = ?').bind(id).first<Customer>();
}

export async function createCustomer(
  env: Env,
  c: { name: string; address: string; email: string },
): Promise<number> {
  const r = await db(env)
    .prepare('INSERT INTO customers (name, address, email) VALUES (?, ?, ?)')
    .bind(c.name, c.address, c.email)
    .run();
  return r.meta.last_row_id as number;
}

// ---- Tasks -----------------------------------------------------------------

export async function listTasks(env: Env, customerId?: number): Promise<Task[]> {
  const stmt = customerId
    ? db(env)
        .prepare('SELECT * FROM tasks WHERE active = 1 AND customer_id = ? ORDER BY name')
        .bind(customerId)
    : db(env).prepare('SELECT * FROM tasks WHERE active = 1 ORDER BY name');
  const { results } = await stmt.all<Task>();
  return results ?? [];
}

export async function getTask(env: Env, id: number): Promise<Task | null> {
  return db(env).prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<Task>();
}

export async function createTask(
  env: Env,
  t: { customerId: number; name: string; description: string; rateCentsPerHour: number },
): Promise<number> {
  const r = await db(env)
    .prepare(
      'INSERT INTO tasks (customer_id, name, description, rate_cents_per_hour) VALUES (?, ?, ?, ?)',
    )
    .bind(t.customerId, t.name, t.description, t.rateCentsPerHour)
    .run();
  return r.meta.last_row_id as number;
}

// ---- Routes ----------------------------------------------------------------

export async function listRoutes(env: Env): Promise<Route[]> {
  const { results } = await db(env).prepare('SELECT * FROM routes ORDER BY label').all<Route>();
  return results ?? [];
}

export async function getRoute(env: Env, id: number): Promise<Route | null> {
  return db(env).prepare('SELECT * FROM routes WHERE id = ?').bind(id).first<Route>();
}

export async function createRoute(
  env: Env,
  r: { label: string; fromAddress: string; toAddress: string; oneWayMiles: number },
): Promise<number> {
  const res = await db(env)
    .prepare('INSERT INTO routes (label, from_address, to_address, one_way_miles) VALUES (?, ?, ?, ?)')
    .bind(r.label, r.fromAddress, r.toAddress, r.oneWayMiles)
    .run();
  return res.meta.last_row_id as number;
}

// ---- Timer -----------------------------------------------------------------

function mapTimeRow(row: any): TimeEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    note: row.note,
    invoiceId: row.invoice_id,
  };
}

export async function getRunningEntry(env: Env): Promise<TimeEntry | null> {
  const row = await db(env)
    .prepare('SELECT * FROM time_entries WHERE stopped_at IS NULL LIMIT 1')
    .first();
  return row ? mapTimeRow(row) : null;
}

/** Start a timer on a task. Rejects if one is already running. */
export async function startTimer(env: Env, taskId: number, nowIso: string): Promise<void> {
  if (await getRunningEntry(env)) {
    throw new Error('A timer is already running. Stop it first.');
  }
  await db(env)
    .prepare('INSERT INTO time_entries (task_id, started_at) VALUES (?, ?)')
    .bind(taskId, nowIso)
    .run();
}

/** Stop the running timer. Returns the seconds recorded, or null if none ran. */
export async function stopTimer(env: Env, nowIso: string): Promise<number | null> {
  const running = await getRunningEntry(env);
  if (!running) return null;
  await db(env)
    .prepare('UPDATE time_entries SET stopped_at = ? WHERE id = ?')
    .bind(nowIso, running.id)
    .run();
  return durationSeconds(running.startedAt, nowIso);
}

/** Unbilled, finished time entries joined with their task, for a customer. */
export async function unbilledTimeEntries(env: Env, customerId: number): Promise<
  Array<TimeEntry & { taskName: string; rateCentsPerHour: number }>
> {
  const { results } = await db(env)
    .prepare(
      `SELECT te.*, t.name AS task_name, t.rate_cents_per_hour AS rate
         FROM time_entries te
         JOIN tasks t ON t.id = te.task_id
        WHERE te.invoice_id IS NULL
          AND te.stopped_at IS NOT NULL
          AND t.customer_id = ?
        ORDER BY te.started_at`,
    )
    .bind(customerId)
    .all<any>();
  return (results ?? []).map((row) => ({
    ...mapTimeRow(row),
    taskName: row.task_name,
    rateCentsPerHour: row.rate,
  }));
}

// ---- Mileage ---------------------------------------------------------------

export async function createMileage(
  env: Env,
  m: {
    customerId: number;
    taskId: number | null;
    routeId: number | null;
    occurredLocal: string;
    miles: number;
    billable: boolean;
    reason: string;
    rateCentsPerMile: number;
    note: string | null;
  },
): Promise<number> {
  const r = await db(env)
    .prepare(
      `INSERT INTO mileage_entries
         (customer_id, task_id, route_id, occurred_local, miles, billable, reason, rate_cents_per_mile, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      m.customerId,
      m.taskId,
      m.routeId,
      m.occurredLocal,
      m.miles,
      m.billable ? 1 : 0,
      m.reason,
      m.rateCentsPerMile,
      m.note,
    )
    .run();
  return r.meta.last_row_id as number;
}

export async function listRecentMileage(
  env: Env,
  customerId: number,
  limit = 10,
): Promise<MileageRow[]> {
  const { results } = await db(env)
    .prepare(
      'SELECT * FROM mileage_entries WHERE customer_id = ? ORDER BY occurred_local DESC LIMIT ?',
    )
    .bind(customerId, limit)
    .all<MileageRow>();
  return results ?? [];
}

export async function unbilledMileage(env: Env, customerId: number): Promise<MileageRow[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT * FROM mileage_entries
        WHERE invoice_id IS NULL AND billable = 1 AND customer_id = ?
        ORDER BY occurred_local`,
    )
    .bind(customerId)
    .all<MileageRow>();
  return results ?? [];
}

// ---- Invoices --------------------------------------------------------------

export async function listInvoices(env: Env): Promise<Invoice[]> {
  const { results } = await db(env)
    .prepare('SELECT * FROM invoices ORDER BY id DESC')
    .all<Invoice>();
  return results ?? [];
}

export async function getInvoice(env: Env, id: number): Promise<Invoice | null> {
  return db(env).prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<Invoice>();
}

export interface InvoiceLine {
  id: number;
  invoice_id: number;
  kind: string;
  description: string;
  quantity: number;
  unit: string;
  rate_cents: number;
  amount_cents: number;
  sort_order: number;
}

export interface InvoiceContents {
  timeEntries: Array<TimeEntry & { taskName: string; rateCentsPerHour: number }>;
  mileage: MileageRow[];
}

/**
 * Create an invoice from everything currently unbilled for a customer. Marks
 * those time + mileage rows as belonging to the new invoice so they never get
 * billed twice, the cumulative unbilled total resets to zero afterward.
 */
export async function createInvoiceForCustomer(
  env: Env,
  customerId: number,
  invoicePrefix: string,
  currency: string,
  /**
   * From the tenant profile. Passed rather than defaulted so a deployment whose
   * client does not reimburse travel cannot accidentally bill it — see
   * ProfileSettings.mileageBillable.
   */
  mileageBillable: boolean,
  /**
   * The tenant's billing increment and minimum call-out. Passed rather than
   * defaulted for the same reason as mileageBillable: these decide what a client
   * owes, and a default would let one tenant's terms apply to another's invoice.
   */
  terms: BillingTerms,
): Promise<Invoice> {
  const time = await unbilledTimeEntries(env, customerId);
  const mileage = await unbilledMileage(env, customerId);

  if (time.length === 0 && mileage.length === 0) {
    throw new Error('Nothing unbilled to invoice for this customer.');
  }

  // Aggregate time per task and describe each mileage trip for the totals.
  const perTask = new Map<number, TaskTimeAggregate>();
  for (const e of time) {
    const agg = perTask.get(e.taskId) ?? {
      taskId: e.taskId,
      taskName: e.taskName,
      rateCentsPerHour: e.rateCentsPerHour,
      seconds: 0,
    };
    // Rounded PER ATTENDANCE before summing. MSA 1.5 makes the minimum apply to
    // each confirmed attendance, so three short visits are three minimums;
    // rounding the aggregate instead would bill for one.
    agg.seconds += billableSeconds(
      durationSeconds(e.startedAt, e.stoppedAt as string),
      terms,
      e.startedAt,
    );
    perTask.set(e.taskId, agg);
  }
  const mileageItems: MileageItem[] = mileage.map((m) => ({
    description: `Mileage: ${m.occurred_local.slice(0, 10)} (${m.reason})`,
    miles: m.miles,
    rateCentsPerMile: m.rate_cents_per_mile,
  }));

  const totals = buildInvoice([...perTask.values()], mileageItems, { mileageBillable });

  const period = invoicePeriod(time, mileage);

  const inserted = await db(env)
    .prepare(
      `INSERT INTO invoices
         (customer_id, status, period_start, period_end,
          time_subtotal_cents, mileage_subtotal_cents, total_cents, currency)
       VALUES (?, 'draft', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      customerId,
      period.start,
      period.end,
      totals.timeSubtotalCents,
      totals.mileageSubtotalCents,
      totals.totalCents,
      currency,
    )
    .run();
  const invoiceId = inserted.meta.last_row_id as number;

  const number = invoiceNumber(invoicePrefix, invoiceId);
  await db(env).prepare('UPDATE invoices SET number = ? WHERE id = ?').bind(number, invoiceId).run();

  // Freeze the lines as issued. From here the invoice is a record, not a query:
  // later changes to the increment, the minimum call-out or the tenant timezone
  // must never restate a document somebody has already been sent.
  const lineStmts = totals.lines.map((l, i) =>
    db(env)
      .prepare(
        `INSERT INTO invoice_lines
           (invoice_id, kind, description, quantity, unit, rate_cents, amount_cents, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(invoiceId, l.kind, l.description, l.quantity, l.unit, l.rateCents, l.amountCents, i),
  );
  if (lineStmts.length) await db(env).batch(lineStmts);

  // Attach the billed rows.
  const stmts: D1PreparedStatement[] = [];
  for (const e of time) {
    stmts.push(
      db(env).prepare('UPDATE time_entries SET invoice_id = ? WHERE id = ?').bind(invoiceId, e.id),
    );
  }
  for (const m of mileage) {
    stmts.push(
      db(env)
        .prepare('UPDATE mileage_entries SET invoice_id = ? WHERE id = ?')
        .bind(invoiceId, m.id),
    );
  }
  if (stmts.length) await db(env).batch(stmts);

  return (await getInvoice(env, invoiceId)) as Invoice;
}

/**
 * The lines exactly as they were written when the invoice was issued.
 *
 * Returns an empty array for invoices created before line items were persisted;
 * the caller falls back to recomputing those, which is the best that can be done
 * for a document whose composition was never recorded.
 */
export async function invoiceLines(env: Env, invoiceId: number): Promise<InvoiceLine[]> {
  const { results } = await db(env)
    .prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id')
    .bind(invoiceId)
    .all<InvoiceLine>();
  return results ?? [];
}

export async function invoiceContents(env: Env, invoiceId: number): Promise<InvoiceContents> {
  const { results: timeRows } = await db(env)
    .prepare(
      `SELECT te.*, t.name AS task_name, t.rate_cents_per_hour AS rate
         FROM time_entries te JOIN tasks t ON t.id = te.task_id
        WHERE te.invoice_id = ? ORDER BY te.started_at`,
    )
    .bind(invoiceId)
    .all<any>();
  const { results: mileageRows } = await db(env)
    .prepare('SELECT * FROM mileage_entries WHERE invoice_id = ? ORDER BY occurred_local')
    .bind(invoiceId)
    .all<MileageRow>();
  return {
    timeEntries: (timeRows ?? []).map((row) => ({
      ...mapTimeRow(row),
      taskName: row.task_name,
      rateCentsPerHour: row.rate,
    })),
    mileage: mileageRows ?? [],
  };
}

export async function markInvoiceSent(env: Env, id: number, method: string, nowIso: string): Promise<void> {
  await db(env)
    .prepare("UPDATE invoices SET status = 'sent', sent_at = ?, sent_method = ? WHERE id = ?")
    .bind(nowIso, method, id)
    .run();
}

function invoicePeriod(
  time: Array<{ startedAt: string }>,
  mileage: Array<{ occurred_local: string }>,
): { start: string | null; end: string | null } {
  const dates = [
    ...time.map((t) => t.startedAt.slice(0, 10)),
    ...mileage.map((m) => m.occurred_local.slice(0, 10)),
  ].sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : { start: null, end: null };
}
