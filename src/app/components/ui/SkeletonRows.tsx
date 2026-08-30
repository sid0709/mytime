/**
 * Reusable skeleton loading rows for infinite scroll lists.
 * Each variant matches the row layout of its parent component.
 */

export function SkeletonPulse({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-muted-foreground/10 rounded animate-pulse ${className}`}
    />
  );
}

/** App Usage List skeleton row */
export function AppUsageSkeletonRow() {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-4 py-2.5 border-b border-border/50 items-center">
      <div className="flex items-center gap-2">
        <SkeletonPulse className="w-4 h-4 rounded shrink-0" />
        <SkeletonPulse className="h-3 w-36" />
      </div>
      <div className="flex items-center gap-1.5 w-24">
        <SkeletonPulse className="w-2 h-2 rounded-sm shrink-0" />
        <SkeletonPulse className="h-2.5 w-16" />
      </div>
      <SkeletonPulse className="h-2.5 w-12" />
      <SkeletonPulse className="h-2.5 w-12" />
      <SkeletonPulse className="h-2.5 w-10 ml-auto" />
    </div>
  );
}

/** App Summary skeleton row (right panel) */
export function AppSummarySkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50">
      <SkeletonPulse className="w-5 h-5 rounded shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <SkeletonPulse className="h-3 w-20" />
          <SkeletonPulse className="h-3 w-12" />
        </div>
        <div className="flex items-center gap-2">
          <SkeletonPulse className="flex-1 h-1.5 rounded-full" />
          <SkeletonPulse className="h-2.5 w-8" />
        </div>
      </div>
    </div>
  );
}

/** Live Activity Feed skeleton row — icon, description, detail, timestamp */
export function ActivityFeedSkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl">
      <SkeletonPulse className="w-7 h-7 rounded-lg shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <SkeletonPulse className="h-3 w-28" />
        <SkeletonPulse className="h-3 w-20" />
      </div>
      <SkeletonPulse className="h-3 w-12 shrink-0 tabular-nums" />
    </div>
  );
}
