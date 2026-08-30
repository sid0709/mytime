import type { LogEntryDto } from "../types/backend";
import { invokeWithFallback } from "./tauri";

const SAMPLE_LOGS: LogEntryDto[] = [
  {
    id: 5,
    timestamp: "2026-06-29T02:24:43.672162Z",
    level: "INFO",
    target: "mytime_lib::input_monitor::macos",
    message: "CGEventTap first callback — tap is live events=0",
  },
  {
    id: 4,
    timestamp: "2026-06-29T02:24:43.108001Z",
    level: "INFO",
    target: "mytime_lib::db",
    message: "SQLite DB initialized",
  },
  {
    id: 3,
    timestamp: "2026-06-29T02:24:42.904551Z",
    level: "WARN",
    target: "mytime_lib::db",
    message: "db WAL checkpoint skipped: database busy",
  },
  {
    id: 2,
    timestamp: "2026-06-29T02:24:42.500119Z",
    level: "INFO",
    target: "mytime_lib",
    message: "system tray icon created",
  },
  {
    id: 1,
    timestamp: "2026-06-29T02:24:42.001000Z",
    level: "INFO",
    target: "mytime_lib",
    message: "initialized foundation paths",
  },
];

export function getRecentLogs(limit = 300) {
  return invokeWithFallback<LogEntryDto[]>("get_recent_logs", SAMPLE_LOGS, {
    limit,
  });
}
