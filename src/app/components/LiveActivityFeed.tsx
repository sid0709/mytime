import { useState, useEffect, useRef } from "react";
import {
  Mouse,
  Keyboard,
  MonitorSmartphone,
  Clock,
  MousePointer2,
} from "lucide-react";

import {
  getRecentInputEvents,
  subscribeToInputMonitorBatch,
} from "../api/inputMonitor";
import type { InputMonitorEventDto } from "../types/backend";
import { hasTauriRuntime } from "../api/tauri";
import { ActivityFeedSkeletonRow } from "./ui/SkeletonRows";

interface ActivityEvent {
  id: number;
  type: "mouse" | "keyboard" | "scroll" | "idle" | "active";
  description: string;
  timestamp: string;
  detail?: string;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toTimeString().slice(0, 8);
}

function inputEventToActivityEvent(
  e: InputMonitorEventDto,
  id: number,
): ActivityEvent {
  const type =
    e.kind === "keyboard"
      ? "keyboard"
      : e.kind === "scroll"
        ? "scroll"
        : "mouse";
  const isMouseMove = e.kind === "mouse" && e.action === "move";
  const isScrollWheel = e.kind === "scroll" && e.action === "wheel";
  let detail: string | undefined;
  if (e.x != null && e.y != null) {
    detail = `(${e.x}, ${e.y})`;
  }
  if (e.direction && !isScrollWheel) {
    detail = detail ? `${detail} scroll ${e.direction}` : `scroll ${e.direction}`;
  }
  return {
    id,
    type,
    description: isMouseMove ? "Mouse Move" : e.label,
    timestamp: formatTime(e.timestamp),
    detail: detail ?? undefined,
  };
}

function shouldMergeWithPreviousEvent(
  previous: ActivityEvent | undefined,
  event: InputMonitorEventDto,
) {
  if (!previous) {
    return false;
  }

  if (event.kind === "mouse" && event.action === "move") {
    return previous.type === "mouse" && previous.description === "Mouse Move";
  }

  if (event.kind === "scroll" && event.action === "wheel") {
    return previous.type === "scroll" && previous.description.startsWith("Scroll ");
  }

  return false;
}

const iconMap = {
  mouse: Mouse,
  keyboard: Keyboard,
  scroll: MousePointer2,
  idle: Clock,
  active: MonitorSmartphone,
};

const colorMap = {
  mouse: { bg: "bg-primary/10", text: "text-primary" },
  keyboard: { bg: "bg-chart-2/10", text: "text-chart-2" },
  scroll: { bg: "bg-violet-500/10", text: "text-violet-400" },
  idle: { bg: "bg-yellow-500/10", text: "text-yellow-400" },
  active: { bg: "bg-emerald-500/10", text: "text-emerald-400" },
};

const MAX_VISIBLE_LOGS = 8;
const SKELETON_ROWS = 6;

export function LiveActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const nextIdRef = useRef(1);

  useEffect(() => {
    if (hasTauriRuntime()) {
      getRecentInputEvents(MAX_VISIBLE_LOGS)
        .then((list) => {
          const seeded = list.slice(0, MAX_VISIBLE_LOGS).map((e) => ({
            id: e.id,
            type: e.eventType,
            description: e.description,
            timestamp: e.timestamp,
            detail: e.detail ?? undefined,
          }));
          setEvents(
            seeded,
          );
          nextIdRef.current =
            seeded.reduce((maxId, event) => Math.max(maxId, event.id), 0) + 1;
        })
        .finally(() => setIsLoading(false));

      const unsub = subscribeToInputMonitorBatch((batch) => {
        setEvents((prev) => {
          let next = prev;
          for (const payload of batch) {
            const id = nextIdRef.current++;
            const activity = inputEventToActivityEvent(payload, id);
            if (shouldMergeWithPreviousEvent(next[0], payload)) {
              const head = next[0];
              next = [{ ...head, ...activity, id: head.id }, ...next.slice(1)];
            } else {
              next = [activity, ...next.slice(0, MAX_VISIBLE_LOGS - 1)];
            }
          }
          return next;
        });
      });
      return () => {
        unsub.then((fn) => fn());
      };
    }

    setEvents([]);
    setIsLoading(false);
    return () => {};
  }, []);

  return (
    <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 flex flex-col max-h-[480px] min-h-0">
      <div className="flex items-center justify-between mb-5 shrink-0">
        <div>
          <h3 className="text-foreground">Live Activity Feed</h3>
          <p className="text-muted-foreground text-xs mt-1">
            Real-time input events
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-400">Live</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-1 overscroll-y-contain pr-1">
        {isLoading ? (
          Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <ActivityFeedSkeletonRow key={`skeleton-${i}`} />
          ))
        ) : (
          events.map((event, index) => {
            const Icon = iconMap[event.type];
            const colors = colorMap[event.type];
            return (
              <div
                key={event.id}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-secondary/50 transition-all duration-200 shrink-0"
                style={{
                  opacity: 1 - index * 0.02,
                }}
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${colors.bg}`}
                >
                  <Icon className={`w-3.5 h-3.5 ${colors.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground truncate">
                    {event.description}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {event.detail}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {event.timestamp}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}