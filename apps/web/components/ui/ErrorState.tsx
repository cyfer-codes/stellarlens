export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3">
      <p className="text-sm font-medium text-red-800 dark:text-red-300">{title}</p>
      <p className="mt-1 text-sm text-red-600 dark:text-red-400">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded bg-gray-900 dark:bg-gray-100 px-4 py-2 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
        >
          Try again
        </button>
      )}
    </div>
  );
}
