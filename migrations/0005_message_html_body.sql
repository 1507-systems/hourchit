-- Keep the HTML body, and record whether the plain text was authored or derived.
--
-- FOUND BY THE FIRST LIVE INBOUND TEST, 2026-07-31. A real reply from an iPhone
-- stored body_text of length ZERO. The message carried a signature, so it
-- plainly had content; the parser only ever read `email.text`, and iOS Mail
-- composes HTML. With no MAIL_RAW binding on that tenant there was no raw copy
-- either, so the words were not merely unparsed, they were gone.
--
-- Why this is worth a migration rather than a shrug: the point of inbound is a
-- classifier that turns mail into draft bookings and CANCELLATIONS. A cancelled
-- weekend booking is a four hour minimum under SOW 3.3 and payable under MSA
-- 1.6(b), so a cancellation whose text silently vanished is a money-losing
-- failure, not a cosmetic one.

ALTER TABLE messages ADD COLUMN body_html TEXT NOT NULL DEFAULT '';

-- 1 when body_text was reconstructed from HTML rather than sent as text/plain.
--
-- Kept because these rows are evidence. "The client cancelled in writing" is a
-- claim about what someone actually wrote, and a human reading this row later
-- deserves to know whether they are looking at the sender's words or at our
-- rendering of their markup.
ALTER TABLE messages ADD COLUMN body_is_derived INTEGER NOT NULL DEFAULT 0;
