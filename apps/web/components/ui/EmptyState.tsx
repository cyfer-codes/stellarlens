import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded border border-dashed border-gray-300 px-6 py-10 text-center">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
