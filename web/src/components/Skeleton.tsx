/**
 * Tiny shimmer skeleton for loading states. Tailwind-only — no extra deps.
 *
 * Replaces "Loading…" text with structured placeholders that hint at the
 * shape of incoming content (reduces perceived wait time and prevents
 * layout shift when data arrives).
 */

export function Skeleton({
  className = "",
  height = "h-4",
}: {
  className?: string;
  height?: string;
}) {
  return (
    <div
      className={`${height} ${className} bg-ink-700 rounded animate-pulse`}
      aria-hidden="true"
    />
  );
}

export function BasketCardSkeleton() {
  return (
    <div className="bg-ink-800 border border-ink-700 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="w-32" />
          <Skeleton className="w-48" height="h-3" />
        </div>
        <Skeleton className="w-16" height="h-5" />
      </div>
      <Skeleton className="w-full" height="h-9" />
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <Skeleton className="w-full mb-1" height="h-3" />
            <Skeleton className="w-full" height="h-1.5" />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Skeleton className="flex-1" height="h-9" />
        <Skeleton className="w-9" height="h-9" />
        <Skeleton className="w-9" height="h-9" />
      </div>
    </div>
  );
}
