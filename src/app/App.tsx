import { memo, useState, useEffect, useMemo } from "react";
import {
  Mouse,
  Keyboard,
  Timer,
  Activity,
  Sun,
  Moon,
  Clock,
  LayoutDashboard,
  HelpCircle,
  Newspaper,
  ScrollText,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Sidebar } from "./components/Sidebar";
import { StatCard } from "./components/StatCard";
import { ActivityTimeline } from "./components/ActivityTimeline";
import { ActivityHeatmap } from "./components/ActivityHeatmap";
import { LiveActivityFeed } from "./components/LiveActivityFeed";
import { InputVisualizer } from "./components/InputVisualizer";
import { DetectionBoard } from "./components/DetectionBoard";
import { TimelineEditor } from "./components/timeline/TimelineEditor";
import { SunburstChart } from "./components/reports/SunburstChart";
import { ChangelogPage } from "./components/ChangelogPage";
import { HelpPage } from "./components/HelpPage";
import { LogsPage } from "./components/LogsPage";
import { UpdateAvailableModal } from "./components/UpdateAvailableModal";
import {
  toActivityStatus,
  toApmData,
  toSunburstApps,
  toTimelineBlocks,
  toTimelineMarkers,
} from "./activityAppUsage";
import { useActivityOverview } from "./hooks/useActivityOverview";
import { useDashboardSummary } from "./hooks/useDashboardSummary";
import { useAppUpdater } from "./hooks/useAppUpdater";
import type { DashboardSummaryDto } from "./types/backend";

const PAGE_CONFIG: Record<string, { title: string; subtitle: string; icon: typeof LayoutDashboard; accentColor: string }> = {
  dashboard: { title: "Dashboard", subtitle: "System overview & productivity intelligence", icon: LayoutDashboard, accentColor: "text-primary" },
  activity: { title: "Activity Tracker", subtitle: "Input monitoring & application usage analytics", icon: Activity, accentColor: "text-chart-2" },
  logs: { title: "System Logs", subtitle: "Live backend diagnostics & event stream", icon: ScrollText, accentColor: "text-chart-4" },
  changelog: { title: "Changes", subtitle: "What shipped in each minor version", icon: Newspaper, accentColor: "text-chart-4" },
  help: { title: "Help & Documentation", subtitle: "Guides, shortcuts, and system reference", icon: HelpCircle, accentColor: "text-chart-5" },
};

const StableSidebar = memo(Sidebar);
const StableActivityTimeline = memo(ActivityTimeline);
const StableActivityHeatmap = memo(ActivityHeatmap);
const StableInputVisualizer = memo(InputVisualizer);
const StableLiveActivityFeed = memo(LiveActivityFeed);

