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

/** The ISO 8601 UTC instant for a <time dateTime> attribute. */
export function isoUtc(ms: number): string {
  return new Date(ms).toISOString();
}
