import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";

interface PremiumDateRangePickerProps {
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
  onStartChange: (val: string) => void;
  onEndChange: (val: string) => void;
  accentColor?: string; // e.g. "#6366f1"
}

interface PresetRange {
  label: string;
  startDate: string;
  endDate: string;
}

function toDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr(): string {
  return toStr(new Date());
}

function addDays(s: string, days: number): string {
  const d = toDate(s);
  d.setDate(d.getDate() + days);
  return toStr(d);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (toDate(b).getTime() - toDate(a).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatDisplay(s: string): string {
  const d = toDate(s);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function buildPresets(): PresetRange[] {
  const today = todayStr();
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return [
    { label: "Today", startDate: today, endDate: today },
    { label: "Last 3 days", startDate: addDays(today, -2), endDate: today },
    { label: "Last 7 days", startDate: addDays(today, -6), endDate: today },
    { label: "Last 14 days", startDate: addDays(today, -13), endDate: today },
    { label: "Last 30 days", startDate: addDays(today, -29), endDate: today },
    { label: "This month", startDate: monthStart, endDate: today },
  ];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function PremiumDateRangePicker({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  accentColor = "#6366f1",
}: PremiumDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = toDate(endDate);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selecting, setSelecting] = useState<"start" | "end" | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, right: 0 });

  const dayCount = daysBetween(startDate, endDate) + 1;
  const today = todayStr();
  const presets = useMemo(() => buildPresets(), [today]);

  // Active preset
  const activePreset = presets.find(
    (p) => p.startDate === startDate && p.endDate === endDate
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(t) &&
        dropdownRef.current && !dropdownRef.current.contains(t)
      ) {
        setOpen(false);
        setSelecting(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setSelecting(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Update dropdown position
  const updateDropdownPos = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 8,
      left: rect.left,
      right: window.innerWidth - rect.right,
    });
  }, []);

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    const onUpdate = () => updateDropdownPos();
    window.addEventListener("scroll", onUpdate, true);
    window.addEventListener("resize", onUpdate);
    return () => {
      window.removeEventListener("scroll", onUpdate, true);
      window.removeEventListener("resize", onUpdate);
    };
  }, [open, updateDropdownPos]);

  // Calendar grid
  const calendarDays = useMemo(() => {
    const { year, month } = viewMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days: { date: string; day: number; isCurrentMonth: boolean; isToday: boolean }[] = [];

    // Previous month trailing days
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date: dateStr, day: d, isCurrentMonth: false, isToday: dateStr === today });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date: dateStr, day: d, isCurrentMonth: true, isToday: dateStr === today });
    }

    // Next month leading days
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date: dateStr, day: d, isCurrentMonth: false, isToday: dateStr === today });
    }

    return days;
  }, [viewMonth, today]);

  const handleDayClick = useCallback(
    (dateStr: string) => {
      if (selecting === "start") {
        if (dateStr >= endDate) {
          onStartChange(dateStr);
          onEndChange(dateStr);
        } else {
          onStartChange(dateStr);
        }
        setSelecting("end");
      } else if (selecting === "end") {
        if (dateStr <= startDate) {
          onStartChange(dateStr);
          onEndChange(dateStr);
          setSelecting("end");
        } else {
          onEndChange(dateStr);
          setSelecting(null);
        }
      } else {
        // First click - start selection
        onStartChange(dateStr);
        onEndChange(dateStr);
        setSelecting("end");
      }
    },
    [selecting, startDate, endDate, onStartChange, onEndChange]
  );

  const handlePreset = (preset: PresetRange) => {
    onStartChange(preset.startDate);
    onEndChange(preset.endDate);
    setSelecting(null);
    // Update view month to show the end date
    const d = toDate(preset.endDate);
    setViewMonth({ year: d.getFullYear(), month: d.getMonth() });
  };

  const isInRange = (dateStr: string) => {
    const effectiveEnd = selecting === "end" && hoverDate ? hoverDate : endDate;
    const effectiveStart = startDate;
    return dateStr >= effectiveStart && dateStr <= effectiveEnd;
  };

  const isRangeStart = (dateStr: string) => dateStr === startDate;
  const isRangeEnd = (dateStr: string) => {
    const effectiveEnd = selecting === "end" && hoverDate ? hoverDate : endDate;
    return dateStr === effectiveEnd;
  };

  const prevMonth = () => {
    setViewMonth((prev) => {
      if (prev.month === 0) return { year: prev.year - 1, month: 11 };
      return { ...prev, month: prev.month - 1 };
    });
  };

  const nextMonth = () => {
    setViewMonth((prev) => {
      if (prev.month === 11) return { year: prev.year + 1, month: 0 };
      return { ...prev, month: prev.month + 1 };
    });
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setSelecting(null);
          if (!open) {
            const d = toDate(endDate);
            setViewMonth({ year: d.getFullYear(), month: d.getMonth() });
            updateDropdownPos();
          }
        }}
        className={`
          group flex items-center gap-2 px-3 py-1.5 rounded-xl cursor-pointer
          transition-all duration-250
          bg-secondary/40 border border-border
          hover:bg-secondary hover:border-primary/20 hover:shadow-[0_0_16px_rgba(99,102,241,0.06)]
          focus:outline-none focus:ring-1 focus:ring-primary/40
          ${open ? "bg-secondary border-primary/30 ring-1 ring-primary/20 shadow-[0_0_20px_rgba(99,102,241,0.1)]" : ""}
        `}
      >
        <CalendarDays
          className={`w-3.5 h-3.5 transition-colors duration-200 ${
            open ? "text-primary" : "text-muted-foreground group-hover:text-primary/70"
          }`}
        />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-foreground tabular-nums">
            {formatDisplay(startDate)}
          </span>
          <span className="text-[10px] text-muted-foreground/60">—</span>
          <span className="text-xs text-foreground tabular-nums">
            {formatDisplay(endDate)}
          </span>
        </div>
        {activePreset && (
          <span className="text-[9px] text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded-md hidden sm:inline">
            {activePreset.label}
          </span>
        )}
        <span className="text-[9px] text-muted-foreground/50 tabular-nums">
          {dayCount}d
        </span>
      </button>

      {/* Dropdown - portaled to body to escape overflow:hidden */}
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, scale: 0.96, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -6 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="fixed z-[9999] bg-popover/95 backdrop-blur-xl border border-border/80 rounded-2xl shadow-[0_12px_48px_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,255,255,0.03)] overflow-hidden"
              style={{
                top: dropdownPos.top,
                left: dropdownPos.left,
              }}
            >
              {/* Top glow */}
              <div
                className="h-px opacity-40"
                style={{
                  background: `linear-gradient(90deg, transparent, ${accentColor}60, transparent)`,
                }}
              />

              <div className="flex flex-col sm:flex-row">
                {/* Presets */}
                <div className="sm:w-[130px] p-2 sm:border-r border-b sm:border-b-0 border-border/60">
                  <div className="flex items-center gap-1.5 px-2 py-1 mb-1">
                    <Sparkles className="w-3 h-3 text-primary/60" />
                    <span className="text-[10px] text-muted-foreground">
                      Quick Select
                    </span>
                  </div>
                  <div className="flex sm:flex-col gap-0.5 overflow-x-auto sm:overflow-x-visible">
                    {presets.map((preset) => {
                      const isActive =
                        preset.startDate === startDate &&
                        preset.endDate === endDate;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => handlePreset(preset)}
                          className={`
                            px-2.5 py-1.5 rounded-lg text-[11px] whitespace-nowrap cursor-pointer
                            transition-all duration-150 text-left
                            ${
                              isActive
                                ? "bg-primary/15 text-primary shadow-[0_0_8px_rgba(99,102,241,0.08)]"
                                : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                            }
                          `}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Calendar */}
                <div className="p-4">
                  {/* Month nav */}
                  <div className="flex items-center justify-between mb-3">
                    <button
                      type="button"
                      onClick={prevMonth}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm text-foreground">
                      {MONTH_NAMES[viewMonth.month]} {viewMonth.year}
                    </span>
                    <button
                      type="button"
                      onClick={nextMonth}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Day headers */}
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {DAY_NAMES.map((d) => (
                      <div
                        key={d}
                        className="w-10 h-8 flex items-center justify-center text-[11px] text-muted-foreground/60"
                      >
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Day grid */}
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map(({ date, day, isCurrentMonth, isToday }) => {
                      const inRange = isInRange(date);
                      const isStart = isRangeStart(date);
                      const isEnd = isRangeEnd(date);
                      const isFuture = date > today;

                      return (
                        <div
                          key={date}
                          className="relative flex items-center justify-center"
                        >
                          {/* Range background stripe */}
                          {inRange && !isStart && !isEnd && (
                            <div
                              className="absolute inset-y-0.5 -inset-x-0.5 opacity-15 rounded-sm"
                              style={{ backgroundColor: accentColor }}
                            />
                          )}
                          {inRange && isStart && !isEnd && (
                            <div
                              className="absolute inset-y-0.5 left-1/2 -right-0.5 opacity-15"
                              style={{ backgroundColor: accentColor }}
                            />
                          )}
                          {inRange && isEnd && !isStart && (
                            <div
                              className="absolute inset-y-0.5 -left-0.5 right-1/2 opacity-15"
                              style={{ backgroundColor: accentColor }}
                            />
                          )}

                          <button
                            type="button"
                            disabled={isFuture}
                            onClick={() => handleDayClick(date)}
                            onMouseEnter={() =>
                              selecting === "end" && setHoverDate(date)
                            }
                            onMouseLeave={() => setHoverDate(null)}
                            className={`
                              relative z-10 w-10 h-10 rounded-lg flex items-center justify-center
                              text-sm tabular-nums cursor-pointer
                              transition-all duration-150
                              ${isFuture ? "opacity-20 cursor-not-allowed!" : ""}
                              ${!isCurrentMonth ? "opacity-30" : ""}
                              ${
                                isStart || isEnd
                                  ? "text-white shadow-[0_0_10px_rgba(99,102,241,0.25)]"
                                  : isToday
                                  ? "text-primary ring-1 ring-primary/30"
                                  : "text-foreground hover:bg-secondary"
                              }
                            `}
                            style={
                              isStart || isEnd
                                ? { backgroundColor: accentColor }
                                : undefined
                            }
                          >
                            {day}
                            {isToday && !isStart && !isEnd && (
                              <div
                                className="absolute bottom-1 w-1 h-1 rounded-full"
                                style={{ backgroundColor: accentColor }}
                              />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Selection hint */}
                  {selecting && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-2 px-2 py-1 rounded-lg bg-primary/5 border border-primary/10 text-center"
                    >
                      <span className="text-[10px] text-primary">
                        {selecting === "start"
                          ? "Click to set start date"
                          : "Click to set end date"}
                      </span>
                    </motion.div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-3 py-2 border-t border-border/60">
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatDisplay(startDate)} — {formatDisplay(endDate)}{" "}
                  <span className="text-muted-foreground/50">
                    ({dayCount} day{dayCount !== 1 ? "s" : ""})
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setSelecting(null);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[10px] hover:bg-primary/20 transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>

              {/* Bottom glow */}
              <div
                className="h-px opacity-20"
                style={{
                  background: `linear-gradient(90deg, transparent, ${accentColor}40, transparent)`,
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}