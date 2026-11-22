import { ApiProxyError } from "./api";

/**
 * Maps any error from proxying a request to the api into a sanitized
 * { status, error } pair safe to send to the browser — no internal paths,
 * upstream response bodies or stack traces. The real error is always logged
 * server-side first (apiFetch does this for ApiProxyError; anything else is
 * logged here).
 */
export function sanitizeApiError(err: unknown): { status: number; error: string } {
  if (err instanceof ApiProxyError) {
    return { status: err.status, error: messageForStatus(err.status) };
  }

  console.error(err);
  return { status: 502, error: messageForStatus(502) };
}

function messageForStatus(status: number): string {
  if (status === 404) {
    return "not found";
  }
  if (status === 400) {
    return "invalid request";
  }
  if (status === 401 || status === 403) {
    return "not authorized";
  }
  if (status === 429) {
    return "too many requests, please try again shortly";
  }
  return "something went wrong talking to the api, please try again";
}
