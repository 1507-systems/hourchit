-- Email one-time-code login.
--
-- Replaces "everyone who knows the shared token is the operator" with "whoever
-- can read the operator's mailbox is the operator". That is a real improvement
-- for a billing application: a shared secret pasted into a phone once lives
-- there forever, whereas a code is useless ninety seconds after it is used.
--
-- The static ACCESS_TOKEN survives as documented break-glass, because an auth
-- system whose only path runs through a third party's mail is an auth system
-- that locks you out of your own invoices on the day that third party breaks.

-- Codes emailed to an operator. Deliberately NOT a place a live code is ever
-- readable: only the hash is stored, so a dump of this table (a leaked D1
-- export, a support query, a backup) does not let the reader log in.
CREATE TABLE login_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Lower-cased at write time so 'Bryce@x' and 'bryce@x' cannot be used to farm
  -- separate rate-limit budgets for the same mailbox.
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  -- NULL until redeemed. Single use is enforced by an UPDATE that requires this
  -- to still be NULL, so two racing submissions cannot both win.
  consumed_at  TEXT,
  -- Wrong guesses against THIS code. Six digits is a million combinations,
  -- which sounds ample and is not: without a cap an attacker just submits
  -- until it lands, and the honest user never notices because their code
  -- still works.
  attempts     INTEGER NOT NULL DEFAULT 0
);

-- The hot path is "newest live code for this address", and the rate limiter
-- counts recent rows per address.
CREATE INDEX idx_login_codes_email ON login_codes(email, created_at DESC);

-- Sessions minted after a code is redeemed. The cookie carries a random token;
-- only its hash is stored, so this table is likewise useless to a reader.
CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  -- Set by logout. Kept rather than deleted so "was this session still valid
  -- when that invoice was sent" stays answerable after the fact.
  revoked_at  TEXT
);

CREATE INDEX idx_sessions_lookup ON sessions(token_hash);
