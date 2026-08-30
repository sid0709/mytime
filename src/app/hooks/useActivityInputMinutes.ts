import { useCallback, useRef, useState } from "react";

import { getActivityInputMinutes } from "../api/activity";
import type { AppInputMinuteDto } from "../types/backend";

import { useSerialPolling } from "./useSerialPolling";

const DEFAULT_POLL_MS = 10_000;

export function useActivityInputMinutes(pollMs = DEFAULT_POLL_MS) {
  const [inputMinutes, setInputMinutes] = useState<AppInputMinuteDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      setError(null);
      const next = await getActivityInputMinutes();
      if (requestId !== requestIdRef.current) return;
      setInputMinutes(next);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load activity input minutes",
      );
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useSerialPolling(refresh, {
    intervalMs: pollMs,
    hiddenIntervalMs: Math.max(pollMs * 6, 60_000),
  });

  return {
    inputMinutes,
    isLoading,
    error,
    refresh,
  };
}
