/**
 * Rupee formatting.
 *
 * `CurrencyPipe` needs `registerLocaleData` before it can group digits the Indian way,
 * as 1,23,456. `Intl` carries every locale in the browser already, so the app uses it
 * directly and skips the extra locale bundle.
 */

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const RUPEES_EXACT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PLAIN = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 3,
});

/** A price for a heading or a total. Paise add noise at this size, so they go. */
export function formatInr(value: number): string {
  return RUPEES.format(safe(value));
}

/** A price where the paise matter, such as a single tax amount. */
export function formatInrExact(value: number): string {
  return RUPEES_EXACT.format(safe(value));
}

/** A plain number, such as a weight in grams. */
export function formatNumber(value: number): string {
  return PLAIN.format(safe(value));
}

function safe(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
