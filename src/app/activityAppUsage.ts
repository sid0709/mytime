import type { AppEntry } from "./components/reports/CategoryManagerModal";
import type {
  AppInputMinuteDto,
  AppUsageSessionDto,
  AppUsageSummaryDto,
} from "./types/backend";
import type {
  APMDataPoint,
  ActivityStatus,
  TimelineBlock,
  TimelineMarker,
} from "./components/timeline/timeline-data";
import { bucketIntensity, QUALITY_PERSIST_MIN, qualitiesByMinute, volumeScore } from "./constants/activityScore";

const DAY_START_MIN = 0;
const DAY_END_MIN = 24 * 60;
const MIN_BLOCK_MINUTES = 1 / 60;

const APP_META: Record<
  string,
  { color: string; icon: string; category: string }
> = {
  code: { color: "#007acc", icon: "💻", category: "Development" },
  devenv: { color: "#7c3aed", icon: "💻", category: "Development" },
  chrome: { color: "#4caf50", icon: "🌐", category: "Browsing" },
  msedge: { color: "#0078d7", icon: "🌐", category: "Browsing" },
  firefox: { color: "#ff7139", icon: "🦊", category: "Browsing" },
  slack: { color: "#611f69", icon: "💬", category: "Communication" },
  discord: { color: "#5865f2", icon: "🎮", category: "Communication" },
  teams: { color: "#6264a7", icon: "💬", category: "Communication" },
  outlook: { color: "#0078d4", icon: "📧", category: "Communication" },
  figma: { color: "#a259ff", icon: "🎨", category: "Design" },
  photoshop: { color: "#31a8ff", icon: "🎨", category: "Design" },
  terminal: { color: "#2d2d2d", icon: "⬛", category: "Development" },
  powershell: { color: "#2563eb", icon: "⬛", category: "Development" },
  cmd: { color: "#334155", icon: "⬛", category: "Development" },
  notepad: { color: "#64748b", icon: "📝", category: "Productivity" },
  notion: { color: "#111827", icon: "📓", category: "Productivity" },
  explorer: { color: "#f0c040", icon: "📁", category: "Productivity" },
  spotify: { color: "#1db954", icon: "🎵", category: "Media" },
  obs64: { color: "#302e2b", icon: "🎥", category: "Media" },
};

const PALETTE = [
  "#6366f1",
  "#22d3ee",
  "#a78bfa",
  "#f97316",
  "#34d399",
  "#ef4444",
  "#ec4899",
  "#eab308",
];

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getAppVisualMeta(appId: string, appName: string) {
  const known = APP_META[appId] ?? APP_META[appId.toLowerCase()];
  if (known) {
    return known;
  }
  const color = PALETTE[hashString(appName) % PALETTE.length];
  return {
    color,
    icon: "📦",
    category: "Others",
  };
}

function minuteOfDay(tsMs: number) {
  const date = new Date(tsMs);
  return (
    date.getHours() * 60 +
    date.getMinutes() +
    date.getSeconds() / 60 +
    date.getMilliseconds() / 60000
  );
}

function clampMinute(value: number) {
  return Math.max(DAY_START_MIN, Math.min(value, DAY_END_MIN));
}

function durationMinutes(startMs: number, endMs: number) {
  return Math.max(MIN_BLOCK_MINUTES, (endMs - startMs) / 60000);
}

function formatGapLabel(minutes: number) {
  const totalSeconds = Math.max(1, Math.round(minutes * 60));
  if (totalSeconds < 60) {
    return `Idle for ${totalSeconds}s`;
  }
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return secs === 0 ? `Idle for ${mins}m` : `Idle for ${mins}m ${secs}s`;
}

function bucketType(bucket: AppInputMinuteDto): APMDataPoint["type"] {
  if (bucket.keyPresses >= bucket.mouseClicks + bucket.scrollEvents) {
    return "typing";
  }
  if (bucket.mouseClicks + bucket.scrollEvents + bucket.mouseMoves > 0) {
    return "mouse";
  }
  return "reading";
}

type SessionLike = Pick<
  AppUsageSessionDto,
  | "id"
  | "appId"
  | "appName"
  | "title"
  | "startedAtMs"
  | "endedAtMs"
  | "keyPresses"
  | "mouseClicks"
> & {
  iconDataUrl?: string | null;
};

function toTimelineBlock(
  session: SessionLike,
  iconDataUrlByAppId?: Record<string, string | null | undefined>,
): TimelineBlock {
  const meta = getAppVisualMeta(session.appId, session.appName);
  const startMin = minuteOfDay(session.startedAtMs);
  const preciseEndMin =
    startMin + durationMinutes(session.startedAtMs, session.endedAtMs);
  const clampedStart = clampMinute(startMin);
  const clampedEnd = Math.max(
    clampedStart + MIN_BLOCK_MINUTES,
    clampMinute(preciseEndMin),
  );

  return {
    id: `session-${session.id}`,
    app: session.appName,
    title: session.title || session.appName,
    startMin: clampedStart,
    endMin: clampedEnd,
    color: meta.color,
    icon: meta.icon,
    iconDataUrl:
      session.iconDataUrl ?? iconDataUrlByAppId?.[session.appId] ?? undefined,
    category: meta.category,
    keystrokes: session.keyPresses,
    clicks: session.mouseClicks,
  };
}

