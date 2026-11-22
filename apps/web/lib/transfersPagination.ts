import type { TransferFilterValues } from "@/components/TransferFilters";

/**
 * URL-driven pagination state for the contract transfers table. Everything lives in search params, so any page
 * (including its "Previous" history) can be deep-linked, bookmarked or reloaded:
 *
 * - `limit`  — page size, one of {@link TRANSFER_PAGE_SIZES} (omitted for the default).
 * - `cursor` — the api cursor of the current page (omitted on the first page).
 * - `prev`   — comma-separated cursors of the pages before this one, oldest first; `0` stands for the first page.
 *
 * The api only pages forward, so "Previous" works by popping the last entry of `prev`.
 */

export const TRANSFER_PAGE_SIZES = [10, 20, 50] as const;
export type TransferPageSize = (typeof TRANSFER_PAGE_SIZES)[number];
export const DEFAULT_TRANSFER_PAGE_SIZE: TransferPageSize = 20;
/** Caps how many earlier pages the URL remembers, so the query string stays bounded. */
export const MAX_CURSOR_HISTORY = 50;

/** `0` in the `prev` history means "the first page", which has no cursor. */
const FIRST_PAGE = 0;

type SearchParamValue = string | string[] | undefined;

function single(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPageSize(value: number): value is TransferPageSize {
  return (TRANSFER_PAGE_SIZES as readonly number[]).includes(value);
}

/** Unknown or missing sizes fall back to the default rather than erroring. */
export function parsePageSize(value: SearchParamValue): TransferPageSize {
  const parsed = Number(single(value));
  return isPageSize(parsed) ? parsed : DEFAULT_TRANSFER_PAGE_SIZE;
}

/** A positive integer cursor, or `undefined` (first page) for anything else. */
export function parseCursor(value: SearchParamValue): number | undefined {
  const raw = single(value);
  if (!raw || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Parses `prev`. A malformed history is dropped entirely (rather than partially) so "Previous" can never jump to
 * the wrong page; the "First page" link still gets the user back.
 */
export function parseCursorHistory(value: SearchParamValue): number[] {
  const raw = single(value);
  if (!raw) {
    return [];
  }
  const entries = raw.split(",");
  if (!entries.every((entry) => /^\d+$/.test(entry) && Number.isSafeInteger(Number(entry)))) {
    return [];
  }
  return entries.map(Number).slice(-MAX_CURSOR_HISTORY);
}

export interface TransfersPageState {
  filters: TransferFilterValues;
  limit: TransferPageSize;
  cursor?: number;
  history: number[];
}

export function transfersPageHref(contractId: number, state: TransfersPageState): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) {
    // Skip unset filters: `new URLSearchParams({ key: undefined })` would send the literal string "undefined".
    if (typeof value === "string" && value !== "") {
      query.set(key, value);
    }
  }
  if (state.limit !== DEFAULT_TRANSFER_PAGE_SIZE) {
    query.set("limit", String(state.limit));
  }
  if (state.cursor !== undefined) {
    query.set("cursor", String(state.cursor));
  }
  if (state.history.length > 0) {
    query.set("prev", state.history.join(","));
  }
  const qs = query.toString();
  return `/contracts/${contractId}/transfers${qs ? `?${qs}` : ""}`;
}

/** The page after `state`, remembering the current page so "Previous" can return to it. */
export function nextPageState(state: TransfersPageState, nextCursor: number): TransfersPageState {
  return {
    ...state,
    cursor: nextCursor,
    history: [...state.history, state.cursor ?? FIRST_PAGE].slice(-MAX_CURSOR_HISTORY)
  };
}

/** The page before `state`, or `null` when the URL carries no history (first page, or an old deep link). */
export function previousPageState(state: TransfersPageState): TransfersPageState | null {
  if (state.history.length === 0) {
    return null;
  }
  const previous = state.history[state.history.length - 1];
  return {
    ...state,
    cursor: previous === FIRST_PAGE ? undefined : previous,
    history: state.history.slice(0, -1)
  };
}

export function firstPageState(state: TransfersPageState): TransfersPageState {
  return { ...state, cursor: undefined, history: [] };
}

/** Changing the page size restarts from the first page so page boundaries stay consistent. */
export function withPageSize(state: TransfersPageState, limit: TransferPageSize): TransfersPageState {
  return { ...firstPageState(state), limit };
}
