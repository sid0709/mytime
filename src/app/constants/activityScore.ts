/**
 * Shared volume and effective-intensity scoring.
 * Keep in lockstep with `src-tauri/src/activity_score.rs`.
 */
import type { AppInputMinuteDto } from "../types/backend";
import { STANDARD_APM_MAX } from "./apm";

/** Twin of Rust `BUCKET_INTENSITY_FIXTURE` in `activity_score.rs`. */
export const BUCKET_INTENSITY_FIXTURE = {
  keyPresses: 10,
  mouseClicks: 2,
  scrollEvents: 4,
  mouseMoves: 5,
  quality: 0.5,
  expected: 94,
} as const;

export function volumeScore(bucket: {
  keyPresses: number;
  mouseClicks: number;
  scrollEvents: number;
  mouseMoves: number;
}): number {
  return (
    bucket.keyPresses * 12 +
    bucket.mouseClicks * 10 +
    bucket.scrollEvents * 8 +
    bucket.mouseMoves * 3
  );
}

export function qualityOrOne(quality: number | null | undefined): number {
  if (quality == null || Number.isNaN(quality)) return 1;
  return Math.min(1, Math.max(0, quality));
}

function envUnit(name: string, fallback: number): number {
  const raw = (import.meta.env as Record<string, string | undefined>)[name];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;
}

function envMs(name: string, fallback: number): number {
  const raw = (import.meta.env as Record<string, string | undefined>)[name];
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1_000 && value <= 120_000 ? value : fallback;
}

/** Key+click share of volume below this is treated as browsing/feeds. */
export const QUALITY_HANDS_ON_THRESHOLD = envUnit(
  "QUALITY_HANDS_ON_THRESHOLD",
  0.25,
);
/** Work-quality floor for scroll/move-heavy minutes (social ~40–50%). */
export const QUALITY_BROWSING_TARGET = envUnit("QUALITY_BROWSING_TARGET", 0.45);
/** Live Detection-board window. Idle or unfocused input should show within this. */
export const QUALITY_LIVE_WINDOW_MS = envMs("QUALITY_LIVE_WINDOW_MS", 20_000);
/** 30s-slot mean below this skips activity SQLite writes (not the live sidecar). */
export const QUALITY_PERSIST_MIN = envUnit("QUALITY_PERSIST_MIN", 0.25);

export function handsOnFraction(bucket: {
  keyPresses: number;
  mouseClicks: number;
  scrollEvents: number;
  mouseMoves: number;
}): number {
  const total = volumeScore(bucket);
  if (total === 0) return 1;
  return Math.min(1, Math.max(0, (bucket.keyPresses * 12 + bucket.mouseClicks * 10) / total));
}

export function mixedQuality(
  bucket: {
    keyPresses: number;
    mouseClicks: number;
    scrollEvents: number;
    mouseMoves: number;
    quality?: number | null;
  },
): number {
  const base = qualityOrOne(bucket.quality);
  const fraction = handsOnFraction(bucket);
  const lo = Math.max(0, QUALITY_HANDS_ON_THRESHOLD - 0.04);
  const span = Math.max(1e-6, QUALITY_HANDS_ON_THRESHOLD - lo);
  const t = Math.min(1, Math.max(0, (fraction - lo) / span));
  return QUALITY_BROWSING_TARGET + t * (base - QUALITY_BROWSING_TARGET);
}

export function effectiveScore(
  bucket: {
    keyPresses: number;
    mouseClicks: number;
    scrollEvents: number;
    mouseMoves: number;
    quality?: number | null;
  },
  qualityOverride?: number,
): number {
  const quality =
    qualityOverride !== undefined
      ? qualityOrOne(qualityOverride)
      : qualityOrOne(bucket.quality);
  return Math.min(
    STANDARD_APM_MAX,
    Math.round(volumeScore(bucket) * quality),
  );
}

export function smoothedQuality(
  qualities: Map<number, number>,
  minute: number,
): number {
  let sum = 0;
  let n = 0;
  for (let m = minute - 1; m <= minute + 1; m += 1) {
    const value = qualities.get(m);
    if (value !== undefined) {
      sum += value;
      n += 1;
    }
  }
  return n === 0 ? 1 : sum / n;
}

export function qualitiesByMinute(
  minutes: AppInputMinuteDto[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const bucket of minutes) {
    if (isActiveMinute(bucket)) {
      map.set(bucket.minuteOfDay, mixedQuality(bucket));
    }
  }
  return map;
}

export function isActiveMinute(bucket: AppInputMinuteDto): boolean {
  return (
    bucket.keyPresses > 0 ||
    bucket.mouseClicks > 0 ||
    bucket.mouseMoves > 0 ||
    bucket.scrollEvents > 0
  );
}

export function meanQuality(minutes: AppInputMinuteDto[]): number | null {
  const active = minutes.filter(isActiveMinute);
  if (active.length === 0) return null;
  let weight = 0;
  let sum = 0;
  for (const bucket of active) {
    const volume = Math.max(volumeScore(bucket), 1);
    sum += mixedQuality(bucket) * volume;
    weight += volume;
  }
  return weight === 0 ? null : sum / weight;
}

export function volumeToday(minutes: AppInputMinuteDto[]): number {
  return minutes.reduce((total, bucket) => total + volumeScore(bucket), 0);
}

export function effectiveToday(minutes: AppInputMinuteDto[]): number {
  const qualities = qualitiesByMinute(minutes);
  return minutes.reduce(
    (total, bucket) => total + bucketIntensity(bucket, qualities),
    0,
  );
}

/** Last N active minutes' quality, oldest first, for a sparkline. */
export function qualitySparkline(
  minutes: AppInputMinuteDto[],
  lastN = 40,
): number[] {
  return minutes
    .filter(isActiveMinute)
    .sort((a, b) => a.minuteOfDay - b.minuteOfDay)
    .slice(-lastN)
    .map((bucket) => mixedQuality(bucket));
}

const LOW_QUALITY_MEAN = QUALITY_BROWSING_TARGET;
/** Uncapped day-sum of volumeScore. ~40–60 minutes of mixed hardware input. */
const HIGH_VOLUME_TODAY = 10_000;

export function workQualitySummary(minutes: AppInputMinuteDto[]) {
  const mean = meanQuality(minutes);
  const volume = volumeToday(minutes);
  const effective = effectiveToday(minutes);
  const spark = qualitySparkline(minutes, 40);
  return {
    mean,
    volume,
    effective,
    spark,
    lowVariety: mean != null && mean < LOW_QUALITY_MEAN && volume >= HIGH_VOLUME_TODAY,
  };
}

export function bucketIntensity(
  bucket: AppInputMinuteDto,
  qualities?: Map<number, number>,
): number {
  const quality = qualities
    ? smoothedQuality(qualities, bucket.minuteOfDay)
    : mixedQuality(bucket);
  return effectiveScore(bucket, quality);
}

export function verifyBucketIntensityFixture(): boolean {
  return (
    effectiveScore({
      keyPresses: BUCKET_INTENSITY_FIXTURE.keyPresses,
      mouseClicks: BUCKET_INTENSITY_FIXTURE.mouseClicks,
      scrollEvents: BUCKET_INTENSITY_FIXTURE.scrollEvents,
      mouseMoves: BUCKET_INTENSITY_FIXTURE.mouseMoves,
      quality: BUCKET_INTENSITY_FIXTURE.quality,
    }) === BUCKET_INTENSITY_FIXTURE.expected
  );
}

if (!verifyBucketIntensityFixture()) {
  throw new Error(
    "bucket intensity fixture drifted from src-tauri/src/activity_score.rs",
  );
}