function LastUpdatedChip({ generatedAt }: { generatedAt?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: number | null = null;
    const tick = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          tick();
          schedule();
        },
        document.visibilityState === "visible" ? 5_000 : 60_000,
      );
    };
    const handleVisibilityChange = () => {
      if (timer !== null) window.clearTimeout(timer);
      tick();
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const generatedMs = generatedAt ? Date.parse(generatedAt) : now;
  const seconds = Number.isFinite(generatedMs)
    ? Math.max(0, Math.floor((now - generatedMs) / 1_000))
    : 0;
  const label =
    seconds < 5
      ? "just now"
      : seconds < 60
        ? `${seconds}s ago`
        : `${Math.floor(seconds / 60)}m ago`;

  return (
    <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-secondary/50 border border-border/50 text-[10px] sm:text-[11px] text-muted-foreground">
      <Clock className="w-3 h-3" />
      <span className="tabular-nums">{label}</span>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isDark, setIsDark] = useState(false);
  const updater = useAppUpdater();
  const dashboardSummaryMode =
    activeTab === "dashboard"
      ? "live"
      : activeTab === "activity"
        ? "passive"
        : "off";
  const {
    summary: dashboardSummary,
    isLoading: isDashboardSummaryLoading,
    error: dashboardSummaryError,
  } = useDashboardSummary(dashboardSummaryMode);

  useEffect(() => {
    document.documentElement.classList.toggle("light", !isDark);
  }, [isDark]);

  const page = PAGE_CONFIG[activeTab] || PAGE_CONFIG.dashboard;
  const PageIcon = page.icon;

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <UpdateAvailableModal
        available={updater.available}
        phase={updater.phase}
        progress={updater.progress}
        error={updater.error}
        onInstall={updater.install}
        onDismiss={updater.dismiss}
      />

      <StableSidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-auto min-h-[56px] lg:min-h-[72px] border-b border-border flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-6 lg:px-8 py-2 sm:py-0 shrink-0 bg-card gap-2 sm:gap-0">
          {/* Left: Page context */}
          <div className="flex items-center gap-3 lg:gap-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab + "-icon"}
                className={`w-8 h-8 lg:w-10 lg:h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 ${page.accentColor}`}
                initial={{ scale: 0.5, opacity: 0, rotate: -30 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.5, opacity: 0, rotate: 30 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
              >
                <PageIcon className="w-4 h-4 lg:w-[18px] lg:h-[18px]" />
              </motion.div>
            </AnimatePresence>
            <div className="flex flex-col gap-0.5">
              <AnimatePresence mode="wait">
                <motion.h2
                  key={activeTab + "-title"}
                  className="text-foreground tracking-tight leading-tight text-sm sm:text-base lg:text-xl"
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -8, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                >
                  {page.title}
                </motion.h2>
              </AnimatePresence>
              <AnimatePresence mode="wait">
                <motion.p
                  key={activeTab + "-sub"}
                  className="text-[10px] sm:text-[11px] text-muted-foreground leading-tight hidden sm:block"
                  initial={{ y: 6, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -6, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25, delay: 0.04 }}
                >
                  {page.subtitle}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          {/* Right: Status chips */}
          <div className="flex items-center gap-1.5 sm:gap-2 lg:gap-3 flex-wrap sm:flex-nowrap">
            {/* Last updated chip */}
            <LastUpdatedChip
              key={activeTab}
              generatedAt={dashboardSummary?.generatedAt}
            />

            {/* Separator */}
            <div className="w-px h-5 sm:h-6 bg-border mx-0.5" />

            {/* Theme Toggle */}
            <motion.button
              onClick={() => setIsDark((v) => !v)}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center cursor-pointer text-muted-foreground hover:text-foreground bg-secondary/50 border border-border/50 hover:bg-secondary transition-colors"
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.85, rotate: 180 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              <AnimatePresence mode="wait">
                {isDark ? (
                  <motion.div key="sun" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                    <Sun className="w-4 h-4" />
                  </motion.div>
                ) : (
                  <motion.div key="moon" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.2 }}>
                    <Moon className="w-4 h-4" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8">
          {activeTab === "dashboard" && <DashboardView summary={dashboardSummary} />}
          {activeTab === "activity" && (
            <ActivityView
              summary={dashboardSummary}
              isSummaryLoading={isDashboardSummaryLoading}
              summaryError={dashboardSummaryError}
            />
          )}
          {activeTab === "logs" && <LogsPage />}
          {activeTab === "changelog" && <ChangelogPage />}
          {activeTab === "help" && <HelpPage />}
        </main>
      </div>
    </div>
  );
}

function DashboardView({ summary }: { summary: DashboardSummaryDto | null }) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <DetectionBoard />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          title={summary?.metrics.activeTimeToday.title ?? "Active Time Today"}
          value={summary?.metrics.activeTimeToday.value ?? "—"}
          change={summary?.metrics.activeTimeToday.change ?? undefined}
          trend={summary?.metrics.activeTimeToday.trend ?? "up"}
          icon={<Timer className="w-5 h-5" />}
          color="bg-primary/10 text-primary"
          subtitle={
            summary?.metrics.activeTimeToday.subtitle ??
            "minutes with keyboard/mouse activity"
          }
        />
        <StatCard
          title={summary?.metrics.mouseEvents.title ?? "Mouse Events"}
          value={summary?.metrics.mouseEvents.value ?? "—"}
          change={summary?.metrics.mouseEvents.change ?? undefined}
          trend={summary?.metrics.mouseEvents.trend ?? "up"}
          icon={<Mouse className="w-5 h-5" />}
          color="bg-chart-2/10 text-chart-2"
          subtitle={summary?.metrics.mouseEvents.subtitle ?? "clicks & movements"}
        />
        <StatCard
          title={summary?.metrics.keystrokes.title ?? "Keystrokes"}
          value={summary?.metrics.keystrokes.value ?? "—"}
          change={summary?.metrics.keystrokes.change ?? undefined}
          trend={summary?.metrics.keystrokes.trend ?? "down"}
          icon={<Keyboard className="w-5 h-5" />}
          color="bg-chart-3/10 text-chart-3"
          subtitle={summary?.metrics.keystrokes.subtitle ?? "total today"}
        />
      </div>

      <StableActivityTimeline />
    </div>
  );
}

