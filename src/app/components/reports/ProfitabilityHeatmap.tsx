import { useState, useMemo } from "react";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  Edit3,
  Check,
  X,
} from "lucide-react";

interface ProjectRate {
  id: string;
  tag: string;
  color: string;
  hourlyRate: number;
  totalHours: number;
}

interface DayRevenue {
  date: string;
  day: number;
  month: number;
  dow: number;
  revenue: number;
  billedHours: number;
  unbilledHours: number;
  breakdown: { tag: string; hours: number; revenue: number; color: string }[];
}

const DEFAULT_RATES: ProjectRate[] = [
  { id: "r1", tag: "Design Work", color: "#a259ff", hourlyRate: 100, totalHours: 0 },
  { id: "r2", tag: "Development", color: "#007acc", hourlyRate: 125, totalHours: 0 },
  { id: "r3", tag: "Client Meetings", color: "#2d8cff", hourlyRate: 80, totalHours: 0 },
  { id: "r4", tag: "Research", color: "#22d3ee", hourlyRate: 75, totalHours: 0 },
  { id: "r5", tag: "Admin / Untagged", color: "#3a3a4a", hourlyRate: 0, totalHours: 0 },
];

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function generateRevenueData(rates: ProjectRate[]): DayRevenue[] {
  const data: DayRevenue[] = [];
  const today = new Date(2026, 2, 9);

  for (let i = -27; i <= 0; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    const breakdown: DayRevenue["breakdown"] = [];
    let totalBilled = 0;
    let totalUnbilled = 0;
    let totalRevenue = 0;

    rates.forEach((rate) => {
      let hours = 0;
      if (rate.tag === "Admin / Untagged") {
        hours = isWeekend ? 0.5 + Math.random() : 0.5 + Math.random() * 1.5;
      } else if (rate.tag === "Design Work") {
        hours = isWeekend ? Math.random() * 1 : 1 + Math.random() * 3;
      } else if (rate.tag === "Development") {
        hours = isWeekend ? Math.random() * 2 : 2 + Math.random() * 4;
      } else if (rate.tag === "Client Meetings") {
        hours = isWeekend ? 0 : Math.random() > 0.4 ? 0.5 + Math.random() * 1.5 : 0;
      } else {
        hours = isWeekend ? Math.random() * 0.5 : 0.3 + Math.random() * 1;
      }

      hours = Math.round(hours * 4) / 4; // Round to nearest 15min
      const rev = hours * rate.hourlyRate;

      if (rate.hourlyRate > 0) {
        totalBilled += hours;
      } else {
        totalUnbilled += hours;
      }
      totalRevenue += rev;

      breakdown.push({ tag: rate.tag, hours, revenue: rev, color: rate.color });
    });

    data.push({
      date: d.toISOString().split("T")[0],
      day: d.getDate(),
      month: d.getMonth(),
      dow: d.getDay(),
      revenue: Math.round(totalRevenue),
      billedHours: Math.round(totalBilled * 100) / 100,
      unbilledHours: Math.round(totalUnbilled * 100) / 100,
      breakdown,
    });
  }
  return data;
}

