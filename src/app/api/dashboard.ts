import type { DashboardSummaryDto } from "../types/backend";
import { invokeWithFallback } from "./tauri";

function createFallbackSummary(): DashboardSummaryDto {
  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      activeTimeToday: {
        title: "Active Time Today",
        value: "6h 42m",
        change: "+12%",
        trend: "up",
        subtitle: "vs yesterday",
      },
      mouseEvents: {
        title: "Mouse Events",
        value: "14,827",
        change: "+8%",
        trend: "up",
        subtitle: "clicks & movements",
      },
      keystrokes: {
        title: "Keystrokes",
        value: "23,456",
        change: "-3%",
        trend: "down",
        subtitle: "total today",
      },
    },
  };
}

export function getDashboardSummary() {
  return invokeWithFallback<DashboardSummaryDto>(
    "get_dashboard_summary",
    createFallbackSummary,
  );
}
