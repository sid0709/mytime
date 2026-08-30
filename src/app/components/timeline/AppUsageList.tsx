import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  LayoutList,
  Search,
} from "lucide-react";

import { useActivitySessionPage } from "../../hooks/useActivitySessionPage";
import type { AppUsageSummaryDto } from "../../types/backend";
import {
  getAppVisualMeta,
  toTimelineBlockFromSession,
} from "../../activityAppUsage";
import {
  type TimelineBlock,
  formatDuration,
  formatMinutes,
} from "./timeline-data";
import {
  AppSummarySkeletonRow,
  AppUsageSkeletonRow,
} from "../ui/SkeletonRows";
import { AppIcon } from "./AppIcon";

interface AppUsageListProps {
  appSummaries: AppUsageSummaryDto[];
  appIconDataUrlById?: Record<string, string | null | undefined>;
  isLoading?: boolean;
  onBlockSelect: (block: TimelineBlock) => void;
  selectedBlockIds: Set<string>;
}

type SortField = "title" | "start" | "end" | "duration" | "app";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 120;
const LOAD_MORE_THRESHOLD_PX = 120;

export function AppUsageList({
  appSummaries,
  appIconDataUrlById = {},
  isLoading = false,
  onBlockSelect,
  selectedBlockIds,
}: AppUsageListProps) {
  const [sortField, setSortField] = useState<SortField>("start");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterText, setFilterText] = useState("");
  const [filterApp, setFilterApp] = useState<string | null>(null);
  const deferredFilterText = useDeferredValue(filterText);
  const mainScrollRef = useRef<HTMLDivElement>(null);

  const {
    sessions,
    total,
    hasMore,
    isLoading: isPageLoading,
    isLoadingMore,
    error,
    loadMore,
  } = useActivitySessionPage({
    limit: PAGE_SIZE,
    filterText: deferredFilterText,
    appId: filterApp,
    sortField,
    sortDir,
  });

  const summaryEntries = useMemo(() => {
    const loweredFilter = deferredFilterText.trim().toLowerCase();
    const next = loweredFilter
      ? appSummaries.filter((app) =>
          app.appName.toLowerCase().includes(loweredFilter),
        )
      : appSummaries;
    return [...next].sort((a, b) => b.totalDurationMs - a.totalDurationMs);
  }, [appSummaries, deferredFilterText]);

  const totalMins = useMemo(
    () =>
      appSummaries.reduce(
        (sum, app) => sum + Math.max(0, app.totalDurationMs / 60000),
        0,
      ),
    [appSummaries],
  );
  const activeFilterAppName = useMemo(
    () =>
      appSummaries.find((app) => app.appId === filterApp)?.appName ?? filterApp,
    [appSummaries, filterApp],
  );

  const handleScroll = useCallback(() => {
    const el = mainScrollRef.current;
    if (!el || isLoadingMore || !hasMore) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight <= LOAD_MORE_THRESHOLD_PX) {
      void loadMore();
    }
  }, [hasMore, isLoadingMore, loadMore]);

  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) {
      return;
    }
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setSortField(field);
    setSortDir(field === "start" ? "desc" : "asc");
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ChevronUp className="w-3 h-3 text-muted-foreground/30" />;
    }

    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 text-primary" />
    ) : (
      <ChevronDown className="w-3 h-3 text-primary" />
    );
  };

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-foreground flex items-center gap-2">
              <LayoutList className="w-5 h-5 text-chart-3" />
              Application Usage Log
            </h3>
            <p className="text-muted-foreground text-xs mt-1">
              Paged session history with backend-side sorting and filtering
            </p>
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {total} entries
          </span>
        </div>
      </div>

      <div className="flex divide-x divide-border">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-border">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter by title or app..."
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                className="w-full bg-secondary border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            {filterApp && (
              <button
                onClick={() => setFilterApp(null)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-[10px] hover:bg-primary/20 transition-colors cursor-pointer"
              >
                <Filter className="w-3 h-3" />
                {activeFilterAppName}
                <span className="ml-1 opacity-60">&times;</span>
              </button>
            )}
            <span className="text-[10px] text-muted-foreground shrink-0">
              showing {sessions.length} of {total}
            </span>
          </div>

          {error && (
            <div className="px-4 py-2 border-b border-border bg-destructive/10 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <div className="min-w-[520px]">
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-4 py-1.5 border-b border-border bg-secondary/20 text-[10px] text-muted-foreground uppercase tracking-wider">
                <button
                  onClick={() => toggleSort("title")}
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors text-left"
                >
                  Title <SortIcon field="title" />
                </button>
                <button
                  onClick={() => toggleSort("app")}
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors w-24"
                >
                  App <SortIcon field="app" />
                </button>
                <button
                  onClick={() => toggleSort("start")}
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors w-20"
                >
                  Start <SortIcon field="start" />
                </button>
                <button
                  onClick={() => toggleSort("end")}
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors w-20"
                >
                  End <SortIcon field="end" />
                </button>
                <button
                  onClick={() => toggleSort("duration")}
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors w-16 justify-end"
                >
                  Duration <SortIcon field="duration" />
                </button>
              </div>
            </div>
          </div>

          <div
            ref={mainScrollRef}
            className="max-h-[320px] overflow-y-auto overflow-x-auto overscroll-y-contain"
          >
            <div className="min-w-[520px]">
              {sessions.map((session) => {
                const block = toTimelineBlockFromSession(
                  session,
                  appIconDataUrlById,
                );
                const isSelected = selectedBlockIds.has(block.id);

                return (
                  <div
                    key={session.id}
                    onClick={() => onBlockSelect(block)}
                    className={`grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-4 py-2 border-b border-border/50 cursor-pointer transition-all duration-150 ${
                      isSelected
                        ? "bg-primary/10 border-l-2 border-l-primary"
                        : "hover:bg-secondary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <AppIcon
                        iconDataUrl={block.iconDataUrl}
                        fallback={block.icon}
                        size={14}
                      />
                      <span className="text-xs text-foreground truncate">
                        {block.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 w-24">
                      <div
                        className="w-2 h-2 rounded-sm shrink-0"
                        style={{ backgroundColor: block.color }}
                      />
                      <span className="text-[11px] text-muted-foreground truncate">
                        {block.app}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums w-20">
                      {formatMinutes(block.startMin)}
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums w-20">
                      {formatMinutes(block.endMin)}
                    </span>
                    <span className="text-[11px] text-foreground tabular-nums w-16 text-right">
                      {formatDuration(block.endMin - block.startMin)}
                    </span>
                  </div>
                );
              })}

              {(isLoading || isPageLoading) &&
                Array.from({ length: 4 }, (_, index) => (
                  <AppUsageSkeletonRow key={`skel-${index}`} />
                ))}

              {isLoadingMore &&
                Array.from({ length: 3 }, (_, index) => (
                  <AppUsageSkeletonRow key={`skel-more-${index}`} />
                ))}

              {!isLoading &&
                !isPageLoading &&
                sessions.length === 0 &&
                !error && (
                  <div className="px-4 py-8 text-sm text-muted-foreground">
                    No matching application sessions for the current filters.
                  </div>
                )}
            </div>
          </div>
        </div>

        <div className="w-[280px] shrink-0 hidden md:block">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-xs text-foreground">App Summary</span>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              Total: {formatDuration(totalMins)}
            </div>
          </div>
          <div className="max-h-[360px] overflow-y-auto overscroll-y-contain">
            {summaryEntries.map((stat) => {
              const minutes = Math.max(0, stat.totalDurationMs / 60000);
              const pct =
                totalMins > 0 ? Math.round((minutes / totalMins) * 100) : 0;
              const isFiltered = filterApp === stat.appId;
              const meta = getAppVisualMeta(stat.appId, stat.appName);

              return (
                <div
                  key={stat.appId}
                  onClick={() =>
                    setFilterApp((prev) =>
                      prev === stat.appId ? null : stat.appId,
                    )
                  }
                  className={`flex items-center gap-3 px-4 py-2.5 border-b border-border/50 cursor-pointer transition-all duration-150 ${
                    isFiltered ? "bg-primary/5" : "hover:bg-secondary/40"
                  }`}
                >
                  <AppIcon
                    iconDataUrl={stat.iconDataUrl}
                    fallback={meta.icon}
                    size={16}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-foreground truncate">
                        {stat.appName}
                      </span>
                      <span className="text-xs text-foreground tabular-nums shrink-0 ml-2">
                        {formatDuration(minutes)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: meta.color,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-8 text-right tabular-nums">
                        {pct}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {(isLoading || isPageLoading) &&
              summaryEntries.length === 0 &&
              Array.from({ length: 3 }, (_, index) => (
                <AppSummarySkeletonRow key={`skel-sum-${index}`} />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
