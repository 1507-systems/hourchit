-- Client management: make customers, tasks and routes editable at runtime.
--
-- Until now these came from the `seed` block of the tenant profile, applied
-- once against a fresh database. That made adding a second client a JSON edit
-- and a redeploy, which directly contradicts the stated design target of
-- "scaling to a few tens of clients with no rewrite". Seeding stays as the way
-- a NEW tenant starts life with its first client already present; it is no
-- longer the only way data arrives.

-- Where this client's documents get filed in Zoho WorkDrive.
--
-- Nullable because a client may not have a folder yet, and filing is a separate
-- retryable step -- attachments.filed_at already encodes "received but not
-- filed". The integration is deliberately granted READ and CREATE but NOT
-- DELETE: something that files executed agreements must not be able to remove
-- them.
ALTER TABLE customers ADD COLUMN workdrive_folder_id TEXT;

-- Free-text notes about the client. Kept on the customer rather than in a
-- separate table because a one-person business wants one place to look.
ALTER TABLE customers ADD COLUMN notes TEXT NOT NULL DEFAULT '';

-- Tasks are ARCHIVED, never deleted, for the same reason contacts are: a task
-- names the work on an invoice that has already been sent, and deleting it
-- would orphan that line's meaning long after the money moved.
-- (tasks.active already exists from 0001; this records the intent.)

-- Routes gain a soft-delete for the same reason: a mileage row references the
-- route that produced it, and the miles on a paid invoice must stay explicable.
ALTER TABLE routes ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
