import { useEffect, useMemo, useRef } from "react";
import { Heart, Monitor, Zap } from "lucide-react";

import type { AppInputMinuteDto } from "../types/backend";
import { densityColor, minuteDensityPercent } from "../constants/density";
import { useLiveWorkQuality, useQualityDay } from "../hooks/useLiveWorkQuality";

interface Props {
  inputMinutes?: AppInputMinuteDto[];
  sessionDuration?: string;
}

function currentMinuteOfDay(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** Live percent only — isolated so 1 Hz ticks do not rebuild the minute bars. */
function LiveDensityBadge() {
  const live = useLiveWorkQuality();
  const currentDensity = live.quality * 100;
  const densityTint = densityColor(currentDensity);

  return (
    <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 border-r border-border shrink-0">
      <Heart
        className="w-5 h-5"
        style={{ color: densityTint }}
        fill={densityTint}
      />
      <div className="flex flex-col">
        <div className="flex items-baseline gap-1">
          <span
            className="text-xl tabular-nums"
            style={{ color: densityTint }}
          >
            {Math.round(currentDensity)}
          </span>
          <span className="text-xs text-muted-foreground">%</span>
        </div>
        <span className="text-[10px] text-muted-foreground">Density</span>
      </div>
    </div>
  );
}

export function LivePulseStrip({
  inputMinutes = [],
  sessionDuration,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const qualityDay = useQualityDay();

  const byMinute = useMemo(
    () => new Map(inputMinutes.map((m) => [m.minuteOfDay, m])),
    [inputMinutes],
  );

  const totalActions = useMemo(() => {
    return inputMinutes.reduce(
      (sum, m) =>
        sum + m.keyPresses + m.mouseClicks + m.mouseMoves + m.scrollEvents,
      0,
    );
  }, [inputMinutes]);

  const pulseMinutes = useMemo(() => {
    const nowMin = currentMinuteOfDay();
    const span = Math.min(120, Math.max(inputMinutes.length, 1));
    return Array.from({ length: span }, (_, i) => {
      const minute = nowMin - (span - 1 - i);
      const density =
        minute < 0
          ? 0
          : minuteDensityPercent(qualityDay, minute, byMinute.get(minute));
      return { minute, density };
    });
  }, [inputMinutes.length, qualityDay, byMinute]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [pulseMinutes]);

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="flex items-stretch h-[72px]">
        <LiveDensityBadge />

        <div className="flex-1 flex flex-col justify-center px-3 sm:px-4 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Live Pulse — Last {pulseMinutes.length} min
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[10px] text-emerald-400">
                {totalActions.toLocaleString()} actions
              </span>
            </div>
          </div>
          <div
            ref={scrollRef}
            className="flex items-end gap-px h-7 overflow-hidden"
          >
            {pulseMinutes.map((event) => (
              <div
                key={event.minute}
                className="shrink-0 rounded-sm"
                style={{
                  width: "4px",
                  height: `${Math.max(event.density, event.density > 0 ? 1 : 0)}%`,
                  backgroundColor: densityColor(event.density),
                  opacity: 0.85,
                }}
              />
            ))}
          </div>
        </div>

        <div className="hidden sm:flex items-center px-3 sm:px-5 border-l border-border shrink-0">
          <div className="flex flex-col items-center gap-1">
            <Monitor className="w-4 h-4 text-primary" />
            <span className="text-xs text-foreground tabular-nums">
              {sessionDuration ?? "—"}
            </span>
            <span className="text-[10px] text-muted-foreground">Session</span>
          </div>
        </div>
      </div>
    </div>
  );
}
