import { listen } from "@tauri-apps/api/event";

import type {
  InputMonitorEventDto,
  InputMonitorStatusDto,
  LiveFeedEventDto,
} from "../types/backend";
import { hasTauriRuntime } from "./tauri";
import { invokeCommand } from "./tauri";

const INPUT_MONITOR_BATCH_EVENT = "input-monitor://batch";

/**
 * Subscribe to coalesced input-event batches.
 *
 * The backend buffers raw events and dispatches them as arrays (~12/sec max) to keep the
 * WebView bridge from being flooded. Process the whole batch in one pass so React collapses
 * it into a single render.
 */
export async function subscribeToInputMonitorBatch(
  handler: (events: InputMonitorEventDto[]) => void,
) {
  if (!hasTauriRuntime()) {
    return () => {};
  }

  return listen<InputMonitorEventDto[]>(
    INPUT_MONITOR_BATCH_EVENT,
    ({ payload }) => {
      if (payload.length > 0) {
        handler(payload);
      }
    },
  );
}

export async function getRecentInputEvents(
  limit?: number,
): Promise<LiveFeedEventDto[]> {
  if (!hasTauriRuntime()) {
    return [];
  }
  return invokeCommand<LiveFeedEventDto[]>("get_recent_input_events", {
    limit: limit ?? 50,
  });
}

export async function getInputMonitorStatus(): Promise<InputMonitorStatusDto | null> {
  if (!hasTauriRuntime()) {
    return null;
  }
  return invokeCommand<InputMonitorStatusDto>("get_input_monitor_status");
}

export async function requestInputMonitorPermission(): Promise<boolean> {
  if (!hasTauriRuntime()) {
    return false;
  }
  return invokeCommand<boolean>("request_input_monitor_permission");
}

export async function openInputMonitorSettings(): Promise<void> {
  if (!hasTauriRuntime()) {
    return;
  }
  await invokeCommand<void>("open_input_monitor_settings");
}
