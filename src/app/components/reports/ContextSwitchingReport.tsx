import { useState, useMemo } from "react";
import {
  Brain,
  AlertTriangle,
  Zap,
  Clock,
  TrendingDown,
  ArrowRight,
  Repeat,
  Target,
  Shield,
} from "lucide-react";

interface DeepWorkSession {
  id: string;
  startTime: string;
  endTime: string;
  durationMin: number;
  app: string;
  avgAPM: number;
  interrupted: boolean;
  interruptedBy?: string;
}

interface InterruptionEvent {
  id: string;
  time: string;
  from: string;
  to: string;
  recoveryMin: number;
  costMin: number;
}

const mockSessions: DeepWorkSession[] = [
  { id: "s1", startTime: "8:15 AM", endTime: "8:47 AM", durationMin: 32, app: "VS Code", avgAPM: 78, interrupted: false },
  { id: "s2", startTime: "8:48 AM", endTime: "8:52 AM", durationMin: 4, app: "Slack", avgAPM: 22, interrupted: true, interruptedBy: "Slack notification" },
  { id: "s3", startTime: "9:05 AM", endTime: "9:58 AM", durationMin: 53, app: "VS Code", avgAPM: 85, interrupted: false },
  { id: "s4", startTime: "9:59 AM", endTime: "10:02 AM", durationMin: 3, app: "Slack", avgAPM: 15, interrupted: true, interruptedBy: "#design-review" },
  { id: "s5", startTime: "10:15 AM", endTime: "10:22 AM", durationMin: 7, app: "VS Code", avgAPM: 42, interrupted: true, interruptedBy: "Email notification" },
  { id: "s6", startTime: "10:30 AM", endTime: "11:45 AM", durationMin: 75, app: "VS Code", avgAPM: 92, interrupted: false },
  { id: "s7", startTime: "11:46 AM", endTime: "11:50 AM", durationMin: 4, app: "Slack", avgAPM: 18, interrupted: true, interruptedBy: "DM from Sarah" },
  { id: "s8", startTime: "12:05 PM", endTime: "12:08 PM", durationMin: 3, app: "Chrome", avgAPM: 12, interrupted: true, interruptedBy: "Calendar reminder" },
  { id: "s9", startTime: "1:15 PM", endTime: "1:48 PM", durationMin: 33, app: "Figma", avgAPM: 65, interrupted: false },
  { id: "s10", startTime: "1:49 PM", endTime: "1:52 PM", durationMin: 3, app: "Slack", avgAPM: 20, interrupted: true, interruptedBy: "#general standup" },
  { id: "s11", startTime: "2:05 PM", endTime: "3:30 PM", durationMin: 85, app: "VS Code", avgAPM: 88, interrupted: false },
  { id: "s12", startTime: "3:31 PM", endTime: "3:35 PM", durationMin: 4, app: "Slack", avgAPM: 25, interrupted: true, interruptedBy: "Slack notification" },
  { id: "s13", startTime: "3:48 PM", endTime: "3:55 PM", durationMin: 7, app: "Chrome", avgAPM: 30, interrupted: true, interruptedBy: "Browsing" },
  { id: "s14", startTime: "4:10 PM", endTime: "5:25 PM", durationMin: 75, app: "VS Code", avgAPM: 82, interrupted: false },
  { id: "s15", startTime: "5:26 PM", endTime: "5:30 PM", durationMin: 4, app: "Slack", avgAPM: 18, interrupted: true, interruptedBy: "End-of-day messages" },
  { id: "s16", startTime: "5:42 PM", endTime: "5:50 PM", durationMin: 8, app: "VS Code", avgAPM: 35, interrupted: true, interruptedBy: "Discord notification" },
  { id: "s17", startTime: "6:05 PM", endTime: "6:40 PM", durationMin: 35, app: "VS Code", avgAPM: 70, interrupted: false },
];

const mockInterruptions: InterruptionEvent[] = [
  { id: "i1", time: "8:48 AM", from: "VS Code", to: "Slack", recoveryMin: 13, costMin: 17 },
  { id: "i2", time: "9:59 AM", from: "VS Code", to: "Slack", recoveryMin: 13, costMin: 16 },
  { id: "i3", time: "10:15 AM", from: "VS Code", to: "Outlook", recoveryMin: 8, costMin: 15 },
  { id: "i4", time: "11:46 AM", from: "VS Code", to: "Slack", recoveryMin: 15, costMin: 19 },
  { id: "i5", time: "12:05 PM", from: "VS Code", to: "Chrome", recoveryMin: 12, costMin: 15 },
  { id: "i6", time: "1:49 PM", from: "Figma", to: "Slack", recoveryMin: 13, costMin: 16 },
  { id: "i7", time: "3:31 PM", from: "VS Code", to: "Slack", recoveryMin: 13, costMin: 17 },
  { id: "i8", time: "3:48 PM", from: "VS Code", to: "Chrome", recoveryMin: 15, costMin: 22 },
  { id: "i9", time: "5:26 PM", from: "VS Code", to: "Slack", recoveryMin: 12, costMin: 16 },
  { id: "i10", time: "5:42 PM", from: "VS Code", to: "Discord", recoveryMin: 13, costMin: 21 },
  { id: "i11", time: "6:42 PM", from: "VS Code", to: "Slack", recoveryMin: 10, costMin: 14 },
  { id: "i12", time: "7:00 PM", from: "VS Code", to: "Chrome", recoveryMin: 8, costMin: 11 },
];

