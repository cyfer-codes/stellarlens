export class StellarLensApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** Existing contract id returned by POST /contracts when registration conflicts. */
  readonly existingId?: number;

  constructor(status: number, body: unknown) {
    super(`stellarlens api request failed with status ${status}`);
    this.name = "StellarLensApiError";
    this.status = status;
    this.body = body;
    if (status === 409 && typeof body === "object" && body !== null && "existingId" in body) {
      const existingId = (body as { existingId?: unknown }).existingId;
      if (typeof existingId === "number") this.existingId = existingId;
    }
  }
}

/**
 * Thrown when a request takes longer than its timeout (`timeoutMs` on the client or on the call). The request is
 * aborted before this is thrown. A caller's own `AbortSignal` rejects with that signal's `reason` instead.
 */
export class StellarLensTimeoutError extends Error {
  readonly method: string;
  readonly url: string;
  readonly timeoutMs: number;

  constructor(method: string, url: string, timeoutMs: number) {
    super(`stellarlens request ${method} ${url} timed out after ${timeoutMs}ms`);
    this.name = "StellarLensTimeoutError";
    this.method = method;
    this.url = url;
    this.timeoutMs = timeoutMs;
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
