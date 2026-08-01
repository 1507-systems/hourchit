-- What happened to a message AFTER we handed it to Cloudflare.
--
-- WHY THIS EXISTS AT ALL. Until now the app knew only that send() did not
-- throw, which means Cloudflare accepted the message -- not that anyone
-- received it. An invoice that bounced looks exactly like an invoice that was
-- delivered and ignored, and those call for opposite actions: one needs a
-- corrected address, the other needs a chase. Guessing wrong wastes weeks.
--
-- WHY NOT A TRACKING PIXEL. It would answer a different question badly. Apple
-- Mail Privacy Protection PREFETCHES remote images for every message whether or
-- not a human opened it, so a pixel reports "read" for mail nobody looked at --
-- and corporate gateways strip images entirely, so it reports nothing for mail
-- that was read. It is also a beacon in a client's inbox, which is a poor look
-- on an invoice. Cloudflare's own delivery events are the honest source: they
-- report what the RECEIVING MAIL SERVER did, which is a fact rather than an
-- inference.
--
-- READ THIS TABLE'S LIMIT PLAINLY: 'delivered' means the recipient's mail
-- server ACCEPTED the message. It does not mean a person read it, and the UI
-- must never imply otherwise.
CREATE TABLE mail_delivery_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,

  -- The Message-ID Cloudflare assigned when we sent, recorded on the outbound
  -- row at send time. This is the ONLY join back to what was sent.
  message_id        TEXT NOT NULL,

  -- delivered | deferred | bounced | failed | rejected | complained
  event_type        TEXT NOT NULL,
  recipient         TEXT NOT NULL DEFAULT '',

  -- Cloudflare's `terminal` flag: whether this is the final word for this
  -- recipient. A deferral is not terminal (retries continue); a hard bounce is.
  -- Without it, a deferred message reads as a failure when it is still in
  -- flight, and an operator re-sends an invoice that was about to arrive.
  terminal          INTEGER NOT NULL DEFAULT 0,

  -- The receiving server's own words. Kept verbatim because a bounce reason is
  -- the difference between "the address is wrong" and "their mailbox is full",
  -- and any paraphrase we invent loses exactly the part that matters.
  smtp_code         TEXT NOT NULL DEFAULT '',
  smtp_response     TEXT NOT NULL DEFAULT '',
  provider          TEXT NOT NULL DEFAULT '',

  -- When Cloudflare says it happened, and when we stored it. They differ, and
  -- the gap matters when reconstructing a dispute: queue delivery is not
  -- instant and events can arrive out of order.
  occurred_at       TEXT NOT NULL DEFAULT '',
  received_at       TEXT NOT NULL DEFAULT (datetime('now')),

  -- The whole event as received. Our parser understanding a payload is a best
  -- effort; keeping what actually arrived is not. Same reasoning as MAIL_RAW
  -- for inbound mail, and for the same reason: the first live inbound test
  -- stored an empty body and there was no original to recover it from.
  raw               TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_delivery_events_message ON mail_delivery_events(message_id, id DESC);

-- The latest word, denormalized onto the message so a list of invoices does not
-- need a subquery per row. The event table remains the record; this is a cache
-- of its newest terminal-or-latest entry.
ALTER TABLE messages ADD COLUMN delivery_status TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN delivery_at TEXT;
ALTER TABLE messages ADD COLUMN delivery_detail TEXT NOT NULL DEFAULT '';
