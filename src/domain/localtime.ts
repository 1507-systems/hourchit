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
 * How far ahead of UTC a zone is at a given instant, in milliseconds.
 *
 * Derived from Intl rather than a table, so it is right across DST transitions
 * and for zones whose rules have changed. Negative west of Greenwich.
 */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));

  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`zoneOffsetMs: no ${type} in formatted parts`);
    return Number(found.value);
  };

  // hour12:false yields 24 for midnight in some implementations. Normalizing to
  // 0 is safe because the date parts already carry the correct day.
  const hour = get('hour') % 24;
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return wallAsUtc - instant;
}

/**
 * A local wall-clock time in a zone -> the UTC instant it names.
 *
 * WHY THIS MATTERS ENOUGH TO EXIST. An operator recording terms "effective 1
 * September" means midnight where the business operates, not midnight UTC.
 * Storing the typed string as though it were UTC puts the boundary four or five
 * hours early, so work performed in the small hours of the 1st resolves to the
 * OLD terms in Denver and the NEW terms in London -- from the same data.
 *
 * Everything comparable is stored as an ISO UTC instant, so a term boundary has
 * to be one too. Accepts "YYYY-MM-DDTHH:MM" (what datetime-local produces),
 * optionally with seconds.
 *
 * The offset is resolved twice on purpose. The first pass reads the offset at
 * the wrong instant -- it can only guess -- and the second reads it at the
 * corrected one. They differ only within an hour of a DST transition, which is
 * exactly where a single pass silently lands an hour out.
 */
export function zonedWallTimeToUtc(wall: string, timeZone: string): string {
  const normalized = wall.trim().replace(' ', 'T');
  const withSeconds = normalized.length === 16 ? `${normalized}:00` : normalized;
  const naive = Date.parse(`${withSeconds}Z`);
  if (Number.isNaN(naive)) {
    throw new Error(
      `zonedWallTimeToUtc: unreadable local time ${JSON.stringify(wall)}. Expected YYYY-MM-DDTHH:MM.`,
    );
  }
  const firstPass = naive - zoneOffsetMs(naive, timeZone);
  const instant = naive - zoneOffsetMs(firstPass, timeZone);
  return new Date(instant).toISOString();
}

/**
 * A UTC instant -> "YYYY-MM-DDTHH:MM" local wall time, the shape a
 * datetime-local input reads back.
 */
export function utcToZonedWallTime(iso: string, timeZone: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    throw new Error(`utcToZonedWallTime: invalid instant ${JSON.stringify(iso)}`);
  }
  const shifted = new Date(parsed + zoneOffsetMs(parsed, timeZone));
  return shifted.toISOString().slice(0, 16);
}

/** The local calendar date, "YYYY-MM-DD", of a UTC instant. */
export function localDateString(iso: string, timeZone: string): string {
  return utcToZonedWallTime(iso, timeZone).slice(0, 10);
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
