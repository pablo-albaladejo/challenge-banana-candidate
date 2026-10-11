// The seeded world that both the real bank and the app know about. Every value here mirrors a seed
// (src/identity/infrastructure/people-roster.ts, src/server/seed.ts + fixtures/conversations.json, and the bank seed
// behind docs/contracts.md), so tests can name real people, accounts and cases without magic strings.
// Faker never invents these: the real bank validates ids, so a fake id is a different test.

export const customers = {
  lucia: 'lucia',
  bruno: 'bruno',
  carla: 'carla',
  diego: 'diego',
  elena: 'elena',
  hugo: 'hugo',
  ines: 'ines',
  omar: 'omar',
} as const;

export const operators = {
  marta: 'marta',
  pablo: 'pablo',
} as const;

/** Bank accounts. Every customer has a main account; lucia, carla, elena and ines also save. */
export const accounts = {
  lucia: 'acc-lucia',
  luciaSavings: 'acc-lucia-savings',
  bruno: 'acc-bruno',
  carla: 'acc-carla',
  carlaSavings: 'acc-carla-savings',
  diego: 'acc-diego',
  elena: 'acc-elena',
  elenaSavings: 'acc-elena-savings',
  hugo: 'acc-hugo',
  ines: 'acc-ines',
  inesSavings: 'acc-ines-savings',
  omar: 'acc-omar',
} as const;

export const conversations = {
  luciaWelcome: 'conv-lucia-welcome',
  brunoWelcome: 'conv-bruno-welcome',
  /** Holds the open case `cases.lucia` and the historic transfer intent. */
  luciaSupport: 'conv-lucia-support',
  /** Holds the closed case `cases.luciaGuide`: three messages and no agent activity. */
  luciaGuide: 'conv-lucia-activity-3',
  carlaSupport: 'conv-carla-support',
  elenaSupport: 'conv-elena-support',
  diegoSupport: 'conv-diego-support',
  inesSupport: 'conv-ines-support',
} as const;

export const cases = {
  lucia: 'case-lucia',
  luciaGuide: 'case-routine-lucia-guide',
  /** The five open cases the verified brief is pinned on (plan Part 2 §7.5). */
  carla: 'case-carla',
  elena: 'case-elena',
  diego: 'case-diego',
  ines: 'case-ines',
} as const;

/** The transfer lucia made before the exercise: booked at the bank, recorded as failed by the app. */
export const historicTransfer = {
  intentId: 'intent-historic-lucia',
  operationId: 'op-historic-lucia',
  reference: 'ref-historic-lucia',
  conversationId: conversations.luciaSupport,
  fromAccountId: accounts.lucia,
  toAccountId: accounts.bruno,
  amountCents: 8500,
  concept: 'Team dinner',
  /** The transfer input that produced the operation, as the intent stores it. */
  payload: {
    fromAccountId: accounts.lucia,
    toAccountId: accounts.bruno,
    amountCents: 8500,
    concept: 'Team dinner',
  },
} as const;

/** The transfer elena's account made to hugo's with no intent in the app: the assistant never sent it. */
export const unlinkedTransfer = {
  operationId: 'op-historic-elena',
  reference: 'ref-historic-elena',
  conversationId: conversations.elenaSupport,
  fromAccountId: accounts.elena,
  toAccountId: accounts.hugo,
  amountCents: 2500,
} as const;

/** Ids that exist nowhere in the seed, for not-found and forbidden paths. */
export const unknown = {
  person: 'mallory',
  account: 'acc-missing',
  case: 'case-does-not-exist',
  reference: 'ref-does-not-exist',
} as const;

/** Sizes of the seeded world. */
export const counts = {
  people: 10,
  conversations: 47,
  cases: 17,
  closedCases: 8,
  documents: 80,
  publicDocuments: 68,
} as const;

/** Money facts the bank enforces (docs/contracts.md) and the seed guarantees. */
export const money = {
  /** Largest transfer the bank and the transfer schema accept. Above every seeded balance. */
  maxTransferCents: 10_000_000,
  /** Lowest seeded balance of any account (diego's main account). */
  lowestBalanceCents: 7500,
} as const;
