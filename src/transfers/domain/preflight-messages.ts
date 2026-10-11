// The customer-facing sentences of the pre-flight checks. Code writes them; the model relays them
// verbatim. The only interpolated text is bank data (an account label, a contact name), never
// customer input; a contact name is still written as one plain line of bounded length.
const amount = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const clockTime = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Madrid',
});
/** Integer cents as `EUR 3,807.50`. */
export const eur = (cents: number) => `EUR ${amount.format(cents / 100)}`;
/** An ISO timestamp as a 24-hour `HH:mm` in Europe/Madrid. */
export const timeOf = (iso: string) => clockTime.format(new Date(iso));

/** How many characters of a contact name a message carries. */
const NAME_MAX = 80;
/** A contact name as one plain line: control characters and newlines become spaces, capped. */
const plainName = (name: string | null) =>
  name
    ?.replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim() || null;

export const preflightMessages = {
  balanceShort: (label: string, balanceCents: number, shortCents: number) =>
    `Your ${label} has ${eur(balanceCents)}, ${eur(shortCents)} less than this transfer needs, so the bank is likely to decline it.`,
  balanceAfter: (label: string, afterCents: number) =>
    `After this transfer, your ${label} will have ${eur(afterCents)}.`,
  firstTimeRecipient: (name: string | null) =>
    `Banana Bank's app has no record of a completed transfer from you to ${plainName(name) ?? 'this recipient'}. Check the account details.`,
  unusualAmount: (largestCents: number) =>
    `This is larger than any payment from your accounts in your recent activity (largest ${eur(largestCents)}).`,
  historyUnavailable: () =>
    'Your recent activity could not be loaded, so this amount was not compared with it.',
  pendingTwin: (createdAt: string) =>
    `An identical transfer from ${timeOf(createdAt)} is still being verified with the bank. You chose to send this one anyway; if both complete, you will pay twice.`,
};
