export class StellarLensApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`stellarlens api request failed with status ${status}`);
    this.name = "StellarLensApiError";
    this.status = status;
    this.body = body;
  }
}
