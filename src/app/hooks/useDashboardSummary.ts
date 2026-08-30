import { useCallback, useRef, useState } from "react";

import { getDashboardSummary } from "../api/dashboard";
import type { DashboardSummaryDto } from "../types/backend";
import { useSerialPolling } from "./useSerialPolling";

export type DashboardSummaryMode = "off" | "passive" | "live";

export function useDashboardSummary(mode: DashboardSummaryMode = "live") {
  const [summary, setSummary] = useState<DashboardSummaryDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      setError(null);
      const nextSummary = await getDashboardSummary();
      if (requestId !== requestIdRef.current) return;
      setSummary(nextSummary);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load dashboard summary");
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useSerialPolling(refresh, {
    enabled: mode !== "off",
    intervalMs: mode === "live" ? 5_000 : 15_000,
    hiddenIntervalMs: 60_000,
  });

  return {
    summary,
    isLoading,
    error,
    refresh,
  };
}
