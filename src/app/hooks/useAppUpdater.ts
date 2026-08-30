import { useCallback, useEffect, useRef, useState } from "react";

import { changelogReleases } from "../changelogReleases";
import { formatUpdateNotes } from "../formatUpdateNotes";
import { hasTauriRuntime, invokeCommand } from "../api/tauri";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 4_000;

type UpdateHandle = NonNullable<
  Awaited<ReturnType<(typeof import("@tauri-apps/plugin-updater"))["check"]>>
>;

export type UpdatePhase =
  | "idle"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string[];
  date?: string;
}

export function useAppUpdater() {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const updateRef = useRef<UpdateHandle | null>(null);
  const phaseRef = useRef<UpdatePhase>("idle");
  const checkingRef = useRef(false);
  const dismissedVersionRef = useRef<string | null>(null);

  phaseRef.current = phase;

  const checkNow = useCallback(async () => {
    if (!hasTauriRuntime() || import.meta.env.DEV) return;
    if (checkingRef.current) return;
    const currentPhase = phaseRef.current;
    if (currentPhase === "downloading" || currentPhase === "installing") return;

    checkingRef.current = true;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) return;
      if (dismissedVersionRef.current === update.version) return;

      const changelogNotes =
        changelogReleases.find((release) => release.version === update.version)
          ?.notes ?? [];
      updateRef.current = update;
      setAvailable({
        version: update.version,
        currentVersion: update.currentVersion,
        notes: formatUpdateNotes(update.body ?? "", changelogNotes),
        date: update.date,
      });
      setPhase("available");
      setError(null);
    } catch {
      // Offline or GitHub unreachable — stay quiet until the next check.
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    setPhase("downloading");
    setProgress(0);
    setError(null);

    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength ?? 0;
          if (total > 0) {
            setProgress(Math.min(99, Math.round((downloaded / total) * 100)));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
          setPhase("installing");
        }
      });
      setPhase("installing");
      try {
        await invokeCommand("clear_app_quarantine");
      } catch {
        // Best-effort: a failure here still relaunches; Gatekeeper may prompt.
      }
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "The update could not be installed.");
    }
  }, []);

  const dismiss = useCallback(() => {
    if (phaseRef.current === "downloading" || phaseRef.current === "installing") {
      return;
    }
    if (available) {
      dismissedVersionRef.current = available.version;
    }
    setAvailable(null);
    setPhase("idle");
    setError(null);
  }, [available]);

  useEffect(() => {
    if (!hasTauriRuntime() || import.meta.env.DEV) return;

    const startup = window.setTimeout(() => {
      void checkNow();
    }, STARTUP_DELAY_MS);
    const interval = window.setInterval(() => {
      void checkNow();
    }, CHECK_INTERVAL_MS);

    return () => {
      window.clearTimeout(startup);
      window.clearInterval(interval);
    };
  }, [checkNow]);

  return {
    phase,
    available,
    progress,
    error,
    install,
    dismiss,
  };
}
