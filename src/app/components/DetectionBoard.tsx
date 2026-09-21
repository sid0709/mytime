import { Shield, ShieldAlert, ShieldOff } from "lucide-react";

import { useInputMonitorStatus } from "../hooks/useInputMonitorStatus";

type OriginKind = "hardware" | "remote" | "permission";

function originKind(
  listenEventAccess: boolean | undefined,
  remoteSessionActive: boolean | undefined,
): OriginKind {
  if (listenEventAccess === false) return "permission";
  if (remoteSessionActive) return "remote";
  return "hardware";
}

export function DetectionBoard() {
  const { status, isLoading } = useInputMonitorStatus();

  const origin = originKind(status?.listenEventAccess, status?.remoteSessionActive);
  const rejectedInjected = status?.rejectedInjected ?? 0;
  const rejectedRemote = status?.rejectedRemote ?? 0;

  return (
    <div className="bg-card rounded-2xl border border-border p-3 sm:p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        Hardware-only input
      </p>
      <div className="min-w-0">
        <OriginPill kind={origin} pending={!status && isLoading} />
        <p className="text-xs text-muted-foreground mt-2">
          {rejectedInjected.toLocaleString()} injected discarded
          {" · "}
          {rejectedRemote.toLocaleString()} remote
        </p>
        {origin !== "hardware" && status?.message ? (
          <p className="text-[11px] text-muted-foreground/90 mt-1 line-clamp-2">
            {status.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function OriginPill({
  kind,
  pending,
}: {
  kind: OriginKind;
  pending?: boolean;
}) {
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-secondary text-muted-foreground">
        Checking…
      </span>
    );
  }
  const Icon =
    kind === "remote" ? ShieldAlert : kind === "permission" ? ShieldOff : Shield;
  const label =
    kind === "remote"
      ? "Remote — not counted"
      : kind === "permission"
        ? "Permission needed"
        : "Hardware";
  const wrap =
    kind === "remote"
      ? "bg-sky-500/15 text-sky-300"
      : kind === "permission"
        ? "bg-amber-500/15 text-amber-300"
        : "bg-emerald-500/15 text-emerald-400";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${wrap}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}
