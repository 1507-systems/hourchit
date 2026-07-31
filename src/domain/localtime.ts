/**
 * Local calendar facts about a UTC instant.
 *
 * WHY THIS EXISTS. Time entries are stored as ISO-8601 UTC, but every billing
 * rule that cares about "which day" means the LOCAL day where the work happened.
 * A Friday evening job in Connecticut starts at 20:00 local, which is 00:00
 * SATURDAY in UTC. Deciding a weekend minimum call-out off the UTC weekday would
 * therefore bill a four hour weekend minimum for a Friday event -- silently, and
 * only on evening jobs, which are most of them for an A/V business.
 *
 * The tenant's timezone is configuration rather than a guess. There is no
 * sensible default: UTC would mis-bill every US tenant, and the server's own
 * zone is meaningless in a Worker that runs wherever the request landed.
 */

/**
 * Local day of week for a UTC instant: 0 = Sunday .. 6 = Saturday, matching
 * ProfileSettings.weekendDays and JavaScript's getDay().
 */
export function localWeekday(iso: string, timeZone: string): number {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) throw new Error(`localWeekday: invalid instant ${JSON.stringify(iso)}`);

  // `weekday: 'short'` rather than arithmetic on a shifted timestamp: the
  // Intl formatter knows the zone's actual offset on that date, including the
  // DST transition, which a fixed offset would get wrong twice a year.
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(
    new Date(parsed),
  );
  const index = WEEKDAYS.indexOf(name);
  if (index === -1) throw new Error(`localWeekday: unexpected weekday ${JSON.stringify(name)}`);
  return index;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Whether a UTC instant falls on a configured weekend day, locally.
 */
export function isLocalWeekend(iso: string, timeZone: string, weekendDays: number[]): boolean {
  return weekendDays.includes(localWeekday(iso, timeZone));
}

/**
 * Validate a timezone once, at config load, rather than discovering it is
 * wrong when an invoice is being built.
 */
export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw new Error(
      `Invalid IANA timezone ${JSON.stringify(timeZone)}. Use a name like "America/New_York".`,
    );
  }
}
