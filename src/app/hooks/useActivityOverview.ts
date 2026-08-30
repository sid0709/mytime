import { startTransition, useCallback, useRef, useState } from "react";

import { getActivityOverview } from "../api/activity";
import type { ActivityOverviewDto } from "../types/backend";
import { useSerialPolling } from "./useSerialPolling";

const POLL_MS = 12_000;

export function useActivityOverview() {
  const [overview, setOverview] = useState<ActivityOverviewDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const iconByAppIdRef = useRef(new Map<string, string | null>());
  const iconStateKnownForAppRef = useRef(new Set<string>());
  const needsIconRefreshRef = useRef(true);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const includeIcons = needsIconRefreshRef.current;
    try {
      setError(null);
      const next = await getActivityOverview(includeIcons);
      if (requestId !== requestIdRef.current) return;

      if (includeIcons) {
        for (const app of next.apps) {
          iconStateKnownForAppRef.current.add(app.appId);
          iconByAppIdRef.current.set(app.appId, app.iconDataUrl ?? null);
        }
        needsIconRefreshRef.current = false;
      } else if (
        next.apps.some(
          (app) => !iconStateKnownForAppRef.current.has(app.appId),
        )
      ) {
        // A newly observed app gets its icon on the next serial refresh. Existing icons are never
        // retransmitted, which avoids recurring base64 allocation and WebView bridge traffic.
        needsIconRefreshRef.current = true;
      }

      const hydrated = {
        ...next,
        apps: next.apps.map((app) => ({
          ...app,
          iconDataUrl:
            app.iconDataUrl ?? iconByAppIdRef.current.get(app.appId) ?? null,
        })),
      };
      startTransition(() => {
        setOverview(hydrated);
      });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load activity overview",
      );
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useSerialPolling(refresh, {
    intervalMs: POLL_MS,
    hiddenIntervalMs: 60_000,
  });

  return {
    overview,
    isLoading,
    error,
    refresh,
  };
}
