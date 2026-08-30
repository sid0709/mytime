// ============================================================
// Shared data types and mock data for the Timeline Editor
// ============================================================

export interface TimelineBlock {
  id: string;
  app: string;
  title: string;
  startMin: number; // minutes from midnight
  endMin: number;
  color: string;
  icon: string;
  iconDataUrl?: string | null;
  category: string;
  keystrokes: number;
  clicks: number;
  selected?: boolean;
  tag?: string;
}

export interface APMDataPoint {
  minute: number;
  apm: number; // 0–250 effective intensity (volume × quality)
  volume?: number;
  quality?: number | null;
  type: "reading" | "mouse" | "typing";
}

export interface TimelineMarker {
  id: string;
  minute: number;
  type: "idle";
  label: string;
  duration?: number;
}

export interface GhostBlock {
  app: string;
  startMin: number;
  endMin: number;
  color: string;
}

export interface ActivityStatus {
  startMin: number;
  endMin: number;
  status: "active" | "inactive" | "shutdown";
}

// App color map
export const APP_COLORS: Record<string, string> = {
  "VS Code": "#007acc",
  "Google Chrome": "#4caf50",
  Slack: "#611f69",
  Figma: "#a259ff",
  Terminal: "#2d2d2d",
  Spotify: "#1db954",
  "Microsoft Word": "#2b579a",
  "Microsoft Outlook": "#0078d4",
  Discord: "#5865f2",
  Notion: "#000000",
  YouTube: "#ff0000",
  "System Idle": "#3a3a4a",
  Postman: "#ff6c37",
  Docker: "#2496ed",
  Firefox: "#ff7139",
  Zoom: "#2d8cff",
};

export const APP_ICONS: Record<string, string> = {
  "VS Code": "💻",
  "Google Chrome": "🌐",
  Slack: "💬",
  Figma: "🎨",
  Terminal: "⬛",
  Spotify: "🎵",
  "Microsoft Word": "📝",
  "Microsoft Outlook": "📧",
  Discord: "🎮",
  Notion: "📓",
  YouTube: "📺",
  "System Idle": "💤",
  Postman: "📮",
  Docker: "🐳",
  Firefox: "🦊",
  Zoom: "📹",
};

// Generate a full day of mock timeline blocks (7am-9pm)
export function generateTimelineBlocks(): TimelineBlock[] {
  const apps = [
    { app: "VS Code", category: "Development", weight: 35 },
    { app: "Google Chrome", category: "Browser", weight: 20 },
    { app: "Slack", category: "Communication", weight: 12 },
    { app: "Figma", category: "Design", weight: 8 },
    { app: "Terminal", category: "Development", weight: 7 },
    { app: "Spotify", category: "Entertainment", weight: 4 },
    { app: "Microsoft Outlook", category: "Communication", weight: 5 },
    { app: "Notion", category: "Productivity", weight: 4 },
    { app: "YouTube", category: "Entertainment", weight: 3 },
    { app: "System Idle", category: "Idle", weight: 2 },
  ];

  const blocks: TimelineBlock[] = [];
  let currentMin = 7 * 60; // start at 7 AM
  const endOfDay = 21 * 60; // end at 9 PM
  let id = 0;

  while (currentMin < endOfDay) {
    // Pick a weighted random app
    const totalWeight = apps.reduce((s, a) => s + a.weight, 0);
    let r = Math.random() * totalWeight;
    let chosen = apps[0];
    for (const a of apps) {
      r -= a.weight;
      if (r <= 0) {
        chosen = a;
        break;
      }
    }

    // Duration: 3-90 min, with some micro-blocks
    const duration =
      Math.random() > 0.85
        ? 1 + Math.floor(Math.random() * 4) // micro block
        : 5 + Math.floor(Math.random() * 85);

    const endMin = Math.min(currentMin + duration, endOfDay);

    const titles: Record<string, string[]> = {
      "VS Code": [
        "App.tsx — activity-tracker",
        "index.ts — api-server",
        "timeline.tsx — components",
        "utils.ts — helpers",
        "package.json",
      ],
      "Google Chrome": [
        "Stack Overflow - React hooks",
        "GitHub - Pull Request #142",
        "MDN Web Docs - Canvas API",
        "Google Search - tailwind css",
        "Vercel Dashboard",
      ],
      Slack: [
        "#engineering - Thread",
        "#design-review - New mockups",
        "DM with Sarah",
        "#general - Standup",
      ],
      Figma: [
        "Dashboard Redesign v3",
        "Component Library",
        "User Flow Diagram",
      ],
      Terminal: [
        "npm run dev",
        "git log --oneline",
        "docker-compose up",
        "ssh production-server",
      ],
      Spotify: ["Lofi Hip Hop Radio", "Focus Playlist", "Coding Music Mix"],
      "Microsoft Outlook": [
        "RE: Project Update",
        "Meeting: Sprint Review",
        "FW: Design Feedback",
      ],
      Notion: [
        "Sprint Backlog",
        "Meeting Notes - March 9",
        "Technical Spec v2",
      ],
      YouTube: [
        "Fireship - 100 seconds of...",
        "Theo - Next.js deep dive",
        "Conference Talk: React 2026",
      ],
      "System Idle": ["System Idle"],
    };

    const appTitles = titles[chosen.app] || [chosen.app];
    const title = appTitles[Math.floor(Math.random() * appTitles.length)];

    blocks.push({
      id: `block-${id++}`,
      app: chosen.app,
      title,
      startMin: currentMin,
      endMin,
      color: APP_COLORS[chosen.app] || "#666",
      icon: APP_ICONS[chosen.app] || "📦",
      category: chosen.category,
      keystrokes: Math.round(
        (endMin - currentMin) * (chosen.app === "VS Code" ? 45 : 12) +
          Math.random() * 200
      ),
      clicks: Math.round(
        (endMin - currentMin) * 3 + Math.random() * 50
      ),
    });

    currentMin = endMin;
  }

  return blocks;
}

