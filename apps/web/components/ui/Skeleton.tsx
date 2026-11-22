export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`} />;
}
