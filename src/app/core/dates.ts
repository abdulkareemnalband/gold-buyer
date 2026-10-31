/**
 * Days in the app are plain `YYYY-MM-DD` strings in local time. A date input reads and
 * writes that form, and a string compare puts two days in order.
 */

const DAY = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** The local day of a moment, as `YYYY-MM-DD`. */
export function isoDay(time: number = Date.now()): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A day for a label, such as 31 Oct 2026. An empty string stays empty. */
export function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);

  if (!year || !month || !day) {
    return iso;
  }
  return DAY.format(new Date(year, month - 1, day));
}
