import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  AreaChart,
  ZAxis,
} from "recharts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  Clock,
  Coffee,
  Moon,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";

import type { AppInputMinuteDto } from "../types/backend";
import {
  DENSITY_ZONE,
  DENSITY_ZONE_META,
  densityMinuteSpan,
  densityZone,
  meanDensityInRange,
  minuteDensityPercent,
  type DensityZone,
} from "../constants/density";
import { useQualityDay } from "../hooks/useLiveWorkQuality";
import { formatTooltipNumber } from "../utils/formatTooltipValue";

interface ScatterPoint {
  hour: number;
  timeLabel: string;
  density: number;
  zone: DensityZone;
}

interface RhythmPoint {
  minute: number;
  label: string;
  density: number;
}

const zoneIcons: Record<DensityZone, typeof Zap> = {
  peak: Zap,
  good: TrendingUp,
  mixed: Coffee,
  light: Moon,
};

const zoneDescriptions: Record<DensityZone, string> = {
  peak: "Sustained varied work — high 1-second density",
  good: "Steady mixed input — typical focused stretches",
  mixed: "Light or browsing-like mix — still counted on the chart",
  light: "Idle or sparse input — shown as low density, not omitted",
};

function hourLabel(hour: number): string {
  const h = Math.floor(hour);
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h12}:00 ${ampm}`;
}

function currentMinuteOfDay(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function buildSeries(
  inputMinutes: AppInputMinuteDto[],
  qualityDay: Uint8Array | undefined,
) {
  const byMinute = new Map(inputMinutes.map((m) => [m.minuteOfDay, m]));
  const span = densityMinuteSpan(
    qualityDay,
    inputMinutes,
    currentMinuteOfDay(),
  );
  if (!span) return { rhythm: [] as RhythmPoint[], scatter: [] as ScatterPoint[] };

  const [first, last] = span;
  const rhythm: RhythmPoint[] = [];
  for (let minute = first; minute <= last; minute += 1) {
    const density = minuteDensityPercent(
      qualityDay,
      minute,
      byMinute.get(minute),
    );
    const h = Math.floor(minute / 60);
    const min = minute % 60;
    rhythm.push({
      minute,
      label: `${h}:${min.toString().padStart(2, "0")}`,
      density,
    });
  }

  const scatter: ScatterPoint[] = [];
  const blockStart = Math.floor(first / 15) * 15;
  for (let start = blockStart; start <= last; start += 15) {
    const density = meanDensityInRange(
      qualityDay,
      start,
      start + 15,
      inputMinutes,
    );
    const h = Math.floor(start / 60);
    const min = start % 60;
    scatter.push({
      hour: start / 60,
      timeLabel: `${h}:${min.toString().padStart(2, "0")}`,
      density,
      zone: densityZone(density),
    });
  }

  return { rhythm, scatter };
}

function DensityTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: ScatterPoint | RhythmPoint }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const density =
    "density" in row ? row.density : Number(payload[0]?.value ?? 0);
  const zone = densityZone(density);
  const meta = DENSITY_ZONE_META[zone];
  const title =
    "timeLabel" in row ? row.timeLabel : typeof label === "string" ? label : "";

  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-xl min-w-[160px]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-foreground">{title}</p>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-md"
          style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
        >
          {meta.label}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Density</span>
        <span className="text-foreground tabular-nums">
          {formatTooltipNumber(density, 1)}%
        </span>
      </div>
    </div>
  );
}

interface FocusCorrelatorProps {
  inputMinutes?: AppInputMinuteDto[];
}

export function FocusCorrelator({ inputMinutes = [] }: FocusCorrelatorProps) {
  const qualityDay = useQualityDay();
  const [view, setView] = useState<"scatter" | "rhythm">("rhythm");

  const { rhythm, scatter } = useMemo(
    () => buildSeries(inputMinutes, qualityDay),
    [inputMinutes, qualityDay],
  );

  const byZone = useMemo(() => {
    const groups: Record<DensityZone, ScatterPoint[]> = {
      peak: [],
      good: [],
      mixed: [],
      light: [],
    };
    for (const point of scatter) groups[point.zone].push(point);
    return groups;
  }, [scatter]);

  const totalBlocks = scatter.length;
  const avgDensity =
    totalBlocks > 0
      ? scatter.reduce((sum, d) => sum + d.density, 0) / totalBlocks
      : 0;
  const peakBlocks = byZone.peak;
  const avgPeakDensity =
    peakBlocks.length > 0
      ? peakBlocks.reduce((sum, d) => sum + d.density, 0) / peakBlocks.length
      : 0;

  const zoneStats = useMemo(
    () =>
      (["peak", "good", "mixed", "light"] as const).map((zone) => {
        const items = byZone[zone];
        const count = items.length;
        const pct = totalBlocks > 0 ? Math.round((count / totalBlocks) * 100) : 0;
        const avg =
          count > 0
            ? items.reduce((sum, d) => sum + d.density, 0) / count
            : 0;
        const hours = +((count * 15) / 60).toFixed(1);
        return { zone, count, pct, avg, hours };
      }),
    [byZone, totalBlocks],
  );

  const hourly = useMemo(() => {
    const hourMap = new Map<number, { sum: number; n: number }>();
    for (const point of rhythm) {
      const h = Math.floor(point.minute / 60);
      const cur = hourMap.get(h) ?? { sum: 0, n: 0 };
      cur.sum += point.density;
      cur.n += 1;
      hourMap.set(h, cur);
    }
    return [...hourMap.entries()]
      .map(([hour, v]) => ({
        hour,
        label: hourLabel(hour),
        density: v.n === 0 ? 0 : v.sum / v.n,
      }))
      .sort((a, b) => a.hour - b.hour);
  }, [rhythm]);

  const bestHour =
    hourly.length > 0
      ? hourly.reduce((best, h) => (h.density > best.density ? h : best))
      : null;
  const worstHour =
    hourly.length > 0
      ? hourly.reduce((worst, h) => (h.density < worst.density ? h : worst))
      : null;

  const xDomain = useMemo(() => {
    if (rhythm.length === 0) return [0, 1440];
    return [rhythm[0].minute, rhythm[rhythm.length - 1].minute];
  }, [rhythm]);

  const chartRhythm = useMemo(() => {
    const step = 5;
    if (rhythm.length <= step) return rhythm;
    const out: RhythmPoint[] = [];
    for (let i = 0; i < rhythm.length; i += step) {
      let sum = 0;
      let n = 0;
      const end = Math.min(i + step, rhythm.length);
      for (let j = i; j < end; j += 1) {
        sum += rhythm[j].density;
        n += 1;
      }
      out.push({ ...rhythm[i], density: n === 0 ? 0 : sum / n });
    }
    return out;
  }, [rhythm]);

  const scatterXDomain = useMemo(() => {
    if (scatter.length === 0) return [0, 24];
    const min = Math.max(0, scatter[0].hour - 0.5);
    const max = Math.min(24, scatter[scatter.length - 1].hour + 0.5);
    return [min, max];
  }, [scatter]);

  const hasData = rhythm.length > 0;
  const peakMeta = DENSITY_ZONE_META.peak;

  return (
    <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0 mb-4">
        <div>
          <h3 className="text-foreground flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            Hardware & Focus Correlator
          </h3>
          <p className="text-muted-foreground text-xs mt-1">
            Work density from 1-second quality — high activity is high density,
            including below 25%
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {bestHour && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs">
              <Sparkles className="w-3 h-3" />
              Peak: {bestHour.label}
            </div>
          )}
          <div className="flex bg-secondary/60 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setView("scatter")}
              className={`px-2 py-1 rounded-md text-[10px] transition-colors cursor-pointer ${
                view === "scatter"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Blocks
            </button>
            <button
              type="button"
              onClick={() => setView("rhythm")}
              className={`px-2 py-1 rounded-md text-[10px] transition-colors cursor-pointer ${
                view === "rhythm"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Day
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4">
        {zoneStats.map((z) => {
          const Icon = zoneIcons[z.zone];
          const meta = DENSITY_ZONE_META[z.zone];
          return (
            <div
              key={z.zone}
              className="relative rounded-xl border border-border p-3 overflow-hidden"
              style={{
                background: `linear-gradient(135deg, ${meta.color}08 0%, transparent 60%)`,
              }}
            >
              <div
                className="absolute bottom-0 left-0 h-1 rounded-b-xl transition-all duration-500"
                style={{
                  width: `${z.pct}%`,
                  backgroundColor: meta.color,
                  opacity: 0.4,
                }}
              />
              <div className="flex items-center gap-1.5 mb-2">
                <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                <span className="text-xs text-foreground">{meta.label}</span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <span className="text-xl tabular-nums" style={{ color: meta.color }}>
                    {z.pct}%
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-1">
                    ({z.hours}h)
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground">
                    {formatTooltipNumber(z.avg, 0)}%
                    <span className="text-[9px]"> avg</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">{meta.hint}</div>
                </div>
              </div>
              <p className="text-[9px] text-muted-foreground mt-1.5 leading-tight hidden sm:block">
                {zoneDescriptions[z.zone]}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex items-start sm:items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-primary/5 via-chart-2/5 to-chart-4/5 border border-primary/10 mb-4">
        <Brain className="w-5 h-5 text-primary shrink-0 mt-0.5 sm:mt-0" />
        <div className="text-xs text-foreground space-y-1">
          {hasData ? (
            <>
              <p>
                <span className="text-primary">Insight:</span> Peak density is{" "}
                <span className="text-emerald-400">
                  {formatTooltipNumber(avgPeakDensity || Math.max(...scatter.map((d) => d.density), 0), 0)}%
                </span>
                {bestHour ? ` around ${bestHour.label}` : ""}. Day average is{" "}
                <span className="text-chart-2">
                  {formatTooltipNumber(avgDensity, 0)}%
                </span>
                . Every 1-second percent is plotted, including activity below 25%.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                {bestHour && (
                  <span className="flex items-center gap-1 text-[10px]">
                    <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                    <span className="text-muted-foreground">
                      Best hour:{" "}
                      <span className="text-foreground">
                        {bestHour.label} ({formatTooltipNumber(bestHour.density, 0)}%)
                      </span>
                    </span>
                  </span>
                )}
                {worstHour && (
                  <span className="flex items-center gap-1 text-[10px]">
                    <ArrowDownRight className="w-3 h-3 text-red-400" />
                    <span className="text-muted-foreground">
                      Lowest hour:{" "}
                      <span className="text-foreground">
                        {worstHour.label} ({formatTooltipNumber(worstHour.density, 0)}%)
                      </span>
                    </span>
                  </span>
                )}
                <span className="flex items-center gap-1 text-[10px]">
                  <Activity className="w-3 h-3 text-chart-2" />
                  <span className="text-muted-foreground">
                    Sampled:{" "}
                    <span className="text-foreground">
                      {totalBlocks} blocks · {rhythm.length} minutes
                    </span>
                  </span>
                </span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              Collecting input data — the density curve appears as hardware
              activity is recorded.
            </p>
          )}
        </div>
      </div>

      {view === "scatter" ? (
        <div className="h-[220px] sm:h-[300px] min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--grid-stroke)"
              />
              <XAxis
                dataKey="hour"
                type="number"
                domain={scatterXDomain}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--axis-tick)", fontSize: 10 }}
                tickFormatter={(val: number) => `${Math.floor(val)}:00`}
                name="Time"
              />
              <YAxis
                dataKey="density"
                type="number"
                domain={[0, 100]}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--axis-tick)", fontSize: 10 }}
                tickFormatter={(val: number) => `${val}%`}
                name="Density"
                label={{
                  value: "Density",
                  angle: -90,
                  position: "insideLeft",
                  fill: "var(--axis-tick)",
                  fontSize: 10,
                  offset: 10,
                }}
              />
              <Tooltip
                content={<DensityTooltip />}
                cursor={{
                  strokeDasharray: "3 3",
                  stroke: "var(--grid-stroke-strong)",
                }}
              />
              <ReferenceLine
                y={DENSITY_ZONE.peak}
                stroke={peakMeta.color}
                strokeDasharray="5 5"
                strokeOpacity={0.35}
                label={{
                  value: "Peak ▸",
                  fill: peakMeta.color,
                  fontSize: 9,
                  position: "right",
                }}
              />
              <ReferenceLine
                y={DENSITY_ZONE.good}
                stroke={DENSITY_ZONE_META.good.color}
                strokeDasharray="5 5"
                strokeOpacity={0.3}
                label={{
                  value: "Steady ▸",
                  fill: DENSITY_ZONE_META.good.color,
                  fontSize: 9,
                  position: "right",
                }}
              />
              <ReferenceLine
                y={DENSITY_ZONE.mixed}
                stroke={DENSITY_ZONE_META.mixed.color}
                strokeDasharray="5 5"
                strokeOpacity={0.3}
                label={{
                  value: "Light ▸",
                  fill: DENSITY_ZONE_META.mixed.color,
                  fontSize: 9,
                  position: "right",
                }}
              />
              {hasData && (
                <ReferenceLine
                  y={avgDensity}
                  stroke="var(--grid-stroke-strong)"
                  strokeDasharray="5 5"
                  label={{
                    value: `Avg: ${formatTooltipNumber(avgDensity, 0)}%`,
                    fill: "var(--axis-tick)",
                    fontSize: 10,
                    position: "left",
                  }}
                />
              )}
              <ZAxis type="number" dataKey="density" range={[36, 140]} />
              <Scatter data={byZone.light} fill={DENSITY_ZONE_META.light.color} opacity={0.75} name="Low" isAnimationActive={false} />
              <Scatter data={byZone.mixed} fill={DENSITY_ZONE_META.mixed.color} opacity={0.8} name="Light mix" isAnimationActive={false} />
              <Scatter data={byZone.good} fill={DENSITY_ZONE_META.good.color} opacity={0.85} name="Steady" isAnimationActive={false} />
              <Scatter data={byZone.peak} fill={DENSITY_ZONE_META.peak.color} opacity={0.95} name="Peak" isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[220px] sm:h-[300px] min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartRhythm}
              margin={{ top: 10, right: 10, bottom: 10, left: 0 }}
            >
              <defs>
                <linearGradient id="densityDayFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--grid-stroke)"
              />
              <XAxis
                dataKey="minute"
                type="number"
                domain={xDomain}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--axis-tick)", fontSize: 10 }}
                tickFormatter={(val: number) => `${Math.floor(val / 60)}:00`}
              />
              <YAxis
                domain={[0, 100]}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--axis-tick)", fontSize: 10 }}
                tickFormatter={(val: number) => `${val}%`}
                label={{
                  value: "Density",
                  angle: -90,
                  position: "insideLeft",
                  fill: "var(--axis-tick)",
                  fontSize: 10,
                  offset: 10,
                }}
              />
              <Tooltip content={<DensityTooltip />} />
              <ReferenceLine
                y={DENSITY_ZONE.peak}
                stroke={peakMeta.color}
                strokeDasharray="5 5"
                strokeOpacity={0.25}
              />
              <ReferenceLine
                y={DENSITY_ZONE.mixed}
                stroke={DENSITY_ZONE_META.mixed.color}
                strokeDasharray="5 5"
                strokeOpacity={0.25}
              />
              <Area
                type="linear"
                dataKey="density"
                name="Density"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#densityDayFill)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between mt-4 pt-4 border-t border-border gap-3 sm:gap-0">
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          {(["peak", "good", "mixed", "light"] as const).map((zone) => (
            <div key={zone} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: DENSITY_ZONE_META[zone].color }}
              />
              <span className="text-[10px] text-muted-foreground">
                {DENSITY_ZONE_META[zone].label} (
                {zoneStats.find((z) => z.zone === zone)?.pct}%)
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 sm:gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <span className="text-muted-foreground">
              Peak:{" "}
              <span className="text-foreground tabular-nums">
                {formatTooltipNumber(
                  avgPeakDensity || Math.max(0, ...scatter.map((d) => d.density)),
                  0,
                )}
                %
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-chart-2" />
            <span className="text-muted-foreground">
              Avg:{" "}
              <span className="text-foreground tabular-nums">
                {formatTooltipNumber(avgDensity, 0)}%
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
