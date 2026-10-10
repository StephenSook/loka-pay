// Times on the judge pages are shown in Atlanta time (the event's time zone), with the
// zone named, and the exact UTC instant kept in the <time dateTime> attribute.

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

/** "Sat, Oct 10, 1:02:59 AM ET" for a time in milliseconds since the epoch. */
export function formatEt(ms: number): string {
  return `${ET.format(new Date(ms))} ET`;
}

const ET_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

/** "4:23 PM" (Atlanta time, no date, no seconds) for a time in milliseconds since the epoch. */
export function formatEtClock(ms: number): string {
  return ET_CLOCK.format(new Date(ms));
}

/** The ISO 8601 UTC instant for a <time dateTime> attribute. */
export function isoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

/** How old something is, in words for a page: "45 s", "3 min", "2 h" (rounded down). */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 120) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 120) return `${min} min`;
  return `${Math.floor(min / 60)} h`;
}

/** The latest instant a JavaScript Date can hold, in seconds (8.64e15 ms). */
const MAX_DATE_SECONDS = 8_640_000_000_000;

/**
 * A Unix time in whole seconds that a page can show: a safe, non-negative integer a Date can
 * hold. A node's block time is checked with this where it is decoded, so an impossible value
 * becomes "unavailable" there instead of throwing while a page renders.
 */
export function isUnixSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_SECONDS;
}