export function ProfitabilityHeatmap() {
  const [rates, setRates] = useState<ProjectRate[]>(DEFAULT_RATES);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [hoveredDay, setHoveredDay] = useState<DayRevenue | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const data = useMemo(() => generateRevenueData(rates), [rates]);

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);
  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);
  const totalUnbilledHours = data.reduce((s, d) => s + d.unbilledHours, 0);
  const avgDailyRevenue = Math.round(totalRevenue / data.length);
  const avgBillableRate = rates.filter((r) => r.hourlyRate > 0);
  const avgRate = avgBillableRate.length > 0
    ? Math.round(avgBillableRate.reduce((s, r) => s + r.hourlyRate, 0) / avgBillableRate.length)
    : 0;
  const unbilledCost = Math.round(totalUnbilledHours * avgRate);

  const getIntensityColor = (revenue: number) => {
    if (revenue <= 0) return "rgba(52, 211, 153, 0.04)";
    const ratio = revenue / maxRevenue;
    if (ratio > 0.8) return "rgba(52, 211, 153, 0.85)";
    if (ratio > 0.6) return "rgba(52, 211, 153, 0.6)";
    if (ratio > 0.4) return "rgba(52, 211, 153, 0.4)";
    if (ratio > 0.2) return "rgba(52, 211, 153, 0.2)";
    return "rgba(52, 211, 153, 0.1)";
  };

  // Organize into weeks
  const weeks: (DayRevenue | null)[][] = [];
  let currentWeek: (DayRevenue | null)[] = [];
  if (data.length > 0) {
    for (let i = 0; i < data[0].dow; i++) currentWeek.push(null);
  }
  data.forEach((d) => {
    currentWeek.push(d);
    if (d.dow === 6) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  });
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  const startEditing = (rate: ProjectRate) => {
    setEditingId(rate.id);
    setEditValue(rate.hourlyRate.toString());
  };

  const saveEdit = (id: string) => {
    setRates((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, hourlyRate: Math.max(0, parseInt(editValue) || 0) } : r
      )
    );
    setEditingId(null);
  };

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-chart-4" />
            Profitability Heatmap
          </h3>
          <p className="text-muted-foreground text-xs mt-1">
            Revenue generated per day based on tracked time and hourly rates
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-6">
        {/* Left: Heatmap Calendar */}
        <div>
          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            <div className="bg-secondary/40 rounded-xl p-3 border border-border">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                <DollarSign className="w-3 h-3 text-chart-4" />
                Total Revenue
              </div>
              <p className="text-lg text-chart-4 tabular-nums">${totalRevenue.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{data.length} days</p>
            </div>
            <div className="bg-secondary/40 rounded-xl p-3 border border-border">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                <TrendingUp className="w-3 h-3 text-primary" />
                Daily Average
              </div>
              <p className="text-lg text-foreground tabular-nums">${avgDailyRevenue}</p>
              <p className="text-[10px] text-muted-foreground">per day</p>
            </div>
            <div className="bg-secondary/40 rounded-xl p-3 border border-border">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                <Clock className="w-3 h-3 text-chart-5" />
                Unbilled Hours
              </div>
              <p className="text-lg text-chart-5 tabular-nums">{totalUnbilledHours.toFixed(1)}h</p>
              <p className="text-[10px] text-muted-foreground">admin/untagged</p>
            </div>
            <div className="bg-red-500/5 rounded-xl p-3 border border-red-500/20">
              <div className="flex items-center gap-1.5 text-[10px] text-red-400 mb-1">
                <AlertTriangle className="w-3 h-3" />
                Lost Potential
              </div>
              <p className="text-lg text-red-400 tabular-nums">${unbilledCost.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">if billed at avg rate</p>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="flex gap-[3px]">
            <div className="flex flex-col gap-[3px] pt-6 shrink-0">
              {DOW_LABELS.map((label) => (
                <div key={label} className="h-[32px] flex items-center text-[10px] text-muted-foreground pr-2">
                  {label}
                </div>
              ))}
            </div>
            <div className="flex-1">
              <div className="flex gap-[3px]">
                {weeks.map((week, wi) => {
                  const firstDay = week.find((d) => d !== null);
                  const showMonth = firstDay && (wi === 0 || firstDay.day <= 7);
                  return (
                    <div key={wi} className="flex-1 flex flex-col gap-[3px]">
                      <div className="h-5 flex items-end">
                        {showMonth && firstDay && (
                          <span className="text-[9px] text-muted-foreground">
                            {monthNames[firstDay.month]}
                          </span>
                        )}
                      </div>
                      {week.map((day, di) => (
                        <div
                          key={di}
                          className={`h-[32px] rounded-md transition-all duration-150 relative ${
                            day ? "cursor-pointer hover:ring-2 hover:ring-primary/40" : ""
                          }`}
                          style={{
                            backgroundColor: day ? getIntensityColor(day.revenue) : "transparent",
                          }}
                          onMouseEnter={(e) => {
                            if (day) {
                              setHoveredDay(day);
                              const rect = e.currentTarget.getBoundingClientRect();
                              setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
                            }
                          }}
                          onMouseLeave={() => setHoveredDay(null)}
                        >
                          {day && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-[8px] text-white/30">{day.day}</span>
                              {day.revenue > 0 && (
                                <span className="text-[7px] text-white/50 tabular-nums">
                                  ${day.revenue}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2 mt-3">
            <span className="text-[10px] text-muted-foreground">$0</span>
            {["rgba(52,211,153,0.1)", "rgba(52,211,153,0.2)", "rgba(52,211,153,0.4)", "rgba(52,211,153,0.6)", "rgba(52,211,153,0.85)"].map(
              (c, i) => (
                <div key={i} className="w-4 h-3 rounded-sm" style={{ backgroundColor: c }} />
              )
            )}
            <span className="text-[10px] text-muted-foreground">${maxRevenue}+</span>
          </div>
        </div>

        {/* Right: Rate Configuration */}
        <div className="border-l border-border pl-6">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Hourly Rates by Tag
          </p>
          <div className="space-y-2">
            {rates.map((rate) => (
              <div
                key={rate.id}
                className="flex items-center gap-2 p-2.5 rounded-lg bg-secondary/30 border border-border hover:bg-secondary/50 transition-colors"
              >
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: rate.color }} />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-foreground truncate block">{rate.tag}</span>
                </div>
                {editingId === rate.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">$</span>
                    <input
                      type="number"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveEdit(rate.id)}
                      autoFocus
                      className="w-14 bg-secondary border border-primary/30 rounded px-1.5 py-0.5 text-xs text-foreground text-right focus:outline-none"
                    />
                    <button onClick={() => saveEdit(rate.id)} className="p-0.5 text-chart-4 hover:text-foreground cursor-pointer">
                      <Check className="w-3 h-3" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => startEditing(rate)}
                    className="flex items-center gap-1 text-xs text-foreground hover:text-primary transition-colors cursor-pointer group"
                  >
                    <span className="tabular-nums">
                      {rate.hourlyRate > 0 ? `$${rate.hourlyRate}/hr` : "Unbilled"}
                    </span>
                    <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Unbilled Warning */}
          <div className="mt-4 p-3 rounded-xl bg-red-500/5 border border-red-500/15">
            <div className="flex items-center gap-1.5 text-xs text-red-400 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Unbilled Time Alert
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              You spent <span className="text-foreground">{totalUnbilledHours.toFixed(1)} hours</span> on
              un-tagged administrative tasks this month, costing you an estimated{" "}
              <span className="text-red-400">${unbilledCost.toLocaleString()}</span> in
              potential billable time.
            </p>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {hoveredDay && (
        <div
          className="fixed z-[100] pointer-events-none"
          style={{ left: tooltipPos.x, top: tooltipPos.y - 8, transform: "translate(-50%, -100%)" }}
        >
          <div className="bg-popover border border-border rounded-xl p-3.5 shadow-2xl min-w-[220px]">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-foreground">
                {monthNames[hoveredDay.month]} {hoveredDay.day} ({DOW_LABELS[hoveredDay.dow]})
              </p>
              <span className="text-sm text-chart-4 tabular-nums">${hoveredDay.revenue}</span>
            </div>
            <div className="space-y-1.5">
              {hoveredDay.breakdown
                .filter((b) => b.hours > 0)
                .map((b, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                      <span className="text-muted-foreground">{b.tag}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-foreground tabular-nums">{b.hours}h</span>
                      <span className="text-chart-4 tabular-nums w-12 text-right">
                        {b.revenue > 0 ? `$${b.revenue}` : "—"}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border text-[10px]">
              <span className="text-muted-foreground">
                Billed: {hoveredDay.billedHours}h | Unbilled: {hoveredDay.unbilledHours}h
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}