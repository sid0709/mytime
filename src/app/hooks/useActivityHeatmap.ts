import { useCallback, useRef, useState } from "react";
import { getActivityHeatmap } from "../api/activity";
import type { ActivityHeatmapDto } from "../types/backend";
import { useSerialPolling } from "./useSerialPolling";

export function useActivityHeatmap() {
  const [data, setData] = useState<ActivityHeatmapDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchHeatmap = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      setError(null);
      const result = await getActivityHeatmap();
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load activity heatmap");
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useSerialPolling(fetchHeatmap, {
    intervalMs: 60_000,
    hiddenIntervalMs: 300_000,
  });

  return {
    grid: data?.grid ?? null,
    slotSeconds: data?.slotSeconds ?? 3600,
    isLoading,
    error,
    refresh: fetchHeatmap,
  };
}
