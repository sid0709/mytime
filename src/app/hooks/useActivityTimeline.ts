import { useCallback, useRef, useState } from "react";
import { getActivityTimeline } from "../api/activity";
import type { ActivityTimelineDto } from "../types/backend";
import { useSerialPolling } from "./useSerialPolling";

export interface ActivityTimelineChartPoint {
  label: string;
  active: number;
  inactive: number;
  fullDate: string;
}

export function useActivityTimeline(startDate: string, endDate: string) {
  const [dto, setDto] = useState<ActivityTimelineDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchTimeline = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      setError(null);
      const result = await getActivityTimeline(startDate, endDate);
      if (requestId !== requestIdRef.current) return;
      setDto(result);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load activity timeline");
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [startDate, endDate]);

  useSerialPolling(fetchTimeline, {
    intervalMs: 15_000,
    hiddenIntervalMs: 120_000,
  });

  const data: ActivityTimelineChartPoint[] = dto
    ? dto.points.map((p) => ({
        label: p.label,
        active: p.active,
        inactive: p.inactive,
        fullDate: p.fullDate,
      }))
    : [];

  return {
    data,
    isHourly: dto?.isHourly ?? false,
    maxValue: dto?.maxValue ?? 24,
    yLabel: dto?.yLabel ?? "Hours",
    avgActive: dto?.avgActive ?? 0,
    isLoading,
    error,
    refresh: fetchTimeline,
  };
}
