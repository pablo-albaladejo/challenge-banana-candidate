/** An error with the HTTP status it maps to (`toErrorResponse` in `errors.ts`). */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
