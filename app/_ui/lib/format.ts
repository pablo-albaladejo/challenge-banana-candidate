/** Formats integer cents as euros, the way every amount in the UI is shown. */
export const money = (cents: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
/** Formats a timestamp as day, short month and 24-hour time. */
export const date = (value: string) =>
  new Intl.DateTimeFormat('en-IE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
/** Formats a timestamp as a 24-hour time: the "as of" footnote of a pre-flight check. */
export const time = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(value),
  );
