import { listen } from "@tauri-apps/api/event";

import { hasTauriRuntime, invokeCommand } from "./api/tauri";
import { QUALITY_LIVE_WINDOW_MS } from "./constants/activityScore";
import type { QualityLiveDto } from "./types/backend";

const QUALITY_LIVE_EVENT = "quality-live://tick";
const SECONDS_PER_DAY = 86_400;

export interface LiveWorkQuality {
  quality: number;
  spark: number[];
  windowMs: number;
  skipActivityPersist: boolean;
  secondOfDay: number;
}

function emptySnapshot(): LiveWorkQuality {
  const slots = Math.max(1, Math.round(QUALITY_LIVE_WINDOW_MS / 1_000));
  return {
    quality: 0,
    spark: Array.from({ length: slots }, () => 0),
    windowMs: QUALITY_LIVE_WINDOW_MS,
    skipActivityPersist: false,
    secondOfDay: 0,
  };
}

function fromDto(dto: QualityLiveDto): LiveWorkQuality {
  const samples = Array.isArray(dto?.samples) ? dto.samples : [];
  const percent = Number(dto?.percent);
  return {
    quality: (Number.isFinite(percent) ? percent : 0) / 100,
    spark: samples.map((value) => (Number(value) || 0) / 100),
    windowMs: Number(dto?.windowMs) || QUALITY_LIVE_WINDOW_MS,
    skipActivityPersist: Boolean(dto?.skipActivityPersist),
    secondOfDay: dto?.secondOfDay ?? 0,
  };
}

let snapshot = emptySnapshot();
let daySamples = new Uint8Array(SECONDS_PER_DAY);
let dayHydrated = false;
const listeners = new Set<(next: LiveWorkQuality) => void>();
let started = false;

function patchDay(dto: QualityLiveDto) {
  const second = dto.secondOfDay;
  if (second == null || dto.samples.length === 0) {
    return;
  }
  const last = dto.samples.length - 1;
  for (let i = 0; i < dto.samples.length; i += 1) {
    const idx = second - (last - i);
    if (idx >= 0 && idx < SECONDS_PER_DAY) {
      daySamples[idx] = dto.samples[i];
    }
  }
}

function apply(dto: QualityLiveDto) {
  try {
    patchDay(dto);
    snapshot = fromDto(dto);
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error("quality-live listener failed", error);
      }
    }
  } catch (error) {
    console.error("quality-live apply failed", error);
  }
}

export function getLiveWorkQualitySnapshot(): LiveWorkQuality {
  return snapshot;
}

export function getQualityDaySnapshot(): Uint8Array {
  return daySamples;
}

export function isQualityDayReady(): boolean {
  return dayHydrated;
}

export function startQualityLiveStore() {
  if (started) {
    return;
  }
  started = true;
  if (!hasTauriRuntime()) {
    return;
  }
  void invokeCommand<QualityLiveDto>("get_quality_live")
    .then(apply)
    .catch(() => {});
  void invokeCommand<number[]>("get_quality_day")
    .then((samples) => {
      const next = new Uint8Array(SECONDS_PER_DAY);
      const n = Math.min(samples.length, SECONDS_PER_DAY);
      for (let i = 0; i < n; i += 1) {
        next[i] = samples[i] ?? 0;
      }
      daySamples = next;
      dayHydrated = true;
      for (const listener of listeners) {
        listener(snapshot);
      }
    })
    .catch(() => {});
  void listen<QualityLiveDto>(QUALITY_LIVE_EVENT, ({ payload }) => {
    apply(payload);
  });
}

export async function refreshQualityLive(): Promise<LiveWorkQuality> {
  if (!hasTauriRuntime()) {
    return snapshot;
  }
  const dto = await invokeCommand<QualityLiveDto>("refresh_quality_live");
  apply(dto);
  try {
    const samples = await invokeCommand<number[]>("get_quality_day");
    const next = new Uint8Array(SECONDS_PER_DAY);
    const n = Math.min(samples.length, SECONDS_PER_DAY);
    for (let i = 0; i < n; i += 1) {
      next[i] = samples[i] ?? 0;
    }
    daySamples = next;
    dayHydrated = true;
    for (const listener of listeners) {
      listener(snapshot);
    }
  } catch {
    // Sidecar read is best-effort; the tick snapshot still applied.
  }
  return snapshot;
}

export function subscribeQualityLive(listener: (next: LiveWorkQuality) => void) {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}
