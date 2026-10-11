import { referenceDate } from '../../shared/domain/reference-date';

/** Cents as the brief writes every amount: `EUR 1,750.00`. */
export const eur = (cents: number) =>
  `EUR ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const madridDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const madridLong = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

/** The calendar date of a timestamp in Europe/Madrid, as `YYYY-MM-DD`. */
export const madridDate = (iso: string) => madridDay.format(new Date(iso));

/** The calendar date of a timestamp in Europe/Madrid, in words: `23 September 2026`. */
export const longDate = (iso: string) => madridLong.format(new Date(iso));

/** The date a case is judged on: its own Madrid date, never later than the reference date. */
export const caseDateOf = (openedAt: string) => {
  const day = madridDate(openedAt);
  return day < referenceDate ? day : referenceDate;
};
