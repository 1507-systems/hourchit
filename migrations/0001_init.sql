-- hourchit schema (Cloudflare D1 / SQLite).
-- Everything is multi-row from day one: many customers, tasks, routes, invoices.
-- A single-client deployment just happens to have one of each.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id         INTEGER NOT NULL REFERENCES customers(id),
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  rate_cents_per_hour INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_customer ON tasks(customer_id);

CREATE TABLE time_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  started_at TEXT NOT NULL,              -- ISO-8601 UTC instant
  stopped_at TEXT,                       -- ISO-8601 UTC instant; NULL while running
  note       TEXT,
  invoice_id INTEGER REFERENCES invoices(id), -- NULL until billed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_time_task     ON time_entries(task_id);
CREATE INDEX idx_time_unbilled ON time_entries(invoice_id);
-- At most one running timer across the system. Index a constant expression
-- (true for every running row) rather than stopped_at itself: SQLite treats
-- NULLs as distinct, so a plain unique index on the NULL column would not bite.
CREATE UNIQUE INDEX idx_time_one_running ON time_entries((stopped_at IS NULL)) WHERE stopped_at IS NULL;

CREATE TABLE routes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT NOT NULL,
  from_address  TEXT NOT NULL DEFAULT '',
  to_address    TEXT NOT NULL DEFAULT '',
  one_way_miles REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE mileage_entries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id         INTEGER NOT NULL REFERENCES customers(id),
  task_id             INTEGER REFERENCES tasks(id),
  route_id            INTEGER REFERENCES routes(id),
  occurred_local      TEXT NOT NULL,     -- naive local "YYYY-MM-DDTHH:MM"
  miles               REAL NOT NULL,
  billable            INTEGER NOT NULL DEFAULT 0,
  reason              TEXT NOT NULL DEFAULT '', -- weekend | after-hours | daytime-weekday | manual
  rate_cents_per_mile INTEGER NOT NULL DEFAULT 0,
  note                TEXT,
  invoice_id          INTEGER REFERENCES invoices(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mileage_customer ON mileage_entries(customer_id);
CREATE INDEX idx_mileage_unbilled ON mileage_entries(invoice_id);

CREATE TABLE invoices (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id           INTEGER NOT NULL REFERENCES customers(id),
  number                TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'draft', -- draft | sent | paid
  period_start          TEXT,
  period_end            TEXT,
  time_subtotal_cents   INTEGER NOT NULL DEFAULT 0,
  mileage_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  total_cents           INTEGER NOT NULL DEFAULT 0,
  currency              TEXT NOT NULL DEFAULT 'USD',
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at               TEXT,
  sent_method           TEXT               -- print | email
);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
