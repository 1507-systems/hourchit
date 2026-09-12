/**
 * Durations entered and displayed as h:mm, stored as minutes.
 *
 * WHY NOT A BARE MINUTE COUNT. A minimum call-out is agreed in hours -- "four
 * hours for a weekend event", "one hour minimum" -- and typing that as 240 or
 * 60 asks the operator to do arithmetic on a contractual term. The failure mode
 * is not a typo you notice: entering "4" for four hours stores a FOUR MINUTE
 * minimum, the form accepts it happily, and it surfaces months later as
 * invoices that are quietly short. So bare integers are REFUSED rather than
 * interpreted -- "4" could mean either and guessing is what causes the damage.
 *
 * WHY NOT <input type="time">. It renders 4:00 as "04:00 AM" in a US locale.
 * For a time of day that is right; for a duration it is nonsense, and a field
 * that reads "AM" invites someone to wonder whether the minimum applies in the
 * morning. A text input with a pattern keeps the native keyboard on mobile and
 * never grows a meridiem.
 *
 * Minutes remain the storage and arithmetic unit throughout; this is purely the
 * boundary where a person reads and writes them.
 */

/** h:mm or hh:mm, minutes 00-59. Hours are unbounded upward within reason. */
const HMM = /^(\d{1,3}):([0-5]\d)$/;

/** The `pattern` attribute for an input, kept beside the parser it must agree with. */
export const DURATION_INPUT_PATTERN = '\\d{1,3}:[0-5]\\d';

/**
 * Parse "h:mm" into whole minutes.
 *
 * Throws rather than returning a fallback: a duration that cannot be read is a
 * term nobody agreed to, and defaulting it to zero would silently remove a
 * minimum a client is contractually owed.
 */
export function parseDuration(text: string): number {
  const trimmed = text.trim();
  const m = HMM.exec(trimmed);
  if (!m) {
    // Name the ambiguity explicitly. Someone typing "4" has a specific meaning
    // in mind and the message should tell them which one we refused to assume.
    if (/^\d+$/.test(trimmed)) {
      throw new Error(
        `Enter ${JSON.stringify(trimmed)} as h:mm. A bare number is ambiguous — ` +
          `${trimmed} hours is ${trimmed}:00, ${trimmed} minutes is 0:${trimmed.padStart(2, '0')}.`,
      );
    }
    throw new Error(`Unreadable duration ${JSON.stringify(text)}. Expected h:mm, such as 4:00.`);
  }
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes to "h:mm", the form the input expects back. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Minutes in prose, for read-only display.
 *
 * Zero reads as "none" rather than "0:00" because a zero minimum is not a
 * duration of nil length, it is the absence of a term -- and on a page listing
 * what a client owes, the difference is worth spelling out.
 */
export function describeDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total === 0) return 'none';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
