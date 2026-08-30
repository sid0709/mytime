import { useMemo, useState } from "react";
import { RefreshCw, Shield, ShieldAlert, ShieldOff, Sparkles } from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AppInputMinuteDto } from "../types/backend";
import { QUALITY_BROWSING_TARGET, workQualitySummary } from "../constants/activityScore";
import { lastSecondsPercents } from "../constants/density";
import { useInputMonitorStatus } from "../hooks/useInputMonitorStatus";
import { useLiveWorkQuality } from "../hooks/useLiveWorkQuality";
import {
  getQualityDaySnapshot,
  isQualityDayReady,
  refreshQualityLive,
} from "../qualityLiveStore";
import { formatTooltipNumber } from "../utils/formatTooltipValue";

interface Props {
  inputMinutes?: AppInputMinuteDto[];
}

type OriginKind = "hardware" | "remote" | "permission";

function originKind(
  listenEventAccess: boolean | undefined,
  remoteSessionActive: boolean | undefined,
): OriginKind {
  if (listenEventAccess === false) return "permission";
  if (remoteSessionActive) return "remote";
  return "hardware";
}

export function DetectionBoard({ inputMinutes = [] }: Props) {
  const { status, isLoading } = useInputMonitorStatus();
  const live = useLiveWorkQuality();
  const [refreshing, setRefreshing] = useState(false);

  const origin = originKind(status?.listenEventAccess, status?.remoteSessionActive);
  const rejectedInjected = status?.rejectedInjected ?? 0;
  const rejectedRemote = status?.rejectedRemote ?? 0;

  const { volume, effective, lowVariety } = useMemo(
    () => workQualitySummary(inputMinutes),
    [inputMinutes],
  );
  const quality = live.quality;
  const densitySeries = useMemo(
    () =>
      lastSecondsPercents(
        isQualityDayReady() ? getQualityDaySnapshot() : undefined,
        live.secondOfDay,
        60,
        live.spark,
      ),
    [live.secondOfDay, live.spark],
  );
  const windowLabel = `${Math.round(live.windowMs / 1000)}s`;
  const qualityPct = Math.round(quality * 100);
  const qualityColor =
    qualityPct === 0
      ? "text-muted-foreground"
      : quality >= 0.7
        ? "text-emerald-400"
        : quality >= QUALITY_BROWSING_TARGET
          ? "text-primary"
          : "text-amber-400";

  return (
    <div className="bg-card rounded-2xl border border-border p-3 sm:p-4">
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 lg:gap-6">
        <div className="flex-1 min-w-0">
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

        <div className="hidden lg:block w-px bg-border self-stretch" />

        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Varied work vs one-channel activity
          </p>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className={`text-xl tabular-nums tracking-tight ${qualityColor}`}>
                  {qualityPct}%
                </span>
                <span className="text-xs text-muted-foreground">
                  density · last {windowLabel}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRefreshing(true);
                    void refreshQualityLive().finally(() => setRefreshing(false));
                  }}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {`${lowVariety ? "High input, low variety · " : ""}Volume ${Math.round(volume).toLocaleString()} · effective ${Math.round(effective).toLocaleString()}`}
              </p>
              <DensityLineChart percents={densitySeries} />
            </div>
          </div>
        </div>
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

function DensityLineChart({ percents }: { percents: number[] }) {
  const data = useMemo(
    () => percents.map((pct, i) => ({ i, pct })),
    [percents],
  );

  if (percents.length === 0) {
    return <div className="h-14 mt-2 rounded-md bg-secondary/40" />;
  }

  return (
    <div className="h-14 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="detectionDensityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="i" hide />
          <YAxis hide domain={[0, 100]} />
          <Tooltip
            cursor={{ stroke: "var(--grid-stroke-strong)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const pct = Number(payload[0]?.value ?? 0);
              return (
                <div className="bg-card border border-border rounded-lg px-2 py-1 shadow-lg text-[10px] tabular-nums">
                  {formatTooltipNumber(pct, 1)}%
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="pct"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#detectionDensityFill)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
