import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useActivityHeatmap } from "../hooks/useActivityHeatmap";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const getColor = (value: number) => {
  if (value === 0) return "rgba(99, 102, 241, 0.03)";
  if (value < 15) return "rgba(99, 102, 241, 0.1)";
  if (value < 30) return "rgba(99, 102, 241, 0.2)";
  if (value < 50) return "rgba(99, 102, 241, 0.35)";
  if (value < 70) return "rgba(99, 102, 241, 0.55)";
  if (value < 85) return "rgba(99, 102, 241, 0.75)";
  return "rgba(99, 102, 241, 0.95)";
};

function formatSlotLabel(slotIndex: number, slotSeconds: number) {
  const startMin = (slotIndex * slotSeconds) / 60;
  const endMin = startMin + slotSeconds / 60;
  const fmt = (mins: number) => {
    const h = Math.floor(mins / 60) % 24;
    const m = Math.round(mins % 60);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  };
  return `${fmt(startMin)}–${fmt(endMin)}`;
}

function heatmapRowMeta() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Array.from({ length: 8 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + (index - 6));
    return {
      index,
      label: WEEKDAY[date.getDay()],
      isToday: index === 6,
      isTomorrow: index === 7,
    };
  });
}

type HoveredCell = {
  dayIndex: number;
  slotIndex: number;
  value: number;
  label: string;
};

export function ActivityHeatmap() {
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);
  const hoverTargetRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const { grid, slotSeconds, isLoading, error } = useActivityHeatmap();

  const heatmapData = grid ?? [];
  const columns = heatmapData[0]?.length || 24;
  const slotSecs = slotSeconds || Math.round((24 * 3600) / columns);
  const rows = useMemo(() => heatmapRowMeta(), []);

  const hourLabels = useMemo(() => {
    const hoursPerSlot = Math.max(1, slotSecs / 3600);
    const labels: { hour: number; colSpan: number }[] = [];
    for (let hour = 0; hour < 24; hour += 3) {
      labels.push({ hour, colSpan: Math.max(1, Math.round(3 / hoursPerSlot)) });
    }
    return labels;
  }, [slotSecs]);

  const updateTooltipPosition = useCallback(() => {
    const el = hoverTargetRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTooltipPos({
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);

  useEffect(() => {
    if (!hoveredCell) {
      hoverTargetRef.current = null;
      return;
    }
    updateTooltipPosition();
    const onScrollOrResize = () => updateTooltipPosition();
    const scrollEl = scrollContainerRef.current;
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    scrollEl?.addEventListener("scroll", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      scrollEl?.removeEventListener("scroll", onScrollOrResize);
    };
  }, [hoveredCell, updateTooltipPosition]);

  const tooltipPortal =
    hoveredCell &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        className="pointer-events-none fixed z-[9999] rounded-lg border border-border bg-card px-2 py-1.5 shadow-xl whitespace-nowrap"
        style={{
          left: tooltipPos.x,
          top: tooltipPos.y,
          transform: "translate(-50%, calc(-100% - 8px))",
        }}
        role="tooltip"
      >
        <p className="text-xs text-foreground">
          {hoveredCell.label} {formatSlotLabel(hoveredCell.slotIndex, slotSecs)}
        </p>
        <p className="text-xs text-muted-foreground">
          High-quality seconds: {hoveredCell.value}%
        </p>
      </div>,
      document.body,
    );

  const gridCols = {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
  };

  return (
    <div className="bg-card rounded-2xl border border-border p-4 sm:p-6">
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-foreground">Activity Heatmap</h3>
          <p className="text-muted-foreground text-xs mt-1">
            Last 7 days plus tomorrow: % of seconds at or above 25% work quality
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Less</span>
          {[0.05, 0.15, 0.3, 0.5, 0.7, 0.9].map((opacity, i) => (
            <div
              key={i}
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: `rgba(99, 102, 241, ${opacity})` }}
            />
          ))}
          <span>More</span>
        </div>
      </div>

      <div ref={scrollContainerRef} className="overflow-x-auto overflow-y-visible">
        {isLoading && heatmapData.length === 0 ? (
          <div className="min-h-[200px] flex items-center justify-center text-muted-foreground text-sm">
            Loading heatmap…
          </div>
        ) : (
          <div className="w-full">
            <div className="flex mb-1.5">
              <span className="w-11 shrink-0" />
              <div className="grid flex-1 min-w-0 gap-1" style={gridCols}>
                {hourLabels.map(({ hour, colSpan }) => (
                  <div
                    key={hour}
                    className="text-[10px] text-muted-foreground leading-none"
                    style={{ gridColumn: `span ${colSpan}` }}
                  >
                    {hour.toString().padStart(2, "0")}:00
                  </div>
                ))}
              </div>
            </div>

            {rows.map((row) => (
              <div key={row.index} className="flex items-center gap-1.5 mb-1">
                <span
                  className={`w-11 shrink-0 text-[11px] leading-none ${
                    row.isToday
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  {row.label}
                  {row.isToday ? (
                    <span className="block text-[9px] text-primary">today</span>
                  ) : row.isTomorrow ? (
                    <span className="block text-[9px] text-muted-foreground/70">
                      tomorrow
                    </span>
                  ) : null}
                </span>
                <div className="grid flex-1 min-w-0 gap-1" style={gridCols}>
                  {Array.from({ length: columns }, (_, slotIndex) => {
                    const value = row.isTomorrow
                      ? 0
                      : (heatmapData[row.index]?.[slotIndex] ?? 0);
                    const isHovered =
                      hoveredCell?.dayIndex === row.index &&
                      hoveredCell?.slotIndex === slotIndex;
                    return (
                      <div
                        key={slotIndex}
                        className="aspect-square w-full rounded-sm cursor-pointer transition-colors duration-150"
                        style={{
                          backgroundColor: getColor(value),
                          outline: isHovered
                            ? "2px solid rgba(99, 102, 241, 0.7)"
                            : "none",
                          outlineOffset: 1,
                          zIndex: isHovered ? 10 : 0,
                          opacity: row.isTomorrow ? 0.35 : 1,
                        }}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          hoverTargetRef.current = e.currentTarget;
                          setTooltipPos({
                            x: rect.left + rect.width / 2,
                            y: rect.top,
                          });
                          setHoveredCell({
                            dayIndex: row.index,
                            slotIndex,
                            value,
                            label: row.isTomorrow
                              ? `${row.label} (tomorrow)`
                              : row.isToday
                                ? `${row.label} (today)`
                                : row.label,
                          });
                        }}
                        onMouseLeave={() => {
                          hoverTargetRef.current = null;
                          setHoveredCell(null);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {tooltipPortal}
    </div>
  );
}
