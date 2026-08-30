import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { getActivitySessionPage } from "../api/activity";
import type { ActivitySessionPageDto, AppUsageSessionDto } from "../types/backend";

interface UseActivitySessionPageOptions {
  limit?: number;
  filterText?: string;
  appId?: string | null;
  sortField?: string;
  sortDir?: string;
}

const MAX_RETAINED_SESSIONS = 1_200;

export function useActivitySessionPage({
  limit = 150,
  filterText,
  appId,
  sortField = "start",
  sortDir = "desc",
}: UseActivitySessionPageOptions) {
  const [sessions, setSessions] = useState<AppUsageSessionDto[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      const requestId = ++requestIdRef.current;
      if (append) loadMoreInFlightRef.current = true;
      try {
        setError(null);
        if (append) {
          setIsLoadingMore(true);
        } else {
          setIsLoading(true);
        }

        const page: ActivitySessionPageDto = await getActivitySessionPage({
          offset,
          limit,
          filterText,
          appId,
          sortField,
          sortDir,
        });

        if (requestId !== requestIdRef.current) {
          return;
        }

        startTransition(() => {
          setTotal(page.total);
          setSessions((prev) =>
            append
              ? [...prev, ...page.sessions].slice(0, MAX_RETAINED_SESSIONS)
              : page.sessions.slice(0, MAX_RETAINED_SESSIONS),
          );
        });
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setError(
          err instanceof Error ? err.message : "Failed to load activity sessions",
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
        if (append) loadMoreInFlightRef.current = false;
      }
    },
    [appId, filterText, limit, sortDir, sortField],
  );

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    if (
      isLoading ||
      isLoadingMore ||
      loadMoreInFlightRef.current ||
      sessions.length >= total ||
      sessions.length >= MAX_RETAINED_SESSIONS
    ) {
      return;
    }
    await loadPage(sessions.length, true);
  }, [isLoading, isLoadingMore, loadPage, sessions.length, total]);

  return {
    sessions,
    total,
    hasMore:
      sessions.length < total && sessions.length < MAX_RETAINED_SESSIONS,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
    refresh: () => loadPage(0, false),
  };
}
