"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export interface PageSizeOption {
  size: number;
  /** URL of the first page at this size (built server-side so filters are preserved). */
  href: string;
}

export function TransfersPageSizeSelect({ value, options }: { value: number; options: PageSizeOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
      Rows per page
      <select
        value={value}
        disabled={pending}
        aria-busy={pending}
        onChange={(event) => {
          const option = options.find((candidate) => candidate.size === Number(event.target.value));
          if (option) {
            startTransition(() => router.push(option.href));
          }
        }}
        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-sm disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.size} value={option.size}>
            {option.size}
          </option>
        ))}
      </select>
    </label>
  );
}
