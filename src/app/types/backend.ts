export type MetricTrend = "up" | "down";

export interface MetricCardDto {
  title: string;
  value: string;
  change?: string | null;
  trend?: MetricTrend | null;
  subtitle?: string | null;
}

export interface DashboardMetricsDto {
  activeTimeToday: MetricCardDto;
  mouseEvents: MetricCardDto;
  keystrokes: MetricCardDto;
}

export interface DashboardSummaryDto {
  generatedAt: string;
  metrics: DashboardMetricsDto;
}

export interface ActivityTimelinePointDto {
  label: string;
  active: number;
  inactive: number;
  fullDate: string;
}

export interface ActivityTimelineDto {
  generatedAt: string;
  startDate: string;
  endDate: string;
  isHourly: boolean;
  yLabel: string;
  maxValue: number;
  avgActive: number;
  points: ActivityTimelinePointDto[];
}

export type InputMonitorKind = "keyboard" | "mouse" | "scroll";
export type InputMonitorAction = "press" | "release" | "move" | "wheel";
export type InputMonitorButton = "left" | "right" | "middle";
export type InputMonitorDirection = "up" | "down";

export interface InputMonitorStatusDto {
  listenEventAccess: boolean;
  tapInstalled: boolean;
  eventsReceived: number;
  executablePath: string;
  message: string;
  remoteSessionActive?: boolean;
  rejectedInjected?: number;
  rejectedRemote?: number;
}

export interface InputMonitorEventDto {
  kind: InputMonitorKind;
  action: InputMonitorAction;
  label: string;
  stateKey?: string | null;
  button?: InputMonitorButton | null;
  direction?: InputMonitorDirection | null;
  x?: number | null;
  y?: number | null;
  timestamp: number;
}

export interface LiveFeedEventDto {
  id: number;
  eventType: "mouse" | "keyboard" | "scroll";
  description: string;
  timestamp: string;
  detail?: string | null;
}

/** 8 chronological rows (today-6 … today, tomorrow) × N hour slots; cell 0–100 = % of minutes with recorded input. */
export interface ActivityHeatmapDto {
  grid: number[][];
  slotSeconds?: number;
}

export interface AppUsageSessionDto {
  id: number;
  appId: string;
  appName: string;
  iconDataUrl?: string | null;
  title: string;
  pid: number;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  keyPresses: number;
  mouseClicks: number;
  scrollEvents: number;
}

export interface AppUsageSummaryDto {
  appId: string;
  appName: string;
  iconDataUrl?: string | null;
  sessionCount: number;
  totalDurationMs: number;
  keyPresses: number;
  mouseClicks: number;
  scrollEvents: number;
}

export interface AppInputMinuteDto {
  minuteOfDay: number;
  keyPresses: number;
  mouseClicks: number;
  mouseMoves: number;
  scrollEvents: number;
}

export interface ActivityAppUsageDto {
  generatedAt: string;
  sessions: AppUsageSessionDto[];
  apps: AppUsageSummaryDto[];
  inputMinutes: AppInputMinuteDto[];
}

export interface ActivityOverviewDto {
  generatedAt: string;
  totalSessions: number;
  apps: AppUsageSummaryDto[];
  inputMinutes: AppInputMinuteDto[];
  timelineSessions: AppUsageSessionDto[];
}

export interface ActivitySessionPageDto {
  generatedAt: string;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  sessions: AppUsageSessionDto[];
}

export type LogLevel =
  | "TRACE"
  | "DEBUG"
  | "INFO"
  | "WARN"
  | "ERROR"
  | "UNKNOWN";

export interface LogEntryDto {
  id: number;
  timestamp: string | null;
  level: LogLevel;
  target: string | null;
  message: string;
}

export interface ApiServerSettingsDto {
  enabled: boolean;
  port: number;
  bind: string;
  hostname: string;
  running: boolean;
  listenAddr: string | null;
  apiBaseUrl: string | null;
  error: string | null;
}

export interface SetApiServerSettingsDto {
  enabled?: boolean;
  port?: number;
  bind?: string;
  hostname?: string;
}
