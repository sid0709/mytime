import type { AppInputMinuteDto } from "../types/backend";
import { mixedQuality } from "./activityScore";

const SECONDS_PER_DAY = 86_400;

export function firstSidecarSecond(
  qualityDay: ArrayLike<number> | undefined,
): number | null {
  if (!qualityDay) return null;
  const n = Math.min(qualityDay.length, SECONDS_PER_DAY);
  for (let i = 0; i < n; i += 1) {
    if ((qualityDay[i] ?? 0) > 0) return i;
  }
  return null;
}

/** Mean of every 1s percent in the minute, including 0% and values below 25%. */
export function minuteDensityPercent(
  qualityDay: Uint8Array | undefined,
  minute: number,
  fallback?: AppInputMinuteDto,
): number {
  const first = firstSidecarSecond(qualityDay);
  const minuteStart = minute * 60;
  const useSidecar =
    qualityDay != null && first != null && minuteStart + 59 >= first;

  if (useSidecar && qualityDay && minute >= 0 && minute < 1440) {
    const start = minuteStart;
    const end = Math.min(start + 60, qualityDay.length);
    if (end <= start) return 0;
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += qualityDay[i] ?? 0;
    return sum / (end - start);
  }
  if (fallback?.quality != null && Number.isFinite(fallback.quality)) {
    return Math.min(1, Math.max(0, fallback.quality)) * 100;
  }
  if (fallback) return mixedQuality(fallback) * 100;
  return 0;
}

export function meanDensityInRange(
  qualityDay: Uint8Array | undefined,
  startMinute: number,
  endMinuteExclusive: number,
  minutes: AppInputMinuteDto[],
): number {
  const byMinute = new Map(minutes.map((m) => [m.minuteOfDay, m]));
  let sum = 0;
  let n = 0;
  for (let minute = startMinute; minute < endMinuteExclusive; minute += 1) {
    sum += minuteDensityPercent(qualityDay, minute, byMinute.get(minute));
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

/** Inclusive minute span covering sidecar samples and SQLite minutes. */
export function densityMinuteSpan(
  qualityDay: Uint8Array | undefined,
  minutes: AppInputMinuteDto[],
  throughMinute?: number,
): [number, number] | null {
  let first = 1440;
  let last = -1;
  const sidecarFrom = firstSidecarSecond(qualityDay);
  if (qualityDay && sidecarFrom != null) {
    first = Math.min(first, Math.floor(sidecarFrom / 60));
    for (let i = qualityDay.length - 1; i >= sidecarFrom; i -= 1) {
      if ((qualityDay[i] ?? 0) > 0) {
        last = Math.max(last, Math.floor(i / 60));
        break;
      }
    }
  }
  for (const m of minutes) {
    first = Math.min(first, m.minuteOfDay);
    last = Math.max(last, m.minuteOfDay);
  }
  if (last < 0 || first > last) return null;
  if (throughMinute != null) {
    last = Math.max(last, Math.min(1439, throughMinute));
  }
  return [first, last];
}

export function lastSecondsPercents(
  qualityDay: Uint8Array | undefined,
  secondOfDay: number,
  count: number,
  fallbackSpark01: number[],
): number[] {
  if (qualityDay && secondOfDay >= 0) {
    const out: number[] = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      const idx = secondOfDay - i;
      out.push(
        idx >= 0 && idx < qualityDay.length ? (qualityDay[idx] ?? 0) : 0,
      );
    }
    return out;
  }
  return fallbackSpark01.map((value) => value * 100);
}

export const DENSITY_ZONE = {
  peak: 70,
  good: 45,
  mixed: 25,
} as const;

export type DensityZone = "peak" | "good" | "mixed" | "light";

export function densityZone(pct: number): DensityZone {
  if (pct >= DENSITY_ZONE.peak) return "peak";
  if (pct >= DENSITY_ZONE.good) return "good";
  if (pct >= DENSITY_ZONE.mixed) return "mixed";
  return "light";
}

export const DENSITY_ZONE_META: Record<
  DensityZone,
  { label: string; color: string; hint: string }
> = {
  peak: { label: "Peak density", color: "#10b981", hint: "≥ 70%" },
  good: { label: "Steady work", color: "#3b82f6", hint: "45–69%" },
  mixed: { label: "Light mix", color: "#f59e0b", hint: "25–44%" },
  light: { label: "Low activity", color: "#94a3b8", hint: "< 25%" },
};

export function densityColor(pct: number): string {
  return DENSITY_ZONE_META[densityZone(pct)].color;
}
