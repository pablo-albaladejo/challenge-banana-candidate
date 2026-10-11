// The customer-facing sentences of the pre-flight checks. Code writes them; the model relays them
// verbatim. The only interpolated text is bank data (an account label, a contact name), never
// customer input.
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

export const preflightMessages = {
  balanceShort: (label: string, balanceCents: number, shortCents: number) =>
    `Your ${label} has ${eur(balanceCents)}; this transfer would leave it ${eur(shortCents)} short.`,
  balanceAfter: (label: string, afterCents: number) =>
    `After this transfer, your ${label} will have ${eur(afterCents)}.`,
  firstTimeRecipient: (name: string | null) =>
    `You have not sent money to ${name ?? 'this recipient'} through Banana Bank's app before. Check the account details.`,
  unusualAmount: (largestCents: number) =>
    `This is larger than any payment from your accounts in your recent activity (largest ${eur(largestCents)}).`,
  historyUnavailable: () =>
    'Your recent activity could not be loaded, so this amount was not compared with it.',
  pendingTwin: (createdAt: string) =>
    `An identical transfer from ${timeOf(createdAt)} is still being verified with the bank. You chose to send this one anyway; if both complete, you will pay twice.`,
};
