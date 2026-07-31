-- Effective-dated billing terms.
--
-- Until now the terms that decide what a client owes -- the hourly rates, the
-- billing increment, the minimum call-out, the mileage rate -- lived only in
-- the tenant profile, which is deploy-time config with no history. Changing a
-- rate meant editing JSON and redeploying, and the old value was gone.
--
-- WHY VERSIONS AND NOT JUST AN EDITABLE SETTINGS ROW. Bryce, 2026-07-31:
-- "old rate (this is why we version and timestamp)". Work performed before a
-- rate change bills at the OLD rate, because it was performed under the terms
-- in force at the time and billing it at a rate the client never agreed to is
-- what gets an invoice disputed. That requires knowing what the terms WERE on
-- a given day, which a mutable row cannot answer.
--
-- Persisting invoice lines (migration 0006) already protects invoices ALREADY
-- ISSUED. This protects the gap that remained: work performed but not yet
-- invoiced when the terms change.
CREATE TABLE term_versions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,

  -- The instant these terms START applying, compared against the moment work
  -- was PERFORMED -- never against the moment an invoice was created. Resolving
  -- against invoice date is the obvious implementation and it is exactly
  -- backwards: it reprices past work every time a rate moves.
  effective_from       TEXT NOT NULL,

  -- The full commercial terms, versioned together rather than field by field.
  -- A rate change and an increment change made on the same day are one
  -- decision, and splitting them would let an invoice resolve half of one
  -- version and half of another.
  billing_increment_minutes  INTEGER NOT NULL,

  -- Number of minutes, OR a JSON object {"weekday":n,"weekend":n}. Stored as
  -- TEXT so the day-split form survives the round trip -- flattening it back to
  -- a single number would silently destroy a term like Matt's A/V SOW 3.3,
  -- "four hours for an event beginning Saturday or Sunday, none Monday to
  -- Friday".
  minimum_callout      TEXT NOT NULL,

  mileage_rate_cents   INTEGER NOT NULL,
  mileage_billable     INTEGER NOT NULL,

  -- Who recorded it and when. Distinct from effective_from: terms are commonly
  -- agreed in advance, so "decided on the 3rd, effective the 1st of next
  -- month" is the normal case rather than an anomaly.
  recorded_at          TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by          TEXT NOT NULL DEFAULT '',
  note                 TEXT NOT NULL DEFAULT ''
);

-- Resolution always asks "the newest version whose effective_from is at or
-- before this instant", so the index is on that column descending.
CREATE INDEX idx_term_versions_effective ON term_versions(effective_from DESC);

-- Per-task rates are versioned the same way and for the same reason: a task's
-- hourly rate is a commercial term, and raising it must not reprice work
-- already performed at the old one.
CREATE TABLE task_rate_versions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id              INTEGER NOT NULL REFERENCES tasks(id),
  effective_from       TEXT NOT NULL,
  rate_cents_per_hour  INTEGER NOT NULL,
  recorded_at          TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by          TEXT NOT NULL DEFAULT '',
  note                 TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_task_rate_versions ON task_rate_versions(task_id, effective_from DESC);
