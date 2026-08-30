import { useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { PremiumDateRangePicker } from "./ui/PremiumDateRangePicker";
import { useActivityTimeline } from "../hooks/useActivityTimeline";
import { formatTooltipNumber } from "../utils/formatTooltipValue";

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const CustomTooltip = ({
  active,
  payload,
  label,
  isHourly,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  isHourly: boolean;
}) => {
  if (active && payload && payload.length) {
    const activeVal = payload.find((p: any) => p.dataKey === "active")?.value ?? 0;
    const inactiveVal = payload.find((p: any) => p.dataKey === "inactive")?.value ?? 0;
    const total = Number(activeVal) + Number(inactiveVal);
    const pct = total > 0 ? Math.round((Number(activeVal) / total) * 100) : 0;
    const activeStr = formatTooltipNumber(activeVal, 2);
    const inactiveStr = formatTooltipNumber(inactiveVal, 2);

    return (
      <div className="bg-card border border-border rounded-xl p-3 shadow-xl min-w-[160px]">
        <p className="text-xs text-muted-foreground mb-2">{payload[0]?.payload?.fullDate || label}</p>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-muted-foreground">Active</span>
            </div>
            <span className="text-foreground tabular-nums">
              {isHourly ? `${activeStr}m` : `${activeStr}h`}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-400/60" />
              <span className="text-muted-foreground">Inactive</span>
            </div>
            <span className="text-foreground tabular-nums">
              {isHourly ? `${inactiveStr}m` : `${inactiveStr}h`}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
            <span className="text-muted-foreground">Activity Rate</span>
            <span className="text-emerald-400 tabular-nums">{pct}%</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

interface ActivityTimelineProps {
  initialRange?: "today" | "last7days";
}

export function ActivityTimeline({
  initialRange = "last7days",
}: ActivityTimelineProps) {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const [startDate, setStartDate] = useState(
    initialRange === "today" ? formatDate(today) : formatDate(weekAgo),
  );
  const [endDate, setEndDate] = useState(formatDate(today));

  const handleStartChange = useCallback((val: string) => {
    setStartDate(val);
  }, []);

  const handleEndChange = useCallback((val: string) => {
    setEndDate(val);
  }, []);

  const {
    data,
    isHourly,
    maxValue: maxVal,
    yLabel,
    avgActive,
    isLoading,
    error,
  } = useActivityTimeline(startDate, endDate);

  return (
    <div className="bg-card rounded-2xl border border-border p-4 sm:p-6">
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0 mb-5">
        <div>
          <h3 className="text-foreground">Activity Timeline</h3>
          <p className="text-muted-foreground text-xs mt-1">
            Active vs. inactive time — {isHourly ? "per hour (minutes)" : "24h per day"}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-muted-foreground">Active</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400/60" />
            <span className="text-xs text-muted-foreground">Inactive</span>
          </div>
        </div>
      </div>

      {/* Date Range Picker */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
        <PremiumDateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartChange={handleStartChange}
          onEndChange={handleEndChange}
        />
      </div>

      <div className="h-[160px] sm:h-[180px] min-w-0 overflow-visible [&_.recharts-wrapper]:overflow-visible">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={isLoading ? [] : data}
            stackOffset="none"
            margin={{ top: 28, right: 6, left: 4, bottom: 4 }}
          >
            <CartesianGrid
              key="at-grid"
              strokeDasharray="3 3"
              stroke="var(--grid-stroke)"
              vertical={false}
            />
            <XAxis
              key="at-xaxis"
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--axis-tick)", fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis
              key="at-yaxis"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--axis-tick)", fontSize: 10 }}
              domain={[0, maxVal]}
              label={{
                value: yLabel,
                angle: -90,
                position: "insideLeft",
                fill: "var(--axis-tick)",
                fontSize: 10,
                offset: 10,
              }}
            />
            <Tooltip
              content={<CustomTooltip isHourly={isHourly} />}
              key="at-tooltip"
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ zIndex: 50, outline: "none" }}
            />
            <ReferenceLine
              key="at-avg"
              y={avgActive}
              stroke="var(--grid-stroke-strong)"
              strokeDasharray="5 5"
              label={{
                value: `Avg: ${formatTooltipNumber(avgActive, 2)}${isHourly ? "m" : "h"}`,
                fill: "var(--axis-tick)",
                fontSize: 10,
                position: "left",
              }}
            />
            <Bar
              key="bar-active"
              dataKey="active"
              stackId="time"
              radius={[0, 0, 0, 0]}
              name="Active"
            >
              {data.map((d, i) => {
                const pct = d.active / maxVal;
                const color =
                  pct > 0.6
                    ? "#34d399"
                    : pct > 0.35
                    ? "#6366f1"
                    : pct > 0.15
                    ? "#eab308"
                    : "#ef4444";
                return <Cell key={i} fill={color} fillOpacity={0.75} />;
              })}
            </Bar>
            <Bar
              key="bar-inactive"
              dataKey="inactive"
              stackId="time"
              fill="#ef4444"
              fillOpacity={0.12}
              radius={[3, 3, 0, 0]}
              name="Inactive"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
