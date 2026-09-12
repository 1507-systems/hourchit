-- Preserve the concrete event and local work date on every new time line.
-- Nullable columns keep invoices issued before this feature byte-for-byte
-- renderable from their already-frozen description and totals.
ALTER TABLE invoice_lines ADD COLUMN detail TEXT;
ALTER TABLE invoice_lines ADD COLUMN service_date TEXT;

-- Distinguish an old invoice that must still render from attached source rows
-- from a modern invoice whose frozen line set is intentionally empty.
ALTER TABLE invoices ADD COLUMN lines_frozen INTEGER NOT NULL DEFAULT 0;
UPDATE invoices SET lines_frozen = 1
 WHERE EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = invoices.id);

-- The first tenant's original service name was a setup-time guess. Rename the
-- live task without rewriting frozen invoice lines from documents already
-- issued under the old wording. Invoices predating invoice_lines still use a
-- fallback join, so preserve the label they originally showed before renaming.
ALTER TABLE tasks ADD COLUMN legacy_invoice_name TEXT;
UPDATE tasks SET legacy_invoice_name = name
 WHERE EXISTS (SELECT 1 FROM time_entries WHERE task_id = tasks.id AND invoice_id IS NOT NULL);
UPDATE tasks SET name = 'Event Tech Management' WHERE name = 'Event Management';