export function toTimelineBlocks(
  sessions: SessionLike[],
  iconDataUrlByAppId?: Record<string, string | null | undefined>,
): TimelineBlock[] {
  return sessions
    .map((session) => toTimelineBlock(session, iconDataUrlByAppId))
    .filter((block) => block.endMin > block.startMin)
    .sort((a, b) => a.startMin - b.startMin);
}

export function toTimelineBlockFromSession(
  session: SessionLike,
  iconDataUrlByAppId?: Record<string, string | null | undefined>,
) {
  return toTimelineBlock(session, iconDataUrlByAppId);
}

export function toSunburstApps(apps: AppUsageSummaryDto[]): AppEntry[] {
  return apps.map((app) => {
    const meta = getAppVisualMeta(app.appId, app.appName);
    return {
      id: app.appId,
      name: app.appName,
      color: meta.color,
      minutes: Math.max(MIN_BLOCK_MINUTES, app.totalDurationMs / 60000),
      iconDataUrl: app.iconDataUrl,
    };
  });
}

function firstSidecarSecond(qualityDay: ArrayLike<number>): number | null {
  const n = Math.min(qualityDay.length, 86_400);
  for (let i = 0; i < n; i += 1) {
    if ((qualityDay[i] ?? 0) > 0) return i;
  }
  return null;
}

export function toActivityStatus(
  inputMinutes: AppInputMinuteDto[],
  qualityDay?: ArrayLike<number>,
): ActivityStatus[] {
  const hasDay = qualityDay != null && qualityDay.length >= 86_400;
  if (!hasDay && inputMinutes.length === 0) {
    return [{ startMin: DAY_START_MIN, endMin: DAY_END_MIN, status: "shutdown" }];
  }

  const presence = new Set(
    inputMinutes
      .filter(
        (bucket) =>
          bucket.keyPresses > 0 ||
          bucket.mouseClicks > 0 ||
          bucket.mouseMoves > 0 ||
          bucket.scrollEvents > 0,
      )
      .map((bucket) => bucket.minuteOfDay),
  );

  const thresholdPct = Math.round(QUALITY_PERSIST_MIN * 100);
  const sidecarFromSec = hasDay && qualityDay ? firstSidecarSecond(qualityDay) : null;
  const totalSec = (DAY_END_MIN - DAY_START_MIN) * 60;

  const hasSignal = (sec: number): boolean => {
    if (presence.has(Math.floor(sec / 60))) return true;
    return hasDay && qualityDay ? (qualityDay[sec] ?? 0) > 0 : false;
  };

  const statusAt = (sec: number): ActivityStatus["status"] => {
    if (sidecarFromSec != null && sec >= sidecarFromSec && qualityDay) {
      return (qualityDay[sec] ?? 0) >= thresholdPct ? "active" : "inactive";
    }
    return presence.has(Math.floor(sec / 60)) ? "active" : "inactive";
  };

  let firstSec = -1;
  let lastSec = -1;
  for (let sec = 0; sec < totalSec; sec += 1) {
    if (hasSignal(sec)) {
      if (firstSec < 0) firstSec = sec;
      lastSec = sec;
    }
  }

  if (firstSec < 0) {
    return [{ startMin: DAY_START_MIN, endMin: DAY_END_MIN, status: "shutdown" }];
  }

  const statuses: ActivityStatus[] = [];
  let segmentStart = 0;
  let current: ActivityStatus["status"] =
    0 < firstSec ? "shutdown" : statusAt(0);

  for (let sec = 1; sec <= totalSec; sec += 1) {
    const next: ActivityStatus["status"] =
      sec < firstSec || sec > lastSec ? "shutdown" : statusAt(sec);
    if (next !== current) {
      statuses.push({
        startMin: segmentStart / 60,
        endMin: sec / 60,
        status: current,
      });
      segmentStart = sec;
      current = next;
    }
  }

  statuses.push({
    startMin: segmentStart / 60,
    endMin: DAY_END_MIN,
    status: current,
  });

  return statuses.filter((seg) => seg.endMin > seg.startMin);
}

export function toTimelineMarkers(inputMinutes: AppInputMinuteDto[]): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  const sorted = [...inputMinutes].sort((a, b) => a.minuteOfDay - b.minuteOfDay);

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const gap = next.minuteOfDay - prev.minuteOfDay - 1;
    if (gap >= 2) {
      markers.push({
        id: `idle-gap-${i}`,
        minute: prev.minuteOfDay + 1,
        type: "idle",
        label: formatGapLabel(gap),
        duration: gap,
      });
    }
  }

  return markers;
}

export function toApmData(inputMinutes: AppInputMinuteDto[]): APMDataPoint[] {
  const byMinute = new Map(inputMinutes.map((bucket) => [bucket.minuteOfDay, bucket]));
  const qualities = qualitiesByMinute(inputMinutes);
  return Array.from({ length: DAY_END_MIN - DAY_START_MIN }, (_, index) => {
    const minute = DAY_START_MIN + index;
    const bucket = byMinute.get(minute);
    if (!bucket) {
      return { minute, apm: 0, type: "reading" as const };
    }
    return {
      minute,
      apm: bucketIntensity(bucket, qualities),
      volume: volumeScore(bucket),
      quality: bucket.quality ?? 1,
      type: bucketType(bucket),
    };
  });
}