const DEEP_WORK_THRESHOLD = 15; // min of uninterrupted high APM

export function ContextSwitchingReport() {
  const [selectedTab, setSelectedTab] = useState<"overview" | "timeline" | "details">("overview");

  const stats = useMemo(() => {
    const deepSessions = mockSessions.filter(
      (s) => !s.interrupted && s.durationMin >= DEEP_WORK_THRESHOLD
    );
    const totalDeepMin = deepSessions.reduce((s, d) => s + d.durationMin, 0);
    const totalInterruptions = mockInterruptions.length;
    const totalFocusLost = mockInterruptions.reduce((s, i) => s + i.costMin, 0);
    const avgRecovery =
      mockInterruptions.length > 0
        ? Math.round(
            mockInterruptions.reduce((s, i) => s + i.recoveryMin, 0) /
              mockInterruptions.length
          )
        : 0;
    const avgDeepSession =
      deepSessions.length > 0
        ? Math.round(totalDeepMin / deepSessions.length)
        : 0;
    const longestDeep = Math.max(...deepSessions.map((s) => s.durationMin), 0);

    // Interruption sources
    const sources: Record<string, number> = {};
    mockInterruptions.forEach((i) => {
      sources[i.to] = (sources[i.to] || 0) + 1;
    });

    return {
      deepSessions: deepSessions.length,
      totalDeepMin,
      totalInterruptions,
      totalFocusLost,
      avgRecovery,
      avgDeepSession,
      longestDeep,
      sources: Object.entries(sources)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    };
  }, []);

  // Deep work timeline visualization
  const totalWorkMinutes = 10 * 60; // 8 AM to 6 PM
  const timelineStart = 8 * 60;

  const getTimePos = (timeStr: string) => {
    const [time, ampm] = timeStr.split(" ");
    const [hStr, mStr] = time.split(":");
    let h = parseInt(hStr);
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return ((h * 60 + parseInt(mStr) - timelineStart) / totalWorkMinutes) * 100;
  };

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "timeline" as const, label: "Deep Work Timeline" },
    { id: "details" as const, label: "Interruption Log" },
  ];

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-foreground flex items-center gap-2">
            <Brain className="w-5 h-5 text-chart-5" />
            Context-Switching Penalty Report
          </h3>
          <p className="text-muted-foreground text-xs mt-1">
            Algorithmic analysis of deep work interruptions and focus recovery cost
          </p>
        </div>
        <div className="flex items-center gap-1 p-0.5 bg-secondary rounded-lg">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs transition-all cursor-pointer ${
                selectedTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {selectedTab === "overview" && (
        <>
          {/* Hero Alert */}
          <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-5 mb-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h4 className="text-foreground mb-1">
                  Focus Fragmentation Alert
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  You interrupted your deep work{" "}
                  <span className="text-red-400">{stats.totalInterruptions} times</span>{" "}
                  today to check notifications. Each interruption costs an average of{" "}
                  <span className="text-red-400">{stats.avgRecovery} minutes</span>{" "}
                  to recover focus. Estimated total focus time lost:{" "}
                  <span className="text-red-400 text-base">
                    {Math.floor(stats.totalFocusLost / 60)}h {stats.totalFocusLost % 60}m
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-6 gap-3 mb-6">
            <div className="bg-secondary/40 rounded-xl p-3 border border-border">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                <Target className="w-3 h-3 text-chart-4" />
                Deep Sessions
              </div>
              <p className="text-xl text-chart-4 tabular-nums">{stats.deepSessions}</p>
              <p className="text-[10px] text-muted-foreground">
                {">"}15min uninterrupted
              </p>
            </div>
            <div className="bg-secondary/40 rounded-xl p-3 border border-border">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                <Clock className="w-3 h-3 text-primary" />
                Deep Work
              </div>
              <p className="text-xl text-primary tabular-nums">
                {Math.floor(stats.totalDeepMin / 60)}h {stats.totalDeepMin % 60}m
              </p>
              <p className="text-[10px] text-muted-foreground">total focused</p>
            </div>
            <div className="bg-secondary/40 rounded-xl p-3 border border-border">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                <Repeat className="w-3 h-3 text-chart-5" />
                Interruptions
              </div>
              <p className="text-xl text-chart-5 tabular-nums">{stats.totalInterruptions}</p>
              <p className="text-[10px] text-muted-foreground">context switches</p>
            </div>
            <div className="bg-secondary/40 rounded-xl p-3 border border-border">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                <TrendingDown className="w-3 h-3 text-red-400" />
                Focus Lost
              </div>
              <p className="text-xl text-red-400 tabular-nums">
                {Math.floor(stats.totalFocusLost / 60)}h {stats.totalFocusLost % 60}m
              </p>
              <p className="text-[10px] text-muted-foreground">recovery cost</p>
            </div>
            <div className="bg-secondary/40 rounded-xl p-3 border border-border">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                <Zap className="w-3 h-3 text-chart-2" />
                Avg Recovery
              </div>
              <p className="text-xl text-chart-2 tabular-nums">{stats.avgRecovery}m</p>
              <p className="text-[10px] text-muted-foreground">per interruption</p>
            </div>
            <div className="bg-secondary/40 rounded-xl p-3 border border-border">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                <Shield className="w-3 h-3 text-chart-3" />
                Best Session
              </div>
              <p className="text-xl text-chart-3 tabular-nums">{stats.longestDeep}m</p>
              <p className="text-[10px] text-muted-foreground">longest streak</p>
            </div>
          </div>

          {/* Interruption Sources + Efficiency */}
          <div className="grid grid-cols-2 gap-6">
            {/* Sources */}
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                Top Interruption Sources
              </p>
              <div className="space-y-2">
                {stats.sources.map((source) => {
                  const pct = Math.round((source.count / stats.totalInterruptions) * 100);
                  return (
                    <div key={source.name} className="flex items-center gap-3">
                      <span className="text-xs text-foreground w-20 truncate">
                        {source.name}
                      </span>
                      <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-500/60 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                        {source.count}x ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Efficiency Comparison */}
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                Focus Efficiency Score
              </p>
              <div className="bg-secondary/30 rounded-xl p-4 border border-border">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-muted-foreground">
                    Potential Work Time
                  </span>
                  <span className="text-sm text-foreground tabular-nums">
                    10h 0m
                  </span>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1 text-xs">
                      <span className="text-chart-4">Deep Work</span>
                      <span className="tabular-nums text-foreground">
                        {Math.floor(stats.totalDeepMin / 60)}h {stats.totalDeepMin % 60}m
                      </span>
                    </div>
                    <div className="h-4 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-chart-4/60 rounded-full"
                        style={{
                          width: `${(stats.totalDeepMin / 600) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1 text-xs">
                      <span className="text-red-400">Lost to Recovery</span>
                      <span className="tabular-nums text-foreground">
                        {Math.floor(stats.totalFocusLost / 60)}h {stats.totalFocusLost % 60}m
                      </span>
                    </div>
                    <div className="h-4 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500/40 rounded-full"
                        style={{
                          width: `${(stats.totalFocusLost / 600) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Efficiency Score
                  </span>
                  <span
                    className="text-lg tabular-nums"
                    style={{
                      color:
                        stats.totalDeepMin / 600 > 0.6
                          ? "#34d399"
                          : stats.totalDeepMin / 600 > 0.4
                          ? "#eab308"
                          : "#ef4444",
                    }}
                  >
                    {Math.round((stats.totalDeepMin / 600) * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {selectedTab === "timeline" && (
        <div>
          {/* Timeline vis */}
          <div className="mb-4">
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground mb-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-1.5 rounded bg-chart-4/70" />
                Deep Work (≥15min)
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-1.5 rounded bg-chart-5/70" />
                Shallow Work
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-1.5 rounded bg-red-500/70" />
                Interruption
              </div>
            </div>
          </div>

          {/* Hour markers */}
          <div className="relative h-5 border-b border-border mb-1">
            {Array.from({ length: 11 }, (_, i) => {
              const hour = 8 + i;
              const pos = ((i * 60) / totalWorkMinutes) * 100;
              return (
                <div key={hour} className="absolute top-0 h-full" style={{ left: `${pos}%` }}>
                  <div className="w-px h-full bg-white/5" />
                  <span className="absolute bottom-0 text-[9px] text-muted-foreground -translate-x-1/2">
                    {hour > 12 ? hour - 12 : hour}{hour >= 12 ? "P" : "A"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Session blocks */}
          <div className="relative h-12 bg-secondary/20 rounded-lg mb-4">
            {mockSessions.map((session) => {
              const left = getTimePos(session.startTime);
              const right = getTimePos(session.endTime);
              const width = right - left;
              const isDeep = !session.interrupted && session.durationMin >= DEEP_WORK_THRESHOLD;
              const isInterruption = session.interrupted;

              return (
                <div
                  key={session.id}
                  className="absolute top-1.5 bottom-1.5 rounded-md transition-all hover:brightness-125"
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 0.3)}%`,
                    backgroundColor: isInterruption
                      ? "rgba(239, 68, 68, 0.5)"
                      : isDeep
                      ? "rgba(52, 211, 153, 0.5)"
                      : "rgba(249, 115, 22, 0.35)",
                  }}
                  title={`${session.startTime} — ${session.endTime} | ${session.app} | APM: ${session.avgAPM} ${
                    session.interruptedBy ? `| Interrupted by: ${session.interruptedBy}` : ""
                  }`}
                />
              );
            })}

            {/* Interruption markers */}
            {mockInterruptions.map((int) => {
              const pos = getTimePos(int.time);
              return (
                <div
                  key={int.id}
                  className="absolute top-0 w-px h-full bg-red-500/60 z-10"
                  style={{ left: `${pos}%` }}
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-red-500" />
                </div>
              );
            })}
          </div>

          {/* Session list */}
          <div className="max-h-[240px] overflow-y-auto space-y-1 overscroll-y-contain">
            {mockSessions.map((session) => {
              const isDeep = !session.interrupted && session.durationMin >= DEEP_WORK_THRESHOLD;
              return (
                <div
                  key={session.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs ${
                    session.interrupted
                      ? "bg-red-500/5"
                      : isDeep
                      ? "bg-chart-4/5"
                      : "bg-secondary/20"
                  }`}
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: session.interrupted
                        ? "#ef4444"
                        : isDeep
                        ? "#34d399"
                        : "#f97316",
                    }}
                  />
                  <span className="text-muted-foreground tabular-nums w-20 shrink-0">
                    {session.startTime}
                  </span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                  <span className="text-muted-foreground tabular-nums w-20 shrink-0">
                    {session.endTime}
                  </span>
                  <span className="text-foreground w-16 shrink-0">{session.app}</span>
                  <span className="text-foreground tabular-nums w-10 shrink-0">{session.durationMin}m</span>
                  <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(session.avgAPM / 100) * 100}%`,
                        backgroundColor:
                          session.avgAPM > 70
                            ? "#34d399"
                            : session.avgAPM > 40
                            ? "#eab308"
                            : "#ef4444",
                      }}
                    />
                  </div>
                  <span className="text-muted-foreground tabular-nums w-12 text-right shrink-0">
                    {session.avgAPM} APM
                  </span>
                  {session.interruptedBy && (
                    <span className="text-red-400 text-[10px] truncate max-w-[120px]">
                      {session.interruptedBy}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selectedTab === "details" && (
        <div>
          <div className="grid grid-cols-[80px_120px_50px_120px_80px_80px_1fr] gap-3 px-4 py-2 bg-secondary/20 rounded-t-lg text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border">
            <span>Time</span>
            <span>From</span>
            <span />
            <span>To</span>
            <span>Recovery</span>
            <span>Cost</span>
            <span>Impact</span>
          </div>
          <div className="max-h-[400px] overflow-y-auto overscroll-y-contain">
            {mockInterruptions.map((int) => (
              <div
                key={int.id}
                className="grid grid-cols-[80px_120px_50px_120px_80px_80px_1fr] gap-3 px-4 py-3 border-b border-border/40 items-center hover:bg-secondary/20 transition-colors"
              >
                <span className="text-xs text-muted-foreground tabular-nums">{int.time}</span>
                <span className="text-xs text-foreground">{int.from}</span>
                <ArrowRight className="w-3 h-3 text-red-400" />
                <span className="text-xs text-red-400">{int.to}</span>
                <span className="text-xs text-chart-2 tabular-nums">{int.recoveryMin}m</span>
                <span className="text-xs text-red-400 tabular-nums">{int.costMin}m</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-500/50 rounded-full"
                      style={{ width: `${(int.costMin / 25) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {int.costMin > 18 ? "HIGH" : int.costMin > 14 ? "MED" : "LOW"}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 bg-secondary/10 rounded-b-lg flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Total Interruptions: <span className="text-foreground">{mockInterruptions.length}</span>
            </span>
            <span className="text-muted-foreground">
              Total Recovery Cost:{" "}
              <span className="text-red-400">
                {Math.floor(stats.totalFocusLost / 60)}h {stats.totalFocusLost % 60}m
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}