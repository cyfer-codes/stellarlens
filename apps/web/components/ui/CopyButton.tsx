"use client";

import { useEffect, useState } from "react";

const CONFIRMATION_MS = 2000;

export function CopyButton({
  value,
  label = "Copy",
  ariaLabel
}: {
  value: string;
  label?: string;
  /** Describes what gets copied, e.g. "Copy contract address". Required when `label` is an icon. */
  ariaLabel?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  // Reset the feedback after a moment; re-copying restarts the timer.
  useEffect(() => {
    if (status === "idle") {
      return;
    }
    const timeout = setTimeout(() => setStatus("idle"), CONFIRMATION_MS);
    return () => clearTimeout(timeout);
  }, [status]);

  async function handleCopy() {
    try {
      // `navigator.clipboard` is missing outside secure contexts (plain http), which lands in the catch.
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  const feedback = status === "copied" ? "Copied!" : status === "failed" ? "Copy failed" : "";

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={ariaLabel ?? (label === "Copy" ? "Copy to clipboard" : undefined)}
        className="text-xs font-medium text-gray-600 dark:text-gray-400 hover:underline"
      >
        {label}
      </button>
      <span
        role="status"
        aria-live="polite"
        className={`pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 dark:bg-gray-100 px-2 py-1 text-xs text-white dark:text-gray-900 transition-opacity ${
          feedback ? "opacity-100" : "opacity-0"
        }`}
      >
        {feedback}
      </span>
    </span>
  );
}
