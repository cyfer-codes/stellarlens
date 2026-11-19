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

export type StellarLensHook = "onRequest" | "onResponse";

/**
 * Thrown when a user-supplied `onRequest`/`onResponse` hook throws or rejects. The original error is on
 * `cause`; `hook`, `method` and `url` say which hook failed, for which call. An `onRequest` failure means the
 * request was never sent; an `onResponse` failure means it was sent and a response arrived, but its body was
 * not processed.
 */
export class StellarLensHookError extends Error {
  readonly hook: StellarLensHook;
  readonly method: string;
  readonly url: string;

  constructor(hook: StellarLensHook, method: string, url: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`stellarlens ${hook} hook threw for ${method} ${url}: ${reason}`, { cause });
    this.name = "StellarLensHookError";
    this.hook = hook;
    this.method = method;
    this.url = url;
  }
}
