"use client";

import { Skeleton } from "@/components/ui/Skeleton";

const SKELETON_ROW_COUNT = 5;
const SKELETON_COLUMN_WIDTHS = ["w-16", "w-28", "w-40", "w-48"];

function EventsTableHead() {
  return (
    <thead>
      <tr className="border-b border-gray-200 text-gray-500">
        <th className="py-2 font-medium">Ledger</th>
        <th className="py-2 font-medium">Tx hash</th>
        <th className="py-2 font-medium">Topic</th>
        <th className="py-2 font-medium">Decoded data</th>
      </tr>
    </thead>
  );
}

export default function EventsTableSkeleton() {
  return (
    <div className="overflow-x-auto" aria-busy="true">
      <span className="sr-only">Loading events…</span>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <EventsTableHead />
        <tbody>
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, row) => (
            <tr key={row} className="border-b border-gray-100">
              {SKELETON_COLUMN_WIDTHS.map((width) => (
                <td key={width} className="py-2">
                  <Skeleton className={`my-0.5 h-4 ${width}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { EventsTableSkeleton };