function ActivityView({
  summary,
  isSummaryLoading,
  summaryError,
}: {
  summary: DashboardSummaryDto | null;
  isSummaryLoading: boolean;
  summaryError: string | null;
}) {
  const {
    overview: activityOverview,
    isLoading: isActivityOverviewLoading,
    error: activityOverviewError,
  } = useActivityOverview();

  const appSummaries = activityOverview?.apps ?? [];
  const appIconDataUrlById = useMemo(
    () =>
      Object.fromEntries(
        appSummaries.map((app) => [app.appId, app.iconDataUrl ?? undefined]),
      ),
    [appSummaries],
  );

  const realTimelineBlocks = useMemo(
    () =>
      toTimelineBlocks(
        activityOverview?.timelineSessions ?? [],
        appIconDataUrlById,
      ),
    [activityOverview?.timelineSessions, appIconDataUrlById],
  );
  const realActivityStatus = useMemo(
    () => toActivityStatus(activityOverview?.inputMinutes ?? []),
    [activityOverview?.inputMinutes],
  );
  const realTimelineMarkers = useMemo(
    () => toTimelineMarkers(activityOverview?.inputMinutes ?? []),
    [activityOverview?.inputMinutes],
  );
  const realApmData = useMemo(
    () => toApmData(activityOverview?.inputMinutes ?? []),
    [activityOverview?.inputMinutes],
  );
  const realSunburstApps = useMemo(
    () => toSunburstApps(appSummaries),
    [appSummaries],
  );

  const activeTime = summary?.metrics.activeTimeToday?.value ?? "—";
  const mouseEvents = summary?.metrics.mouseEvents?.value ?? "—";
  const keystrokes = summary?.metrics.keystrokes?.value ?? "—";
  const activeTimeChange = summary?.metrics.activeTimeToday?.change ?? undefined;
  const activeTimeTrend = summary?.metrics.activeTimeToday?.trend;
  const mouseChange = summary?.metrics.mouseEvents?.change ?? undefined;
  const mouseTrend = summary?.metrics.mouseEvents?.trend;
  const keystrokesChange = summary?.metrics.keystrokes?.change ?? undefined;
  const keystrokesTrend = summary?.metrics.keystrokes?.trend;

  return (
    <div className="space-y-4 sm:space-y-6">
      {summaryError && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {summaryError}
        </div>
      )}
      {activityOverviewError && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {activityOverviewError}
        </div>
      )}
      <DetectionBoard />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          title="Total Active Time"
          value={isSummaryLoading ? "…" : activeTime}
          change={activeTimeChange}
          trend={activeTimeTrend ?? "up"}
          icon={<Timer className="w-5 h-5" />}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          title="Mouse Events"
          value={isSummaryLoading ? "…" : mouseEvents}
          change={mouseChange}
          trend={mouseTrend ?? "up"}
          icon={<Mouse className="w-5 h-5" />}
          color="bg-chart-2/10 text-chart-2"
        />
        <StatCard
          title="Keystrokes"
          value={isSummaryLoading ? "…" : keystrokes}
          change={keystrokesChange}
          trend={keystrokesTrend ?? "up"}
          icon={<Keyboard className="w-5 h-5" />}
          color="bg-chart-3/10 text-chart-3"
        />
        <StatCard
          title="Idle Periods"
          value="—"
          icon={<Activity className="w-5 h-5" />}
          color="bg-chart-5/10 text-chart-5"
        />
      </div>

      {/* Multi-Track Timeline Editor (timebar + tracks + minimap) */}
      <div className="min-h-[320px]">
        <TimelineEditor
          blocks={realTimelineBlocks}
          activityStatus={realActivityStatus}
          markers={realTimelineMarkers}
          apmData={realApmData}
          appSummaries={appSummaries}
          appIconDataUrlById={appIconDataUrlById}
          isLoading={isActivityOverviewLoading}
        />
      </div>

      {/* App Usage Sunburst + Live Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <SunburstChart allApps={realSunburstApps} />
        <StableLiveActivityFeed />
      </div>

      <StableInputVisualizer />

      {/* Activity Timeline + Activity Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-stretch">
        <div className="[&>div]:h-full">
          <StableActivityTimeline initialRange="today" />
        </div>
        <div className="[&>div]:h-full">
          <StableActivityHeatmap />
        </div>
      </div>
    </div>
  );
}
