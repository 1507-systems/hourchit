/**
 * D1 data layer. Thin, typed wrappers around SQL. Duration/mileage/invoice math
 * lives in domain/* (pure + tested); this module only reads and writes rows.
 */
import type { Env } from './env';
import { durationSeconds, TimeEntry } from './domain/time';
import { aggregateInvoiceTime, buildInvoice, MileageItem } from './domain/invoicing';
import { type BillingTerms } from './domain/billing';
import {
  billableTimeEntries,
  selectionIds,
  parsePendingBillingDisplay,
  type InvoiceSelection,
  type PendingBillingDisplay,
} from './domain/pending-billing';
import { type TermVersion, type TaskRateVersion } from './domain/terms';
import {
  sanitizeDashboardPreferences,
  type DashboardPreferences,
} from './domain/dashboard-preferences';
import {
  parseInvoiceDeliveryMode,
  type InvoiceDeliveryMode,
} from './domain/invoice-delivery';

export interface Customer {
  id: number;
  name: string;
  address: string;
  email: string;
  archived: number;
  workdrive_folder_id: string | null;
  notes: string;
  /**
   * Days of written notice a rate change owes this client, per their SOW.
   *
   * NULL means UNSTATED, which is not the same as none. Nobody has read this
   * client's agreement into the system yet, and the app refuses to compute an
   * earliest-effective-date rather than invent one.
   */
  notice_days: number | null;
  /**
   * How this client's invoices leave the building. Always explicit -- see
   * domain/invoice-delivery.ts. Copied from the tenant default at creation;
   * a later change to that default never rewrites an existing client.
   */
  invoice_delivery_mode: InvoiceDeliveryMode;
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
  active: number;
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
  lines_frozen?: number;
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

// ---- Dashboard preferences ------------------------------------------------

interface DashboardPreferenceRow {
  module_order: string;
  hidden_modules: string;
}

function dashboardUserKey(userKey: string): string {
  return userKey.trim().toLowerCase();
}

function parsePreferenceJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export async function getDashboardPreferences(
  env: Env,
  userKey: string,
): Promise<DashboardPreferences> {
  const row = await db(env)
    .prepare(
      'SELECT module_order, hidden_modules FROM dashboard_preferences WHERE user_key = ?',
    )
    .bind(dashboardUserKey(userKey))
    .first<DashboardPreferenceRow>();

  return sanitizeDashboardPreferences(
    row
      ? {
          order: parsePreferenceJson(row.module_order),
          hidden: parsePreferenceJson(row.hidden_modules),
        }
      : null,
  );
}

export async function saveDashboardPreferences(
  env: Env,
  userKey: string,
  preferences: DashboardPreferences,
): Promise<void> {
  const sanitized = sanitizeDashboardPreferences(preferences);
  await db(env)
    .prepare(
      `INSERT INTO dashboard_preferences (user_key, module_order, hidden_modules)
       VALUES (?, ?, ?)
       ON CONFLICT(user_key) DO UPDATE SET
         module_order = excluded.module_order,
         hidden_modules = excluded.hidden_modules,
         updated_at = datetime('now')`,
    )
    .bind(
      dashboardUserKey(userKey),
      JSON.stringify(sanitized.order),
      JSON.stringify(sanitized.hidden),
    )
    .run();
}

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
  c: {
    name: string;
    address: string;
    email: string;
    notes?: string;
    noticeDays?: number | null;
    invoiceDeliveryMode: InvoiceDeliveryMode;
  },
): Promise<number> {
  const r = await db(env)
    .prepare(
      'INSERT INTO customers (name, address, email, notes, notice_days, invoice_delivery_mode) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(c.name, c.address, c.email, c.notes ?? '', c.noticeDays ?? null, c.invoiceDeliveryMode)
    .run();
  return r.meta.last_row_id as number;
}

// ---- Tenant-wide settings ---------------------------------------------------

const INVOICE_DELIVERY_DEFAULT_KEY = 'invoice_delivery_default';

/**
 * The mode a newly created client starts with. Read at client-creation time
 * only -- see resolveNewClientMode. Returns null for a missing or unreadable
 * row so the caller can fail closed rather than guess a mode nobody set.
 */
export async function getInvoiceDeliveryDefault(env: Env): Promise<InvoiceDeliveryMode | null> {
  const row = await db(env)
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(INVOICE_DELIVERY_DEFAULT_KEY)
    .first<{ value: string }>();
  return row ? parseInvoiceDeliveryMode(row.value) : null;
}

export async function setInvoiceDeliveryDefault(env: Env, mode: InvoiceDeliveryMode): Promise<void> {
  await db(env)
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(INVOICE_DELIVERY_DEFAULT_KEY, mode)
    .run();
}

/** Presentation only: changing this never alters invoice lines or billing rules. */
export async function getPendingBillingDisplay(env: Env): Promise<PendingBillingDisplay> {
  const row = await db(env)
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind('pending_billing_display')
    .first<{ value: string }>();
  return parsePendingBillingDisplay(row?.value) ?? 'task';
}
export async function setPendingBillingDisplay(
  env: Env,
  mode: PendingBillingDisplay,
): Promise<void> {
  if (!parsePendingBillingDisplay(mode)) throw new Error('Choose a valid pending billing display.');
  await db(env)
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind('pending_billing_display', mode)
    .run();
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
  t: {
    customerId: number;
    name: string;
    description: string;
    rateCentsPerHour: number;
  },
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
  r: {
    label: string;
    fromAddress: string;
    toAddress: string;
    oneWayMiles: number;
  },
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
    chargeCode: row.charge_code ?? null,
    voidedAt: row.voided_at ?? null,
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
export async function startTimer(
  env: Env,
  taskId: number,
  nowIso: string,
  eventName: string,
  chargeCode: string | null,
): Promise<void> {
  if (await getRunningEntry(env)) {
    throw new Error('A timer is already running. Stop it first.');
  }
  await db(env)
    .prepare('INSERT INTO time_entries (task_id, started_at, note, charge_code) VALUES (?, ?, ?, ?)')
    .bind(taskId, nowIso, eventName, chargeCode)
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

/**
 * Record a completed attendance directly -- no live timer involved. Both
 * timestamps are set at INSERT time, so this can never collide with
 * idx_time_one_running (that index only constrains rows where stopped_at IS
 * NULL).
 */
export async function logManualEntry(
  env: Env,
  taskId: number,
  startedAt: string,
  stoppedAt: string,
  note: string | null,
  chargeCode: string | null,
): Promise<void> {
  await db(env)
    .prepare('INSERT INTO time_entries (task_id, started_at, stopped_at, note, charge_code) VALUES (?, ?, ?, ?, ?)')
    .bind(taskId, startedAt, stoppedAt, note, chargeCode)
    .run();
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
          AND te.voided_at IS NULL
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
        WHERE invoice_id IS NULL AND voided_at IS NULL AND billable = 1 AND customer_id = ?
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
  detail: string | null;
  service_date: string | null;
  charge_code?: string | null;
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
 * Create an invoice from explicitly selected pending entries. Validate again
 * inside an atomic batch so concurrent requests cannot claim the same work.
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
   * FALLBACK terms, from the tenant profile. Used only when no term version
   * covers a piece of work -- which for a tenant seeded from its profile should
   * never happen, but a missing version must not make an entry unbillable.
   */
  terms: BillingTerms,
  selection: InvoiceSelection,
): Promise<Invoice> {
  if (!Number.isSafeInteger(customerId) || customerId <= 0)
    throw new Error('Choose a valid client.');
  const timeIds = selectionIds(selection?.timeEntryIds);
  const mileageIds = selectionIds(selection?.mileageIds);
  if (!timeIds.length && !mileageIds.length)
    throw new Error('Select at least one pending billing entry.');
  if (!mileageBillable && mileageIds.length)
    throw new Error('Mileage is not billable for this tenant.');
  const time = (await unbilledTimeEntries(env, customerId)).filter((e) => timeIds.includes(e.id));
  const mileage = (await unbilledMileage(env, customerId)).filter((e) => mileageIds.includes(e.id));
  if (time.length !== timeIds.length || mileage.length !== mileageIds.length) {
    throw new Error(
      'Selected entries are no longer available. Refresh pending billings and select again.',
    );
  }

  // Terms and per-task rates are resolved PER ENTRY against the moment the work
  // was PERFORMED, never against now. A rate that rose last week must not
  // reprice the hours logged before it -- that work was done under the older
  // terms, and billing it at a rate the client never agreed to is what gets an
  // invoice disputed.
  const termVersions = await listTermVersions(env);
  const rateHistory = await taskRateHistory(env);

  if (time.length === 0 && mileage.length === 0) {
    throw new Error('Nothing unbilled to invoice for this customer.');
  }

  const billableEntries = billableTimeEntries(time, terms, termVersions, rateHistory);
  const mileageItems: MileageItem[] = mileage.map((m) => ({
    description: `Mileage: ${m.occurred_local.slice(0, 10)} (${m.reason})`,
    miles: m.miles,
    rateCentsPerMile: m.rate_cents_per_mile,
  }));

  const totals = buildInvoice(aggregateInvoiceTime(billableEntries), mileageItems, { mileageBillable });

  const period = invoicePeriod(time, mileage);

  // A private temporary number identifies this invoice inside one atomic D1
  // batch. last_insert_rowid() cannot serve that purpose after line inserts.
  // The first statement checks source snapshots again under the transaction:
  // a stale selection violates customer_id's NOT NULL constraint and aborts
  // the entire batch, including any invoice/line/source changes.
  const token = `pending-${crypto.randomUUID()}`;
  const timeSnapshot = JSON.stringify(
    time.map((e) => [e.id, e.taskId, e.startedAt, e.stoppedAt, e.note, e.chargeCode ?? null]),
  );
  const mileageSnapshot = JSON.stringify(
    mileage.map((m) => [m.id, m.occurred_local, m.miles, m.rate_cents_per_mile, m.reason]),
  );
  const stmts: D1PreparedStatement[] = [
    db(env)
      .prepare(
        `
    INSERT INTO invoices (number, customer_id, status, period_start, period_end,
      time_subtotal_cents, mileage_subtotal_cents, total_cents, currency, lines_frozen)
    VALUES (?, CASE WHEN
      (SELECT count(*) FROM time_entries te JOIN tasks t ON t.id = te.task_id
       JOIN json_each(?) selected ON te.id = json_extract(selected.value, '$[0]')
       WHERE t.customer_id = ? AND te.invoice_id IS NULL AND te.voided_at IS NULL
         AND te.stopped_at IS NOT NULL
         AND te.task_id = json_extract(selected.value, '$[1]')
         AND te.started_at = json_extract(selected.value, '$[2]')
         AND te.stopped_at = json_extract(selected.value, '$[3]')
         AND te.note IS json_extract(selected.value, '$[4]')
         AND te.charge_code IS json_extract(selected.value, '$[5]')) = ?
      AND (SELECT count(*) FROM mileage_entries m
       JOIN json_each(?) selected ON m.id = json_extract(selected.value, '$[0]')
       WHERE m.customer_id = ? AND m.invoice_id IS NULL AND m.voided_at IS NULL AND m.billable = 1
         AND m.occurred_local = json_extract(selected.value, '$[1]')
         AND m.miles = json_extract(selected.value, '$[2]')
         AND m.rate_cents_per_mile = json_extract(selected.value, '$[3]')
         AND m.reason = json_extract(selected.value, '$[4]')) = ?
      THEN ? ELSE NULL END, 'draft', ?, ?, ?, ?, ?, ?, 1)
  `,
      )
      .bind(
        token,
        timeSnapshot,
        customerId,
        time.length,
        mileageSnapshot,
        customerId,
        mileage.length,
        customerId,
        period.start,
        period.end,
        totals.timeSubtotalCents,
        totals.mileageSubtotalCents,
        totals.totalCents,
        currency,
      ),
  ];

  for (const [i, l] of totals.lines.entries()) {
    stmts.push(
      db(env)
        .prepare(
          `INSERT INTO invoice_lines
      (invoice_id, kind, description, detail, service_date, charge_code, quantity, unit, rate_cents, amount_cents, sort_order)
      VALUES ((SELECT id FROM invoices WHERE number = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          token,
          l.kind,
          l.description,
          l.detail ?? null,
          l.serviceDate ?? null,
          l.chargeCode ?? null,
          l.quantity,
          l.unit,
          l.rateCents,
          l.amountCents,
          i,
        ),
    );
  }
  stmts.push(
    db(env)
      .prepare(
        `UPDATE time_entries SET invoice_id = (SELECT id FROM invoices WHERE number = ?)
    WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .bind(token, JSON.stringify(timeIds)),
  );
  stmts.push(
    db(env)
      .prepare(
        `UPDATE mileage_entries SET invoice_id = (SELECT id FROM invoices WHERE number = ?)
    WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .bind(token, JSON.stringify(mileageIds)),
  );
  stmts.push(
    db(env)
      .prepare("UPDATE invoices SET number = ? || '-' || printf('%04d', id) WHERE number = ?")
      .bind(invoicePrefix, token),
  );
  try {
    const results = await db(env).batch(stmts);
    return (await getInvoice(env, results[0].meta.last_row_id as number)) as Invoice;
  } catch (error) {
    // Keep SQL/internal details out of the operator-facing flash message.
    console.error('Could not save selected invoice', error);
    throw new Error(
      'Invoice could not be saved. Refresh pending billings and try again; selected entries may have changed.',
    );
  }
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
      `SELECT te.*, COALESCE(t.legacy_invoice_name, t.name) AS task_name,
              t.rate_cents_per_hour AS rate
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
    .prepare(
      "UPDATE invoices SET status = 'sent', sent_at = ?, sent_method = ? WHERE id = ? AND status IN ('draft', 'sent')",
    )
    .bind(nowIso, method, id)
    .run();
}

/** Compare the observed send record in SQL, so concurrent confirmations cannot overwrite it. */
export async function markInvoiceSentManually(
  env: Env,
  id: number,
  method: string,
  nowIso: string,
  expectedSentAt: string | null,
): Promise<boolean> {
  const result = await db(env)
    .prepare(
      "UPDATE invoices SET status = 'sent', sent_at = ?, sent_method = ? WHERE id = ? AND status IN ('draft', 'sent') AND sent_at IS ?",
    )
    .bind(nowIso, method, id, expectedSentAt)
    .run();
  return result.meta.changes === 1;
}

/**
 * Cancel an invoice without erasing its audit record. Source rows are either
 * returned to the unbilled pool or voided and retained as historical evidence.
 */
export async function cancelInvoice(
  env: Env,
  id: number,
  disposition: 'return' | 'delete' = 'return',
  nowIso = new Date().toISOString(),
): Promise<void> {
  const invoice = await getInvoice(env, id);
  if (!invoice) throw new Error('Invoice not found.');
  if (invoice.status !== 'draft' && invoice.status !== 'sent') {
    throw new Error(`A ${invoice.status} invoice cannot be canceled.`);
  }
  if (invoice.lines_frozen !== 1) {
    throw new Error('This invoice predates frozen line items and cannot be canceled safely.');
  }

  if (disposition !== 'return' && disposition !== 'delete') {
    throw new Error('Choose whether to return or delete the invoice hours.');
  }

  const timeDisposition =
    disposition === 'return'
      ? db(env)
          .prepare(
            "UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = ? AND EXISTS (SELECT 1 FROM invoices WHERE id = ? AND status IN ('draft', 'sent'))",
          )
          .bind(id, id)
      : db(env)
          .prepare(
            "UPDATE time_entries SET voided_at = ? WHERE invoice_id = ? AND EXISTS (SELECT 1 FROM invoices WHERE id = ? AND status IN ('draft', 'sent'))",
          )
          .bind(nowIso, id, id);
  const mileageDisposition =
    disposition === 'return'
      ? db(env)
          .prepare(
            "UPDATE mileage_entries SET invoice_id = NULL WHERE invoice_id = ? AND EXISTS (SELECT 1 FROM invoices WHERE id = ? AND status IN ('draft', 'sent'))",
          )
          .bind(id, id)
      : db(env)
          .prepare(
            "UPDATE mileage_entries SET voided_at = ? WHERE invoice_id = ? AND EXISTS (SELECT 1 FROM invoices WHERE id = ? AND status IN ('draft', 'sent'))",
          )
          .bind(nowIso, id, id);

  // D1 executes a batch as one ordered transaction. Apply the source
  // disposition only while the invoice is still cancelable, then claim the
  // status transition last. A stale competing request therefore changes no
  // source rows and observes zero changes on the final guarded update.
  const results = await db(env).batch([
    timeDisposition,
    mileageDisposition,
    db(env)
      .prepare("UPDATE invoices SET status = 'canceled' WHERE id = ? AND status IN ('draft', 'sent')")
      .bind(id),
  ]);
  if ((results[2]?.meta.changes ?? 0) !== 1) {
    throw new Error('Invoice status changed before cancellation completed.');
  }
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

// ---- Client management -----------------------------------------------------

export async function listAllCustomers(env: Env): Promise<Customer[]> {
  const { results } = await db(env)
    .prepare('SELECT * FROM customers ORDER BY archived, name')
    .all<Customer>();
  return results ?? [];
}

export async function updateCustomer(
  env: Env,
  id: number,
  c: {
    name: string;
    address: string;
    email: string;
    notes: string;
    workdriveFolderId: string | null;
    noticeDays: number | null;
    invoiceDeliveryMode: InvoiceDeliveryMode;
  },
): Promise<void> {
  await db(env)
    .prepare(
      `UPDATE customers SET name = ?, address = ?, email = ?, notes = ?, workdrive_folder_id = ?,
              notice_days = ?, invoice_delivery_mode = ?
        WHERE id = ?`,
    )
    .bind(
      c.name,
      c.address,
      c.email,
      c.notes,
      c.workdriveFolderId,
      c.noticeDays,
      c.invoiceDeliveryMode,
      id,
    )
    .run();
}

/**
 * Customers are ARCHIVED, never deleted.
 *
 * An invoice, a time entry and a mileage row all reference the customer they
 * were for. Deleting one would orphan the meaning of money that has already
 * moved, and "who was this for" is exactly the question asked years later.
 */
export async function setCustomerArchived(env: Env, id: number, archived: boolean): Promise<void> {
  await db(env)
    .prepare('UPDATE customers SET archived = ? WHERE id = ?')
    .bind(archived ? 1 : 0, id)
    .run();
}

export async function updateTask(
  env: Env,
  id: number,
  t: { name: string; description: string; rateCentsPerHour: number },
): Promise<void> {
  await db(env)
    .prepare('UPDATE tasks SET name = ?, description = ?, rate_cents_per_hour = ? WHERE id = ?')
    .bind(t.name, t.description, t.rateCentsPerHour, id)
    .run();
}

export async function setTaskActive(env: Env, id: number, active: boolean): Promise<void> {
  await db(env).prepare('UPDATE tasks SET active = ? WHERE id = ?').bind(active ? 1 : 0, id).run();
}

/** Every task for a customer, including inactive ones, for the management view. */
export async function listAllTasks(env: Env, customerId: number): Promise<Task[]> {
  const { results } = await db(env)
    .prepare('SELECT * FROM tasks WHERE customer_id = ? ORDER BY active DESC, name')
    .bind(customerId)
    .all<Task>();
  return results ?? [];
}

export async function updateRoute(
  env: Env,
  id: number,
  r: {
    label: string;
    fromAddress: string;
    toAddress: string;
    oneWayMiles: number;
  },
): Promise<void> {
  await db(env)
    .prepare(
      'UPDATE routes SET label = ?, from_address = ?, to_address = ?, one_way_miles = ? WHERE id = ?',
    )
    .bind(r.label, r.fromAddress, r.toAddress, r.oneWayMiles, id)
    .run();
}

export async function setRouteActive(env: Env, id: number, active: boolean): Promise<void> {
  await db(env).prepare('UPDATE routes SET active = ? WHERE id = ?').bind(active ? 1 : 0, id).run();
}

export async function listAllRoutes(env: Env): Promise<Route[]> {
  const { results } = await db(env)
    .prepare('SELECT * FROM routes ORDER BY active DESC, label')
    .all<Route>();
  return results ?? [];
}

// ---- Effective-dated terms -------------------------------------------------

export async function listTermVersions(env: Env): Promise<TermVersion[]> {
  const { results } = await db(env)
    .prepare('SELECT * FROM term_versions ORDER BY effective_from DESC, id DESC')
    .all<TermVersion>();
  return results ?? [];
}

export async function createTermVersion(
  env: Env,
  v: {
    effectiveFrom: string;
    basis: string;
    agreedWith: string;
    billingIncrementMinutes: number;
    minimumCallOut: string;
    mileageRateCents: number;
    mileageBillable: boolean;
    recordedBy: string;
    note: string;
  },
): Promise<number> {
  const r = await db(env)
    .prepare(
      `INSERT INTO term_versions
         (effective_from, basis, agreed_with, billing_increment_minutes, minimum_callout,
          mileage_rate_cents, mileage_billable, recorded_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      v.effectiveFrom,
      v.basis,
      v.agreedWith,
      v.billingIncrementMinutes,
      v.minimumCallOut,
      v.mileageRateCents,
      v.mileageBillable ? 1 : 0,
      v.recordedBy,
      v.note,
    )
    .run();
  return r.meta.last_row_id as number;
}

/** Every task's rate history, newest first, keyed by task. */
export async function taskRateHistory(env: Env): Promise<Map<number, TaskRateVersion[]>> {
  const { results } = await db(env)
    .prepare('SELECT * FROM task_rate_versions ORDER BY task_id, effective_from DESC, id DESC')
    .all<TaskRateVersion>();
  const byTask = new Map<number, TaskRateVersion[]>();
  for (const r of results ?? []) {
    const list = byTask.get(r.task_id) ?? [];
    list.push(r);
    byTask.set(r.task_id, list);
  }
  return byTask;
}

export async function createTaskRateVersion(
  env: Env,
  v: {
    taskId: number;
    effectiveFrom: string;
    rateCentsPerHour: number;
    recordedBy: string;
    note: string;
  },
): Promise<number> {
  const r = await db(env)
    .prepare(
      `INSERT INTO task_rate_versions (task_id, effective_from, rate_cents_per_hour, recorded_by, note)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(v.taskId, v.effectiveFrom, v.rateCentsPerHour, v.recordedBy, v.note)
    .run();
  return r.meta.last_row_id as number;
}

/**
 * When the most recent ALREADY-INVOICED work was performed.
 *
 * Used to refuse a term version whose effective date would restate a period
 * that has already been billed. The invoice itself is safe -- its lines are
 * frozen -- but a stored invoice disagreeing with what the terms now say is
 * exactly what cannot be explained two years later in a dispute.
 */
export async function latestInvoicedWorkAt(env: Env): Promise<string | null> {
  const row = await db(env)
    .prepare(
      `SELECT MAX(t) AS latest FROM (
         SELECT MAX(started_at) AS t FROM time_entries WHERE invoice_id IS NOT NULL
         UNION ALL
         SELECT MAX(occurred_local) AS t FROM mileage_entries WHERE invoice_id IS NOT NULL
       )`,
    )
    .first<{ latest: string | null }>();
  return row?.latest ?? null;
}

/**
 * What happened to the email that carried an invoice.
 *
 * Joins invoice -> its outbound message by the subject we sent under, which is
 * the same key openOutboundThread threads on. Returns null when the invoice has
 * not been emailed, which is a different thing from "sent but no report yet" --
 * the UI needs both states and conflating them would show a delivery status for
 * an invoice that was handed over on paper.
 */
export async function invoiceDelivery(
  env: Env,
  invoiceId: number,
): Promise<{
  status: string;
  at: string | null;
  detail: string;
  recipient: string;
  sentAt: string;
} | null> {
  const row = await db(env)
    .prepare(
      `SELECT m.delivery_status AS status, m.delivery_at AS at, m.delivery_detail AS detail,
              m.to_addrs AS recipients, m.received_at AS sentAt
         FROM messages m
         JOIN threads t ON t.id = m.thread_id
         JOIN invoices i ON i.customer_id = t.customer_id
        WHERE i.id = ? AND m.direction = 'outbound' AND m.subject LIKE ?
        ORDER BY m.id DESC LIMIT 1`,
    )
    .bind(invoiceId, `%${(await getInvoice(env, invoiceId))?.number ?? ''}%`)
    .first<{
      status: string;
      at: string | null;
      detail: string;
      recipients: string;
      sentAt: string;
    }>();

  if (!row) return null;

  let recipient = '';
  try {
    const parsed = JSON.parse(row.recipients) as string[];
    recipient = parsed[0] ?? '';
  } catch {
    recipient = row.recipients;
  }

  return { status: row.status, at: row.at, detail: row.detail, recipient, sentAt: row.sentAt };
}
