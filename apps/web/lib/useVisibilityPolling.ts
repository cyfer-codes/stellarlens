"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `callback` every `intervalMs` while the document is visible. Polling
 * stops when the tab is hidden or the component unmounts, and an immediate
 * call is made when the tab becomes visible again so the data catches up
 * without waiting a full interval.
 *
 * The latest `callback` is always used, so callers don't need to memoize it.
 * Pass `enabled: false` to suspend polling entirely.
 */
export function useVisibilityPolling(
  callback: () => void,
  intervalMs: number,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let interval: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (interval === null) {
        interval = setInterval(() => callbackRef.current(), intervalMs);
      }
    }

    function stop() {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        callbackRef.current();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
