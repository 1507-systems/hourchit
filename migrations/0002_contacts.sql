-- Contacts: the people at a customer who book, cancel, and get invoiced.
--
-- These cannot live in config. People leave and get promoted, and when a client
-- hands scheduling to somebody else the operator has to fix it himself in the
-- evening, without a deploy.

CREATE TABLE contacts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    INTEGER NOT NULL REFERENCES customers(id),
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  -- Contacts are DEACTIVATED, never deleted. An inbound message from months ago
  -- must still resolve to the person who sent it, long after they have left --
  -- that resolution is what proves a booking was validly cancelled, and under a
  -- cancellation term it decides whether the job still gets paid.
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deactivated_at TEXT
);
CREATE INDEX idx_contacts_customer ON contacts(customer_id);

-- One address per customer, so an inbound sender resolves to exactly one
-- contact rather than ambiguously to several.
CREATE UNIQUE INDEX idx_contacts_customer_email ON contacts(customer_id, email);

-- Roles are a join table, not a column on contacts. One person holds several:
-- the same individual is routinely both the booking contact and the signatory
-- on the agreement. A single role column forces a duplicate contact row per
-- role, and those rows then drift apart the first time an address changes.
CREATE TABLE contact_roles (
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- Denormalised from contacts so the one-primary-per-role rule below can be a
  -- database constraint rather than a convention nobody enforces. Same reasoning
  -- as the partial unique index that keeps a single timer running.
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  role        TEXT NOT NULL,   -- booking | ap | signatory
  is_primary  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (contact_id, role)
);
CREATE INDEX idx_contact_roles_customer_role ON contact_roles(customer_id, role);

-- At most one primary per customer per role. The primary is who lands on To;
-- everyone else in the role is CC'd. Two primaries would make that ambiguous.
CREATE UNIQUE INDEX idx_contact_roles_one_primary
  ON contact_roles(customer_id, role) WHERE is_primary = 1;