// Generate APM (input heatmap) data
export function generateAPMData(): APMDataPoint[] {
  const data: APMDataPoint[] = [];
  for (let m = 7 * 60; m < 21 * 60; m++) {
    const hour = m / 60;
    const morningBoost = Math.exp(-Math.pow(hour - 10.5, 2) / 2) * 40;
    const afternoonBoost = Math.exp(-Math.pow(hour - 14.5, 2) / 2.5) * 30;
    const base = 15 + morningBoost + afternoonBoost;
    const apm = Math.max(0, Math.round(base + (Math.random() - 0.5) * 25));

    let type: APMDataPoint["type"] = "reading";
    if (apm > 60) type = "typing";
    else if (apm > 25) type = "mouse";

    data.push({ minute: m, apm, type });
  }
  return data;
}

// Generate event markers
export function generateMarkers(): TimelineMarker[] {
  return [
    {
      id: "m1",
      minute: 8 * 60 + 15,
      type: "idle",
      label: "System went idle for 8 mins",
      duration: 8,
    },
    {
      id: "m3",
      minute: 12 * 60 + 5,
      type: "idle",
      label: "Lunch break — idle for 52 mins",
      duration: 52,
    },
    {
      id: "m6",
      minute: 18 * 60 + 45,
      type: "idle",
      label: "System went idle for 12 mins",
      duration: 12,
    },
  ];
}

// Ghost (yesterday) data
export function generateGhostBlocks(): GhostBlock[] {
  const apps = ["VS Code", "Google Chrome", "Slack", "Figma", "Terminal", "System Idle"];
  const blocks: GhostBlock[] = [];
  let currentMin = 7 * 60;
  while (currentMin < 21 * 60) {
    const app = apps[Math.floor(Math.random() * apps.length)];
    const duration = 10 + Math.floor(Math.random() * 80);
    const endMin = Math.min(currentMin + duration, 21 * 60);
    blocks.push({
      app,
      startMin: currentMin,
      endMin,
      color: APP_COLORS[app] || "#666",
    });
    currentMin = endMin;
  }
  return blocks;
}

// Generate activity status track data
export function generateActivityStatus(): ActivityStatus[] {
  const statuses: ActivityStatus[] = [];
  let currentMin = 7 * 60;
  const endOfDay = 21 * 60;

  // Morning active 7:00-8:15
  statuses.push({ startMin: currentMin, endMin: 8 * 60 + 15, status: "active" });
  // Brief inactive 8:15-8:23
  statuses.push({ startMin: 8 * 60 + 15, endMin: 8 * 60 + 23, status: "inactive" });
  // Active 8:23-10:42
  statuses.push({ startMin: 8 * 60 + 23, endMin: 10 * 60 + 42, status: "active" });
  // Inactive 10:42-10:50
  statuses.push({ startMin: 10 * 60 + 42, endMin: 10 * 60 + 50, status: "inactive" });
  // Active 10:50-12:05
  statuses.push({ startMin: 10 * 60 + 50, endMin: 12 * 60 + 5, status: "active" });
  // Lunch break — shutdown 12:05-12:57
  statuses.push({ startMin: 12 * 60 + 5, endMin: 12 * 60 + 57, status: "shutdown" });
  // Active 12:57-14:30
  statuses.push({ startMin: 12 * 60 + 57, endMin: 14 * 60 + 30, status: "active" });
  // Brief inactivity 14:30-14:32
  statuses.push({ startMin: 14 * 60 + 30, endMin: 14 * 60 + 32, status: "inactive" });
  // Active 14:32-16:18
  statuses.push({ startMin: 14 * 60 + 32, endMin: 16 * 60 + 18, status: "active" });
  // Inactive 16:18-16:24
  statuses.push({ startMin: 16 * 60 + 18, endMin: 16 * 60 + 24, status: "inactive" });
  // Active 16:24-18:45
  statuses.push({ startMin: 16 * 60 + 24, endMin: 18 * 60 + 45, status: "active" });
  // Idle 18:45-18:57
  statuses.push({ startMin: 18 * 60 + 45, endMin: 18 * 60 + 57, status: "inactive" });
  // Active 18:57-20:30
  statuses.push({ startMin: 18 * 60 + 57, endMin: 20 * 60 + 30, status: "active" });
  // Shutdown 20:30-21:00
  statuses.push({ startMin: 20 * 60 + 30, endMin: endOfDay, status: "shutdown" });

  return statuses;
}

// Helper
export function formatMinutes(mins: number): string {
  const totalSeconds = Math.max(0, Math.round(mins * 60));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  if (s === 0) {
    return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
  }
  return `${h12}:${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")} ${ampm}`;
}

export function formatDuration(mins: number): string {
  const totalSeconds = Math.max(1, Math.round(mins * 60));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h === 0) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  if (s === 0) return `${h}h ${m}m`;
  return `${h}h ${m}m ${s}s`;
}
