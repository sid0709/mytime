/**
 * Shared volume-based intensity scoring.
 * Keep in lockstep with `src-tauri/src/activity_score.rs`.
 */
import { STANDARD_APM_MAX } from "./apm";

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

export function bucketIntensity(bucket: {
  keyPresses: number;
  mouseClicks: number;
  scrollEvents: number;
  mouseMoves: number;
}): number {
  return Math.min(STANDARD_APM_MAX, Math.round(volumeScore(bucket)));
}
