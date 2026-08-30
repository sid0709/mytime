import type {
  ActivityHeatmapDto,
  ActivityOverviewDto,
  ActivitySessionPageDto,
  ActivityTimelineDto,
  AppInputMinuteDto,
} from "../types/backend";
import { invokeWithFallback } from "./tauri";

function createFallbackTimeline(
  startDate = "2026-03-03",
  endDate = "2026-03-09",
): ActivityTimelineDto {
  return {
    generatedAt: new Date().toISOString(),
    startDate,
    endDate,
    isHourly: false,
    yLabel: "Hours",
    maxValue: 24,
    avgActive: 6.4,
    points: [
      { label: "3/3", active: 6.2, inactive: 17.8, fullDate: "2026-03-03" },
      { label: "3/4", active: 7.1, inactive: 16.9, fullDate: "2026-03-04" },
      { label: "3/5", active: 6.8, inactive: 17.2, fullDate: "2026-03-05" },
      { label: "3/6", active: 5.9, inactive: 18.1, fullDate: "2026-03-06" },
      { label: "3/7", active: 3.8, inactive: 20.2, fullDate: "2026-03-07" },
      { label: "3/8", active: 4.1, inactive: 19.9, fullDate: "2026-03-08" },
      { label: "3/9", active: 7.0, inactive: 17.0, fullDate: "2026-03-09" },
    ],
  };
}

export function getActivityTimeline(startDate?: string, endDate?: string) {
  return invokeWithFallback<ActivityTimelineDto>(
    "get_activity_timeline",
    () => createFallbackTimeline(startDate, endDate),
    {
      startDate,
      endDate,
    },
  );
}

const fallbackHeatmapGrid = (): number[][] => {
  const days = 8;
  const slots = 24;
  return Array.from({ length: days }, (_, day) =>
    Array.from({ length: slots }, (_, hour) => {
      if (day === 7) return 0;
      const isWeekend = day >= 5;
      const isWorkHour = hour >= 9 && hour <= 17 && !isWeekend;
      const isExtended = hour >= 7 && hour <= 22;
      if (isWorkHour) return 50 + Math.floor(Math.random() * 50);
      if (isExtended && !isWeekend) return 10 + Math.floor(Math.random() * 30);
      if (isExtended) return 5 + Math.floor(Math.random() * 20);
      return Math.floor(Math.random() * 10);
    }),
  );
};

export function getActivityHeatmap() {
  return invokeWithFallback<ActivityHeatmapDto>(
    "get_activity_heatmap",
    () => ({ grid: fallbackHeatmapGrid(), slotSeconds: 3600 }),
  );
}

export function getActivityOverview(includeIcons = true) {
  return invokeWithFallback<ActivityOverviewDto>(
    "get_activity_overview",
    () => ({
      generatedAt: new Date().toISOString(),
      totalSessions: 0,
      apps: [],
      inputMinutes: [],
      timelineSessions: [],
    }),
    { includeIcons },
  );
}

export function getActivitySessionPage(
  args?: {
    offset?: number;
    limit?: number;
    filterText?: string;
    appId?: string | null;
    sortField?: string;
    sortDir?: string;
  },
) {
  return invokeWithFallback<ActivitySessionPageDto>(
    "get_activity_session_page",
    () => ({
      generatedAt: new Date().toISOString(),
      total: 0,
      offset: args?.offset ?? 0,
      limit: args?.limit ?? 0,
      hasMore: false,
      sessions: [],
    }),
    {
      offset: args?.offset,
      limit: args?.limit,
      filterText: args?.filterText,
      appId: args?.appId ?? undefined,
      sortField: args?.sortField,
      sortDir: args?.sortDir,
    },
  );
}

export function getActivityInputMinutes() {
  return invokeWithFallback<AppInputMinuteDto[]>(
    "get_activity_input_minutes",
    () => [],
  );
}
