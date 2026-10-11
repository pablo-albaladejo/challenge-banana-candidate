/** Signed session tokens. The token names a person id only; never a role. */
export type SessionTokens = {
  issue(userId: string): string;
  /** The user id when the token's signature is valid, otherwise undefined. */
  verify(token: string): string | undefined;
};
