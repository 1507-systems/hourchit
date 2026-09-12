-- Every client gets an explicit invoice-delivery policy: hosted send, disabled,
-- or hand off to the operator's own mail app. The tenant-level default only
-- seeds newly created clients -- changing it must never rewrite an existing
-- client's stored mode, so a later tenant-wide change cannot silently alter
-- behavior nobody reviewed for that specific client.
--
-- Existing clients migrate to 'hosted', preserving the behavior already live.
-- A tenant that wants different behavior for a given client changes it
-- deliberately, in its own follow-up statement (in the private tenants repo,
-- never here), so this shared migration cannot silently alter behavior for
-- any real client.
INSERT OR IGNORE INTO settings (key, value) VALUES ('invoice_delivery_default', 'hosted');

ALTER TABLE customers
ADD COLUMN invoice_delivery_mode TEXT NOT NULL DEFAULT 'hosted'
CHECK (invoice_delivery_mode IN ('hosted', 'disabled', 'mail_app'));
