-- Persist what an invoice actually billed.
--
-- Until now the line items were RECOMPUTED from the underlying time and mileage
-- rows every time an invoice was viewed. That makes an invoice a live query
-- rather than a record: change billingIncrementMinutes, or the minimum
-- call-out, or the tenant timezone, and every invoice ever issued silently
-- restates itself -- including ones already sent to a client and already paid.
--
-- An invoice is a claim about what was owed on the day it was issued. It has to
-- keep saying that afterwards, even when the configuration that produced it has
-- moved on, and especially when somebody later asks why the total differs from
-- what they paid.
CREATE TABLE invoice_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id),
  -- 'time' | 'mileage'. Kept as text rather than a join: these are frozen
  -- historical rows and must not depend on a lookup table that can change.
  kind          TEXT NOT NULL,
  description   TEXT NOT NULL,
  -- Hours or miles, stored as written on the invoice.
  quantity      REAL NOT NULL,
  unit          TEXT NOT NULL,
  rate_cents    INTEGER NOT NULL,
  amount_cents  INTEGER NOT NULL,
  -- Presentation order, so a re-render matches the original document exactly.
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id, sort_order);
