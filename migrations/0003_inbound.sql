-- Inbound email: threads, messages, attachments.
--
-- This is the first UNAUTHENTICATED write path in the application. Everything
-- else sits behind the shared token and fails closed. Inbound mail is, by
-- construction, input from the open internet that nobody authenticated, so it
-- may only ever create rows here -- never mutate billable state.

CREATE TABLE threads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- NULL when the sender matches no known contact. Such mail is still stored,
  -- because a message from an address nobody has registered yet is exactly the
  -- kind of thing the operator needs to see -- but it is attributed to nobody.
  customer_id     INTEGER REFERENCES customers(id),
  subject         TEXT NOT NULL DEFAULT '',
  -- Subject with Re:/Fwd: prefixes stripped, used to group a conversation whose
  -- participants broke References/In-Reply-To. Many mail clients do.
  subject_key     TEXT NOT NULL DEFAULT '',
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_threads_customer ON threads(customer_id, last_message_at);
CREATE INDEX idx_threads_subject_key ON threads(customer_id, subject_key);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id     INTEGER NOT NULL REFERENCES threads(id),
  direction     TEXT NOT NULL,              -- inbound | outbound
  -- RFC 5322 Message-ID. UNIQUE so a redelivered message is not stored twice:
  -- Cloudflare may invoke the handler more than once for the same mail, and an
  -- at-least-once delivery guarantee has to be made idempotent somewhere.
  message_id    TEXT,
  in_reply_to   TEXT,
  references_raw TEXT NOT NULL DEFAULT '',
  from_addr     TEXT NOT NULL DEFAULT '',
  to_addrs      TEXT NOT NULL DEFAULT '[]', -- json
  cc_addrs      TEXT NOT NULL DEFAULT '[]', -- json
  bcc_addrs     TEXT NOT NULL DEFAULT '[]', -- json
  subject       TEXT NOT NULL DEFAULT '',
  body_text     TEXT NOT NULL DEFAULT '',
  -- Which contact this came from, when the address matched one. Kept even after
  -- that contact is deactivated -- that is the whole reason contacts are never
  -- deleted.
  contact_id    INTEGER REFERENCES contacts(id),
  raw_r2_key    TEXT,
  received_at   TEXT NOT NULL DEFAULT (datetime('now')),
  transport     TEXT NOT NULL DEFAULT '',
  -- Outbound only. Recorded BEFORE a send is attempted so a failure is a row you
  -- can see and retry rather than an absence nobody notices.
  send_status   TEXT,                       -- queued | sent | failed
  send_error    TEXT,
  idempotency_key TEXT
);
CREATE UNIQUE INDEX idx_messages_message_id ON messages(message_id)
  WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX idx_messages_idempotency ON messages(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_messages_thread ON messages(thread_id, received_at);

CREATE TABLE attachments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id          INTEGER NOT NULL REFERENCES messages(id),
  filename            TEXT NOT NULL DEFAULT '',
  mime_type           TEXT NOT NULL DEFAULT 'application/octet-stream',
  bytes               INTEGER NOT NULL DEFAULT 0,
  direction           TEXT NOT NULL,
  r2_key              TEXT,
  -- Filing to the client's document store is a SEPARATE, RETRYABLE step.
  -- filed_at NULL means "received but not yet filed". A document-store outage
  -- must never cause us to reject the email that carried the document.
  workdrive_file_id   TEXT,
  workdrive_folder_id TEXT,
  filed_at            TEXT,
  file_error          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_message ON attachments(message_id);
CREATE INDEX idx_attachments_unfiled ON attachments(filed_at) WHERE filed_at IS NULL;
