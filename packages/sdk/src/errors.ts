export class StellarLensApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** Suggested backoff from Retry-After, in seconds; undefined if missing or invalid. */
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, body: unknown, retryAfterSeconds?: number) {
    super(`stellarlens api request failed with status ${status}`);
    this.name = "StellarLensApiError";
    this.status = status;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
