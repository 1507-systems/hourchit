-- A time entry owns the operator-entered GL destination. Freeze it again on
-- the invoice line so a later correction cannot restate an issued invoice.
ALTER TABLE time_entries ADD COLUMN charge_code TEXT;
ALTER TABLE invoice_lines ADD COLUMN charge_code TEXT;

-- "Delete hours" is an accounting disposition, not physical deletion. These
-- timestamps preserve the evidence while excluding the rows from future work.
ALTER TABLE time_entries ADD COLUMN voided_at TEXT;
ALTER TABLE mileage_entries ADD COLUMN voided_at TEXT;
