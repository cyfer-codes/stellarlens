import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSFER_PAGE_SIZE,
  MAX_CURSOR_HISTORY,
  firstPageState,
  nextPageState,
  parseCursor,
  parseCursorHistory,
  parsePageSize,
  previousPageState,
  transfersPageHref,
  withPageSize,
  type TransfersPageState
} from "./transfersPagination";

const FIRST: TransfersPageState = { filters: {}, limit: DEFAULT_TRANSFER_PAGE_SIZE, history: [] };

function query(href: string): Record<string, string> {
  return Object.fromEntries(new URL(href, "http://localhost").searchParams);
}

describe("transfers pagination params", () => {
  it("accepts only the offered page sizes, defaulting to 20", () => {
    expect(parsePageSize("10")).toBe(10);
    expect(parsePageSize("50")).toBe(50);
    expect(parsePageSize(["50", "10"])).toBe(50);
    expect(parsePageSize(undefined)).toBe(20);
    expect(parsePageSize("1000")).toBe(20);
    expect(parsePageSize("abc")).toBe(20);
  });

  it("parses positive integer cursors only", () => {
    expect(parseCursor("42")).toBe(42);
    expect(parseCursor(undefined)).toBeUndefined();
    expect(parseCursor("0")).toBeUndefined();
    expect(parseCursor("-3")).toBeUndefined();
    expect(parseCursor("4.5")).toBeUndefined();
    expect(parseCursor("x")).toBeUndefined();
  });

  it("parses the cursor history and drops it entirely when malformed", () => {
    expect(parseCursorHistory("0,20,40")).toEqual([0, 20, 40]);
    expect(parseCursorHistory(undefined)).toEqual([]);
    expect(parseCursorHistory("0,abc,40")).toEqual([]);
    expect(parseCursorHistory("0,,40")).toEqual([]);
  });

  it("keeps only the most recent history entries", () => {
    const long = Array.from({ length: MAX_CURSOR_HISTORY + 5 }, (_, i) => i).join(",");
    const history = parseCursorHistory(long);
    expect(history).toHaveLength(MAX_CURSOR_HISTORY);
    expect(history[history.length - 1]).toBe(MAX_CURSOR_HISTORY + 4);
  });
});

describe("transfers pagination navigation", () => {
  it("builds a clean first-page href without undefined or default params", () => {
    expect(transfersPageHref(7, { ...FIRST, filters: { asset: undefined, from: "" } })).toBe("/contracts/7/transfers");
  });

  it("walks forward and back through pages, returning to each exact cursor", () => {
    const page2 = nextPageState(FIRST, 20);
    const page3 = nextPageState(page2, 40);
    expect(query(transfersPageHref(7, page3))).toEqual({ cursor: "40", prev: "0,20" });

    const back2 = previousPageState(page3);
    expect(back2).toEqual(page2);
    expect(query(transfersPageHref(7, back2!))).toEqual({ cursor: "20", prev: "0" });

    const back1 = previousPageState(back2!);
    expect(back1).toEqual(FIRST);
    expect(transfersPageHref(7, back1!)).toBe("/contracts/7/transfers");
    expect(previousPageState(back1!)).toBeNull();
  });

  it("round-trips through the URL so deep links keep their Previous history", () => {
    const page3 = nextPageState(nextPageState(FIRST, 20), 40);
    const params = query(transfersPageHref(7, page3));
    const restored: TransfersPageState = {
      filters: {},
      limit: parsePageSize(params.limit),
      cursor: parseCursor(params.cursor),
      history: parseCursorHistory(params.prev)
    };

    expect(restored).toEqual(page3);
  });

  it("preserves filters and page size across navigation", () => {
    const state: TransfersPageState = { ...FIRST, filters: { asset: "CABC", minAmount: "5" }, limit: 50 };
    expect(query(transfersPageHref(7, nextPageState(state, 99)))).toEqual({
      asset: "CABC",
      minAmount: "5",
      limit: "50",
      cursor: "99",
      prev: "0"
    });
  });

  it("restarts from the first page when the page size changes", () => {
    const page3 = nextPageState(nextPageState({ ...FIRST, filters: { to: "GB" } }, 20), 40);
    expect(query(transfersPageHref(7, withPageSize(page3, 10)))).toEqual({ to: "GB", limit: "10" });
  });

  it("can jump back to the first page from a cursor-only deep link", () => {
    const deepLink: TransfersPageState = { ...FIRST, cursor: 500 };
    expect(previousPageState(deepLink)).toBeNull();
    expect(firstPageState(deepLink)).toEqual(FIRST);
  });
});
