import { Download, RefreshCw } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import type { AvailableUpdate, UpdatePhase } from "../hooks/useAppUpdater";

interface UpdateAvailableModalProps {
  available: AvailableUpdate | null;
  phase: UpdatePhase;
  progress: number;
  error: string | null;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateAvailableModal({
  available,
  phase,
  progress,
  error,
  onInstall,
  onDismiss,
}: UpdateAvailableModalProps) {
  const busy = phase === "downloading" || phase === "installing";
  const open = available !== null && phase !== "idle";

  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        className="rounded-2xl sm:max-w-md"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
          else onDismiss();
        }}
      >
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {busy ? (
                <RefreshCw className="h-5 w-5 animate-spin" />
              ) : (
                <Download className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <AlertDialogTitle>
                {phase === "installing"
                  ? "Restarting MyTime"
                  : phase === "downloading"
                    ? "Downloading update"
                    : "A new version is available"}
              </AlertDialogTitle>
              {available && (
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {available.currentVersion} → {available.version}
                </p>
              )}
            </div>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-3 pt-1">
              {available?.notes ? (
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                  {available.notes}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Install this update to get the latest fixes and features.
                </p>
              )}
              {busy && (
                <div className="space-y-1.5">
                  <Progress value={phase === "installing" ? 100 : progress} />
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {phase === "installing"
                      ? "Installing and restarting…"
                      : progress > 0
                        ? `${progress}%`
                        : "Starting download…"}
                  </p>
                </div>
              )}
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onDismiss}
            disabled={busy}
          >
            Later
          </Button>
          <Button type="button" onClick={() => void onInstall()} disabled={busy}>
            {phase === "error" ? "Try again" : "Update now"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
