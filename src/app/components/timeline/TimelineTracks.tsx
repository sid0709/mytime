import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import {
  type TimelineBlock,
  type APMDataPoint,
  type TimelineMarker,
  type ActivityStatus,
  formatMinutes,
  formatDuration,
} from "./timeline-data";
import { AppIcon } from "./AppIcon";
import { STANDARD_APM_MAX } from "../../constants/apm";

interface TimelineTracksProps {
  blocks: TimelineBlock[];
  apmData: APMDataPoint[];
  markers: TimelineMarker[];
  activityStatus: ActivityStatus[];
  zoom: number;
  onZoomChange: (zoom: number) => void;
  visibleTracks: Record<"status" | "windows" | "apm", boolean>;
  onSelectBlock: (block: TimelineBlock) => void;
  selectedBlockIds: Set<string>;
}

// Time constants — full 24h so no activity is clipped
const DAY_START = 0;
const DAY_END = 24 * 60;
const TOTAL_MINUTES = DAY_END - DAY_START;

const STATUS_COLORS: Record<string, string> = {
  active: "#22c55e",
  inactive: "#ef4444",
  shutdown: "#3a3a4a",
};

function HoverTooltip({ block, x, y }: { block: TimelineBlock; x: number; y: number }) {
  const duration = block.endMin - block.startMin;
  return (
    <div
      className="fixed z-[100] pointer-events-none"
      style={{ left: x, top: y - 10, transform: "translate(-50%, -100%)" }}
    >
      <div className="bg-popover border border-border rounded-xl p-4 shadow-2xl shadow-black/40 min-w-[280px]">
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
          <AppIcon
            iconDataUrl={block.iconDataUrl}
            fallback={block.icon}
            size={18}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground truncate">{block.app}</p>
            <p className="text-[10px] text-muted-foreground truncate">{block.title}</p>
          </div>
          <div
            className="px-2 py-0.5 rounded text-[10px]"
            style={{ backgroundColor: `${block.color}20`, color: block.color }}
          >
            {block.category}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <p className="text-[10px] text-muted-foreground">Start</p>
            <p className="text-xs text-foreground tabular-nums">{formatMinutes(block.startMin)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">End</p>
            <p className="text-xs text-foreground tabular-nums">{formatMinutes(block.endMin)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Duration</p>
            <p className="text-xs text-foreground">{formatDuration(duration)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-secondary/50 rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground">Keystrokes</p>
            <p className="text-sm text-foreground tabular-nums">{block.keystrokes.toLocaleString()}</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground">Mouse Clicks</p>
            <p className="text-sm text-foreground tabular-nums">{block.clicks.toLocaleString()}</p>
          </div>
        </div>
        {block.tag && (
          <div className="mt-2 pt-2 border-t border-border">
            <span className="text-[10px] text-primary">Tagged: {block.tag}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function TimelineTracks({
  blocks,
  apmData,
  markers,
  activityStatus,
  zoom,
  onZoomChange,
  visibleTracks,
  onSelectBlock,
  selectedBlockIds,
}: TimelineTracksProps) {
  const [hoveredBlock, setHoveredBlock] = useState<TimelineBlock | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [hoveredMarker, setHoveredMarker] = useState<TimelineMarker | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setNowMin(now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60);
    };
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Viewport window state (in minutes)
  const viewSpanMinutes = TOTAL_MINUTES / zoom;
  const [viewStart, setViewStart] = useState(() => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const span = TOTAL_MINUTES / 1.5; // initial zoom
    return Math.max(DAY_START, Math.min(nowMin - span / 2, DAY_END - span));
  });
  const viewEnd = Math.min(viewStart + viewSpanMinutes, DAY_END);

  // Clamp viewStart when zoom changes
  useEffect(() => {
    setViewStart((prev) => {
      const maxStart = DAY_END - viewSpanMinutes;
      return Math.max(DAY_START, Math.min(prev, maxStart));
    });
  }, [viewSpanMinutes]);

  // Container width for rendering (min 400 so timebar/tracks always have room)
  const [containerWidth, setContainerWidth] = useState(900);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setContainerWidth(w > 0 ? w : 900);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const pxPerMin = containerWidth / viewSpanMinutes;

  const getX = useCallback(
    (min: number) => (min - viewStart) * pxPerMin,
    [viewStart, pxPerMin]
  );

  const getWidth = useCallback(
    (startMin: number, endMin: number) => (endMin - startMin) * pxPerMin,
    [pxPerMin]
  );

  // Time ruler ticks within viewport
  const hourMarks = useMemo(() => {
    const marks: { hour: number; x: number; label: string; minor?: boolean }[] = [];
    // Determine appropriate interval
    let interval = 60; // 1 hour
    if (zoom >= 2) interval = 30;
    if (zoom >= 3) interval = 15;
    if (zoom >= 8) interval = 5;
    if (zoom >= 24) interval = 1;

    const startH = Math.floor(viewStart / interval) * interval;
    for (let m = startH; m <= viewEnd + interval; m += interval) {
      if (m < DAY_START || m > DAY_END) continue;
      const h = Math.floor(m / 60);
      const min = m % 60;
      const isHour = min === 0;
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const label = isHour
        ? `${h12}${ampm}`
        : `${h12}:${min.toString().padStart(2, "0")}`;
      marks.push({
        hour: m / 60,
        x: getX(m),
        label,
        minor: !isHour,
      });
    }
    return marks;
  }, [getX, zoom, viewStart, viewEnd]);

  const handleBlockClick = (block: TimelineBlock) => {
    onSelectBlock(block);
  };

  const handleMouseMove = (block: TimelineBlock, e: React.MouseEvent) => {
    setHoveredBlock(block);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };

  // Single-color input activity strip: brighter/taller bars mean more activity.
  const getAPMColor = (apm: number) => {
    if (apm >= 188) return "#6366f1";
    if (apm >= 100) return "#818cf8";
    if (apm >= 38) return "#a5b4fc";
    return "#c7d2fe";
  };

  // ─── Minimap Navigator ───
  const minimapRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragEdge, setDragEdge] = useState<"left" | "right" | "body" | null>(null);
  const dragStartRef = useRef({ x: 0, viewStart: DAY_START, viewEnd: DAY_END });

  const minimapWidth = containerWidth;
  const minimapPxPerMin = minimapWidth / TOTAL_MINUTES;
  const windowLeft = (viewStart - DAY_START) * minimapPxPerMin;
  const windowWidth = viewSpanMinutes * minimapPxPerMin;

  const handleMinimapMouseDown = (e: React.MouseEvent, edge: "left" | "right" | "body") => {
    e.preventDefault();
    setIsDragging(true);
    setDragEdge(edge);
    dragStartRef.current = {
      x: e.clientX,
      viewStart,
      viewEnd: viewStart + viewSpanMinutes,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dMin = dx / minimapPxPerMin;

      if (dragEdge === "body") {
        let newStart = dragStartRef.current.viewStart + dMin;
        const maxStart = DAY_END - viewSpanMinutes;
        newStart = Math.max(DAY_START, Math.min(newStart, maxStart));
        setViewStart(newStart);
      }
      // Edge dragging could resize the window — but since zoom controls the span,
      // we keep it as body-only drag for simplicity
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragEdge(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragEdge, minimapPxPerMin, viewSpanMinutes]);

  // Click on minimap to jump
  const handleMinimapClick = (e: React.MouseEvent) => {
    if (isDragging) return;
    const rect = minimapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = e.clientX - rect.left;
    const clickMin = DAY_START + (clickX / minimapWidth) * TOTAL_MINUTES;
    let newStart = clickMin - viewSpanMinutes / 2;
    newStart = Math.max(DAY_START, Math.min(newStart, DAY_END - viewSpanMinutes));
    setViewStart(newStart);
  };

  // ─── Scroll-wheel zoom (zooms toward cursor position) ───
  // Use native wheel listener with { passive: false } to fully block page scroll
  const tracksAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = tracksAreaRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const cursorX = e.clientX - rect.left;
      const cursorFraction = cursorX / containerWidth;
      const cursorMin = viewStart + cursorFraction * (TOTAL_MINUTES / zoom);

      // Zoom step: scroll up = zoom in, scroll down = zoom out
      const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      // Min zoom 1.0 = full day; max 64x ≈ 22.5 minutes in view.
      const newZoom = Math.max(1, Math.min(64, zoom * zoomFactor));
      const newSpan = TOTAL_MINUTES / newZoom;

      let newStart = cursorMin - cursorFraction * newSpan;
      newStart = Math.max(DAY_START, Math.min(newStart, DAY_END - newSpan));

      onZoomChange(newZoom);
      setViewStart(newStart);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, viewStart, containerWidth, onZoomChange]);

  return (
    <div
      className="bg-card rounded-xl border border-border overflow-hidden min-w-0 w-full"
      ref={containerRef}
    >
      {/* Time Ruler + Tracks */}
      <div className="overflow-hidden min-h-[200px]" ref={tracksAreaRef}>
        <div className="relative" style={{ width: containerWidth }}>
          {/* Ruler */}
          <div className="h-7 relative bg-secondary/30 border-b border-border">
            {hourMarks.map((mark) => (
              <div
                key={`ruler-${mark.hour}`}
                className="absolute top-0 h-full flex flex-col items-center"
                style={{ left: mark.x }}
              >
                <div
                  className={`w-px h-full ${
                    mark.minor ? "bg-white/5" : "bg-white/10"
                  }`}
                />
                <span
                  className={`absolute bottom-1 text-muted-foreground whitespace-nowrap ${
                    mark.minor ? "text-[8px]" : "text-[10px]"
                  }`}
                  style={{ transform: "translateX(-50%)" }}
                >
                  {mark.label}
                </span>
              </div>
            ))}
          </div>

          {/* Current-time needle */}
          {(() => {
            const nowX = getX(nowMin);
            if (nowX < -8 || nowX > containerWidth + 8) return null;
            return (
              <div
                className="absolute top-0 z-[25] pointer-events-none"
                style={{ left: nowX, height: "100%" }}
              >
                <div
                  className="w-px absolute top-0 bottom-0"
                  style={{ backgroundColor: "#38bdf8", opacity: 0.9 }}
                />
                <div
                  className="absolute top-0 -translate-x-1/2 z-30"
                  style={{ left: 0 }}
                >
                  <div
                    className="px-1 h-3.5 rounded-b-sm flex items-center justify-center text-[8px] font-semibold uppercase tracking-wide text-sky-950"
                    style={{ backgroundColor: "#38bdf8" }}
                  >
                    now
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Event Markers */}
          {markers.map((marker) => {
            const markerX = getX(marker.minute);
            if (markerX < -20 || markerX > containerWidth + 20) return null;
            const markerColor = "#eab308";
            const MarkerIcon = AlertTriangle;
            return (
              <div
                key={marker.id}
                className="absolute top-0 z-20"
                style={{ left: markerX, height: "100%" }}
                onMouseEnter={() => setHoveredMarker(marker)}
                onMouseLeave={() => setHoveredMarker(null)}
              >
                <div
                  className="w-px absolute top-0 bottom-0"
                  style={{ backgroundColor: markerColor, opacity: 0.4 }}
                />
                <div className="absolute -top-0 -translate-x-1/2 z-30 cursor-pointer" style={{ left: 0 }}>
                  <div
                    className="w-5 h-5 rounded-b-md flex items-center justify-center"
                    style={{ backgroundColor: markerColor }}
                  >
                    <MarkerIcon className="w-3 h-3 text-white" />
                  </div>
                </div>
                {hoveredMarker?.id === marker.id && (
                  <div
                    className="absolute top-6 -translate-x-1/2 z-40 bg-popover border border-border rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
                    style={{ left: 0 }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <MarkerIcon className="w-3 h-3" style={{ color: markerColor }} />
                      <span className="text-xs capitalize" style={{ color: markerColor }}>
                        {marker.type.replace("-", " ")}
                      </span>
                    </div>
                    <p className="text-[10px] text-foreground">{marker.label}</p>
                    <p className="text-[10px] text-muted-foreground">at {formatMinutes(marker.minute)}</p>
                  </div>
                )}
              </div>
            );
          })}

          {/* ====== TRACK 0: Activity Status ====== */}
          {visibleTracks.status && (
            <div className="relative h-6 border-b border-border">
              <div className="absolute left-0 top-0 h-full w-full">
                {activityStatus.map((seg, i) => {
                  const x = getX(seg.startMin);
                  const w = getWidth(seg.startMin, seg.endMin);
                  if (x + w < 0 || x > containerWidth) return null;
                  return (
                    <div
                      key={`status-${i}`}
                      className="absolute top-1"
                      style={{
                        left: x,
                        width: Math.max(w, 1),
                        height: "16px",
                        backgroundColor: STATUS_COLORS[seg.status],
                        opacity: seg.status === "shutdown" ? 0.5 : 0.7,
                        borderRadius: 1,
                      }}
                      title={`${seg.status.charAt(0).toUpperCase() + seg.status.slice(1)}: ${formatMinutes(seg.startMin)} – ${formatMinutes(seg.endMin)}`}
                    />
                  );
                })}
              </div>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground/50 pointer-events-none">
                STATUS
              </div>
              <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-3 text-[8px] text-muted-foreground/60 pointer-events-none">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-1.5 rounded-sm" style={{ backgroundColor: STATUS_COLORS.active }} />
                  Active
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-1.5 rounded-sm" style={{ backgroundColor: STATUS_COLORS.inactive }} />
                  Inactive
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-1.5 rounded-sm" style={{ backgroundColor: STATUS_COLORS.shutdown }} />
                  Shutdown
                </div>
              </div>
            </div>
          )}

          {/* ====== TRACK 1: Active Window Blocks ====== */}
          {visibleTracks.windows && (
            <div className="relative h-10 border-b border-border">
              <div className="absolute left-0 top-0 h-full w-full">
                {blocks.map((block) => {
                  const isSelected = selectedBlockIds.has(block.id);
                  const x = getX(block.startMin);
                  const w = getWidth(block.startMin, block.endMin);
                  if (x + w < 0 || x > containerWidth) return null;
                  return (
                    <div
                      key={block.id}
                      className={`absolute top-1 rounded-sm transition-all duration-150 ${
                        isSelected
                          ? "ring-2 ring-primary ring-offset-1 ring-offset-card"
                          : ""
                      }`}
                      style={{
                        left: x,
                        width: w,
                        height: "32px",
                        backgroundColor: block.color,
                        opacity: isSelected ? 1 : 0.75,
                        cursor: "pointer",
                      }}
                      onClick={() => handleBlockClick(block)}
                      onMouseMove={(e) => handleMouseMove(block, e)}
                      onMouseLeave={() => setHoveredBlock(null)}
                    >
                      {w > 50 && (
                        <div className="px-1.5 py-0.5 flex items-center gap-1 h-full overflow-hidden">
                          <AppIcon
                            iconDataUrl={block.iconDataUrl}
                            fallback={block.icon}
                            size={12}
                          />
                          <span className="text-[9px] text-white/90 truncate">{block.app}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground/50 pointer-events-none">
                WINDOWS
              </div>
            </div>
          )}

          {/* ====== TRACK 2: Input intensity (per-minute volume) ====== */}
          {visibleTracks.apm && (
            <div className="relative h-7 border-b border-border">
              <div className="absolute inset-0 flex items-end">
                {apmData
                  .filter((d) => d.minute >= Math.floor(viewStart) - 1 && d.minute <= Math.ceil(viewEnd) + 1)
                  .map((d) => {
                    const x = getX(d.minute);
                    const w = Math.max(pxPerMin, 1);
                    const h = Math.max((d.apm / STANDARD_APM_MAX) * 24, 1);
                    return (
                      <div
                        key={`apm-${d.minute}`}
                        className="absolute bottom-0"
                        title={
                          d.volume != null
                            ? `volume ${d.volume} · effective ${Math.round(d.apm)}`
                            : undefined
                        }
                        style={{
                          left: x,
                          width: w,
                          height: h,
                          backgroundColor: getAPMColor(d.apm),
                          opacity: 0.5 + (d.apm / STANDARD_APM_MAX) * 0.5,
                        }}
                      />
                    );
                  })}
              </div>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground/50 pointer-events-none">
                INPUT
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Minimap Navigator ─── */}
      <div className="border-t border-border bg-secondary/20 px-0">
        {/* Time labels */}
        <div className="relative h-4">
          {Array.from({ length: 9 }, (_, i) => {
            const h = i * 3;
            const x = ((h * 60 - DAY_START) / TOTAL_MINUTES) * minimapWidth;
            const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
            const ampm = h >= 12 ? "PM" : "AM";
            return (
              <span
                key={`mm-label-${h}`}
                className="absolute top-0.5 text-[8px] text-muted-foreground/50 tabular-nums"
                style={{ left: x, transform: "translateX(-50%)" }}
              >
                {h12}{ampm}
              </span>
            );
          })}
        </div>

        {/* Minimap bar with blocks + draggable window */}
        <div
          ref={minimapRef}
          className="relative h-7 cursor-pointer"
          onClick={handleMinimapClick}
        >
          {/* Mini activity status */}
          {activityStatus.map((seg, i) => {
            const x = ((seg.startMin - DAY_START) / TOTAL_MINUTES) * minimapWidth;
            const w = ((seg.endMin - seg.startMin) / TOTAL_MINUTES) * minimapWidth;
            return (
              <div
                key={`mm-status-${i}`}
                className="absolute top-0 rounded-[1px]"
                style={{
                  left: x,
                  width: w,
                  height: "4px",
                  backgroundColor: STATUS_COLORS[seg.status],
                  opacity: 0.6,
                }}
              />
            );
          })}

          {/* Current-time needle */}
          <div
            className="absolute top-0 bottom-0 w-px pointer-events-none z-[5]"
            style={{
              left: ((nowMin - DAY_START) / TOTAL_MINUTES) * minimapWidth,
              backgroundColor: "#38bdf8",
            }}
          />

          {/* Mini app blocks */}
          {blocks.map((block) => {
            const x = ((block.startMin - DAY_START) / TOTAL_MINUTES) * minimapWidth;
            const w = Math.max(((block.endMin - block.startMin) / TOTAL_MINUTES) * minimapWidth, 1);
            return (
              <div
                key={`mm-${block.id}`}
                className="absolute rounded-[1px]"
                style={{
                  left: x,
                  width: w,
                  top: "6px",
                  height: "10px",
                  backgroundColor: block.color,
                  opacity: 0.5,
                }}
              />
            );
          })}

          {/* Dimmed overlay outside the viewing window */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-black/40 pointer-events-none"
            style={{ width: windowLeft }}
          />
          <div
            className="absolute top-0 bottom-0 bg-black/40 pointer-events-none"
            style={{ left: windowLeft + windowWidth, right: 0 }}
          />

          {/* Draggable viewing window */}
          <div
            className="absolute top-0 bottom-0 border border-primary/60 rounded-sm bg-primary/5"
            style={{
              left: windowLeft,
              width: windowWidth,
              cursor: isDragging ? "grabbing" : "grab",
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              handleMinimapMouseDown(e, "body");
            }}
          >
            {/* Left edge handle */}
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/40 rounded-l-sm" />
            {/* Right edge handle */}
            <div className="absolute right-0 top-0 bottom-0 w-1 bg-primary/40 rounded-r-sm" />
            {/* Center grip dots */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-0.5 pointer-events-none">
              <div className="w-0.5 h-2 bg-primary/50 rounded-full" />
              <div className="w-0.5 h-2 bg-primary/50 rounded-full" />
              <div className="w-0.5 h-2 bg-primary/50 rounded-full" />
            </div>
          </div>

          {/* Viewing range labels */}
          <div className="absolute -bottom-3.5 flex justify-between w-full pointer-events-none px-0.5">
            <span className="text-[9px] text-primary/70 tabular-nums">
              {formatMinutes(Math.round(viewStart))}
            </span>
            <span className="text-[9px] text-primary/70 tabular-nums">
              {formatMinutes(Math.round(viewEnd))}
            </span>
          </div>
        </div>

        <div className="h-4" /> {/* spacer for range labels */}
      </div>

      {/* Hover Tooltip */}
      {hoveredBlock && (
        <HoverTooltip block={hoveredBlock} x={tooltipPos.x} y={tooltipPos.y} />
      )}
    </div>
  );
}
