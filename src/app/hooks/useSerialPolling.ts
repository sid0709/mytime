import { useEffect } from "react";

interface SerialPollingOptions {
  intervalMs: number;
  hiddenIntervalMs?: number;
  enabled?: boolean;
}

/**
 * Polls only after the previous request has settled. `setInterval` can accumulate an unbounded
 * number of IPC calls when SQLite or the WebView is temporarily slow; this scheduler cannot.
 */
export function useSerialPolling(
  task: () => Promise<unknown>,
  {
    intervalMs,
    hiddenIntervalMs = Math.max(intervalMs * 6, 60_000),
    enabled = true,
  }: SerialPollingOptions,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let stopped = false;
    let timer: number | null = null;
    let running = false;

    const delay = () =>
      document.visibilityState === "hidden" ? hiddenIntervalMs : intervalMs;

    const schedule = () => {
      if (stopped) return;
      timer = window.setTimeout(() => void poll(), delay());
    };

    const poll = async () => {
      if (stopped || running) return;
      running = true;
      try {
        await task();
      } catch {
        // Resource hooks surface their own errors. Polling must continue after a transient failure.
      } finally {
        running = false;
        schedule();
      }
    };

    const handleVisibilityChange = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (document.visibilityState === "visible" && !running) {
        void poll();
      } else if (!running) {
        schedule();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void poll();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [enabled, hiddenIntervalMs, intervalMs, task]);
}
