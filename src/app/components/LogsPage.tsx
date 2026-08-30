import { useCallback, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ScrollText,
  RefreshCw,
  Search,
  AlertTriangle,
  XCircle,
  Info,
  Bug,
  Activity,
  Pause,
  Play,
  ArrowDownToLine,
} from "lucide-react";

import { getRecentLogs } from "../api/logs";
import { useSerialPolling } from "../hooks/useSerialPolling";
import type { LogEntryDto, LogLevel } from "../types/backend";

type LevelFilter = "ALL" | LogLevel;

interface LevelMeta {
  label: string;
  color: string;
  icon: typeof Info;
}

const LEVEL_META: Record<LogLevel, LevelMeta> = {
  ERROR: { label: "Error", color: "#ef4444", icon: XCircle },
  WARN: { label: "Warn", color: "#f59e0b", icon: AlertTriangle },
  INFO: { label: "Info", color: "#22d3ee", icon: Info },
  DEBUG: { label: "Debug", color: "#a78bfa", icon: Bug },
  TRACE: { label: "Trace", color: "#64748b", icon: Activity },
  UNKNOWN: { label: "Log", color: "#64748b", icon: ScrollText },
};

const REFRESH_MS = 3000;

function formatTimestamp(iso: string | null): { time: string; date: string } {
  if (!iso) return { time: "--:--:--", date: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { time: iso, date: "" };
  return {
    time: d.toTimeString().slice(0, 8),
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  };
}

function shortTarget(target: string | null): string {
  if (!target) return "";
  return target.replace(/^mytime_lib::/, "").replace(/^mytime_lib$/, "core");
}

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntryDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<LevelFilter>("ALL");
  const [query, setQuery] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setIsRefreshing(true);
    try {
      const next = await getRecentLogs(400);
      setLogs(next);
    } finally {
      setIsLoading(false);
      if (showSpinner) setIsRefreshing(false);
    }
  }, []);

  const pollLogs = useCallback(() => load(false), [load]);

  useSerialPolling(pollLogs, {
    enabled: autoRefresh,
    intervalMs: REFRESH_MS,
    hiddenIntervalMs: 60_000,
  });

  const counts = useMemo(() => {
    const acc = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, TRACE: 0, UNKNOWN: 0 } as Record<
      LogLevel,
      number
    >;
    for (const log of logs) acc[log.level] += 1;
    return acc;
  }, [logs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((log) => {
      if (filter !== "ALL" && log.level !== filter) return false;
      if (!q) return true;
      return (
        log.message.toLowerCase().includes(q) ||
        (log.target?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [logs, filter, query]);

  const filterChips: { id: LevelFilter; label: string; color: string; count: number }[] = [
    { id: "ALL", label: "All", color: "#6366f1", count: logs.length },
    { id: "ERROR", label: "Errors", color: LEVEL_META.ERROR.color, count: counts.ERROR },
    { id: "WARN", label: "Warnings", color: LEVEL_META.WARN.color, count: counts.WARN },
    { id: "INFO", label: "Info", color: LEVEL_META.INFO.color, count: counts.INFO },
    {
      id: "DEBUG",
      label: "Debug",
      color: LEVEL_META.DEBUG.color,
      count: counts.DEBUG + counts.TRACE,
    },
  ];

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header / control bar */}
      <div className="bg-card rounded-2xl border border-border p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <ScrollText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-foreground leading-tight">System Logs</h3>
              <p className="text-muted-foreground text-xs mt-1">
                Live diagnostic stream from the backend collectors &amp; database
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs transition-colors ${
                autoRefresh
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {autoRefresh ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Auto</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Paused</span>
                </>
              )}
            </button>

            <motion.button
              onClick={() => void load(true)}
              whileTap={{ scale: 0.92 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-secondary/40 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">Refresh</span>
            </motion.button>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-3 gap-3 mt-5">
          <SummaryTile
            label="Total"
            value={logs.length}
            color="#6366f1"
            icon={ScrollText}
          />
          <SummaryTile
            label="Warnings"
            value={counts.WARN}
            color={LEVEL_META.WARN.color}
            icon={AlertTriangle}
          />
          <SummaryTile
            label="Errors"
            value={counts.ERROR}
            color={LEVEL_META.ERROR.color}
            icon={XCircle}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-2xl border border-border p-3 sm:p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex items-center gap-1.5 flex-wrap">
          {filterChips.map((chip) => {
            const active = filter === chip.id;
            return (
              <button
                key={chip.id}
                onClick={() => setFilter(chip.id)}
                className="relative px-3 py-1.5 rounded-lg text-xs transition-colors"
                style={{
                  color: active ? "#fff" : "var(--muted-foreground)",
                  backgroundColor: active ? chip.color : "transparent",
                }}
              >
                {!active && (
                  <span
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: chip.color }}
                  />
                )}
                <span className={active ? "" : "pl-3"}>{chip.label}</span>
                <span
                  className="ml-1.5 tabular-nums opacity-80"
                  style={{ fontSize: "10px" }}
                >
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by message or module…"
            className="w-full bg-secondary/40 border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
      </div>

      {/* Log stream */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
              {filter !== "ALL" || query ? " (filtered)" : ""}
            </span>
          </div>
          <button
            onClick={scrollToTop}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowDownToLine className="w-3.5 h-3.5 rotate-180" />
            <span className="hidden sm:inline">Top</span>
          </button>
        </div>

        <div
          ref={scrollRef}
          className="max-h-[calc(100vh-26rem)] min-h-[280px] overflow-y-auto font-mono"
        >
          {isLoading ? (
            <LogSkeleton />
          ) : filtered.length === 0 ? (
            <EmptyState hasLogs={logs.length > 0} />
          ) : (
            <AnimatePresence initial={false}>
              {filtered.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: typeof Info;
}) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2.5 flex items-center gap-3">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}1a`, color }}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="text-foreground tabular-nums leading-none text-lg">{value}</div>
        <div className="text-muted-foreground text-[10px] mt-1 uppercase tracking-wide">
          {label}
        </div>
      </div>
    </div>
  );
}

function LogRow({ log }: { log: LogEntryDto }) {
  const meta = LEVEL_META[log.level] ?? LEVEL_META.UNKNOWN;
  const { time, date } = formatTimestamp(log.timestamp);
  const LevelIcon = meta.icon;
  const target = shortTarget(log.target);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="group flex items-start gap-3 px-4 sm:px-5 py-2 border-b border-border/40 hover:bg-secondary/40 transition-colors"
      style={{ borderLeft: `2px solid ${meta.color}` }}
    >
      {/* Timestamp */}
      <div className="shrink-0 pt-0.5 text-right leading-tight">
        <div className="text-xs text-foreground/80 tabular-nums">{time}</div>
        {date && <div className="text-[10px] text-muted-foreground">{date}</div>}
      </div>

      {/* Level pill */}
      <div
        className="shrink-0 mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md"
        style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}
      >
        <LevelIcon className="w-3 h-3" />
        <span className="text-[10px] uppercase tracking-wide hidden sm:inline">
          {meta.label}
        </span>
      </div>

      {/* Message + target */}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground break-words whitespace-pre-wrap leading-relaxed">
          {log.message}
        </p>
        {target && (
          <span className="inline-block mt-0.5 text-[10px] text-muted-foreground/80">
            {target}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function LogSkeleton() {
  return (
    <div className="divide-y divide-border/40">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-2.5">
          <div className="h-3 w-12 rounded bg-secondary animate-pulse" />
          <div className="h-4 w-12 rounded bg-secondary animate-pulse" />
          <div
            className="h-3 rounded bg-secondary animate-pulse"
            style={{ width: `${40 + ((i * 13) % 45)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasLogs }: { hasLogs: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <div className="w-12 h-12 rounded-2xl bg-secondary/60 flex items-center justify-center mb-3">
        <ScrollText className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-foreground">
        {hasLogs ? "No entries match your filter" : "No log entries yet"}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {hasLogs
          ? "Try a different level or clear the search."
          : "Diagnostic events will appear here as the app runs."}
      </p>
    </div>
  );
}
