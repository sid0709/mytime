import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Sparkles, LoaderCircle } from "lucide-react";

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

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onDismiss]);

  if (typeof document === "undefined") return null;

  const title =
    phase === "installing"
      ? "Restarting"
      : phase === "downloading"
        ? "Downloading"
        : phase === "error"
          ? "Update failed"
          : "Update ready";

  return createPortal(
    <AnimatePresence>
      {open && available && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.button
            type="button"
            aria-label="Dismiss update"
            className="absolute inset-0 bg-background/55 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (!busy) onDismiss();
            }}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="update-dialog-title"
            className="relative w-full max-w-[400px] overflow-hidden rounded-3xl border border-border/70 bg-card shadow-[0_28px_80px_-24px_rgba(99,102,241,0.45)]"
            initial={{ opacity: 0, scale: 0.94, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            <div className="h-1 w-full bg-gradient-to-r from-primary via-violet-400 to-cyan-400" />

            <div className="p-6">
              <div className="flex items-start gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-violet-500 text-white shadow-[0_8px_24px_-8px_rgba(99,102,241,0.8)]">
                  {busy ? (
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 pt-0.5">
                  <h2
                    id="update-dialog-title"
                    className="text-[17px] font-semibold tracking-tight text-foreground"
                  >
                    {title}
                  </h2>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                      v{available.currentVersion}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/70" />
                    <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium tabular-nums text-primary">
                      v{available.version}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-5">
                {busy ? (
                  <div className="rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-400"
                        initial={{ width: 0 }}
                        animate={{
                          width: `${phase === "installing" ? 100 : Math.max(progress, 8)}%`,
                        }}
                        transition={{ type: "spring", stiffness: 120, damping: 24 }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
                      {phase === "installing"
                        ? "Installing and restarting…"
                        : progress > 0
                          ? `${progress}% downloaded`
                          : "Starting download…"}
                    </p>
                  </div>
                ) : available.notes.length > 0 ? (
                  <div className="rounded-2xl border border-border/60 bg-secondary/35 px-4 py-3">
                    <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      What's new
                    </p>
                    <ul className="max-h-40 space-y-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {available.notes.map((note, index) => (
                        <li
                          key={`${available.version}-${index}`}
                          className="relative pl-3.5 text-[13px] leading-relaxed text-foreground/80"
                        >
                          <span className="absolute left-0 top-[0.55em] h-1.5 w-1.5 rounded-full bg-primary/70" />
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    A newer build is ready. MyTime will download it, verify the
                    signature, and restart.
                  </p>
                )}

                {error && (
                  <p className="mt-3 text-[13px] leading-relaxed text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onDismiss}
                  disabled={busy}
                  className="h-9 rounded-xl px-3.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  Later
                </button>
                <button
                  type="button"
                  onClick={() => void onInstall()}
                  disabled={busy}
                  className="h-9 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-[0_8px_20px_-8px_rgba(99,102,241,0.9)] transition-transform hover:brightness-110 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                >
                  {phase === "error" ? "Try again" : "Update now"}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
