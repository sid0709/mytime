import { useCallback, useRef, useState } from "react";

import { getInputMonitorStatus } from "../api/inputMonitor";
import type { InputMonitorStatusDto } from "../types/backend";

import { useSerialPolling } from "./useSerialPolling";

const DEFAULT_POLL_MS = 8_000;

export function useInputMonitorStatus(pollMs = DEFAULT_POLL_MS) {
  const [status, setStatus] = useState<InputMonitorStatusDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const next = await getInputMonitorStatus();
      if (requestId !== requestIdRef.current) return;
      setStatus(next);
    } catch {
      if (requestId !== requestIdRef.current) return;
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useSerialPolling(refresh, {
    intervalMs: pollMs,
    hiddenIntervalMs: Math.max(pollMs * 6, 60_000),
  });

  return { status, isLoading, refresh };
}
