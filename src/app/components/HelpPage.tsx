import { useState } from "react";
import {
  Copy,
  Check,
  LayoutDashboard,
  Activity,
  ChevronDown,
  ChevronRight,
  HelpCircle,
} from "lucide-react";

import { ApiServerSettings } from "./ApiServerSettings";

interface HelpSection {
  id: string;
  view: string;
  viewIcon: React.ReactNode;
  cards: { title: string; description: string }[];
}

const helpData: HelpSection[] = [
  {
    id: "dashboard",
    view: "Dashboard",
    viewIcon: <LayoutDashboard className="w-4 h-4" />,
    cards: [
      {
        title: "Live Pulse Strip",
        description:
          "A real-time horizontal strip of **work density** (0–100%), not actions-per-minute. The left reading is the last 20 seconds of 1-second quality. Bar height is that same percent — high activity is tall, 5% is short, and values below 25% are still drawn. The pulse covers the last 120 minutes on an absolute 0–100% scale.",
      },
      {
        title: "Detection Board",
        description:
          "The compact strip under Live Pulse is the live view of Layer 1 (hardware vs remote/injected) and Layer 2 (varied work vs one-channel volume). Each active second is **0.65 × LZ76 entropy rate + 0.35 × permutation entropy** of the last `QUALITY_LIVE_WINDOW_MS` (default 20s) of action symbols — not a 0 / 45 / 100 mix. Idle seconds are 0%. The headline is the mean of those 1-second percents and never a dash. The chart is a **smooth density line** of the last 60 one-second values. Leaving Dashboard does not reset the strip. **Refresh** flushes today's sidecar file. Activity Tracker shows the same board above its stat cards.",
      },
      {
        title: "Stat Cards (Top Row)",
        description:
          "Three summary cards display the key daily activity metrics: **Active Time Today** (minutes containing hardware activity), **Mouse Events** (cumulative clicks and movements), and **Keystrokes** (total physical key presses).",
      },
      {
        title: "Hardware & Focus Correlator",
        description:
          "A full-width density chart of today's 1-second work quality. **Density** is the mean of those percents (0–100%), including idle and anything below 25% — nothing is omitted or snapped to 0/25/100.\n\n- **Day view**: A smooth area line of every minute from first signal through now. Height is density. Reference lines mark 70% (peak), 45% (steady), and 25% (light).\n- **Blocks view**: 15-minute means as dots on a time × density grid, colored by the same bands.\n\nFour zone cards show how much of the day sat in each band. Insights use peak and average **percent**, never actions-per-minute.",
      },
      {
        title: "Activity Timeline (Dashboard)",
        description:
          "A stacked bar chart showing **active vs. inactive time** over a selectable date range using the **PremiumDateRangePicker**. Each bar represents either a day (showing hours out of 24) or an hour (showing minutes out of 60) depending on the range length. Active bars are color-coded by intensity: green for high activity, indigo for moderate, yellow for low, and red for minimal. Inactive time is shown as a faint red overlay stacking to the full 24h/60m. A dashed average reference line and a rich tooltip with activity rate percentage provide context.\n\nFor single-day views, the chart switches to hourly granularity (minutes per hour). For ranges over 31 days, data aggregates into weekly averages.",
      },
      {
        title: "Input Monitor",
        description:
          "An animated SVG visualization of keyboard and mouse hardware. The keyboard displays a full ANSI layout with keys that glow indigo when pressed — an **Other** key represents unmapped/special keys. The mouse shows left/right click zones with press animations, and a scroll wheel that lights up cyan with directional arrows for scroll up/down events. A mini event log at the bottom shows the 4 most recent input actions.",
      },
    ],
  },
  {
    id: "activity",
    view: "Activity Tracker",
    viewIcon: <Activity className="w-4 h-4" />,
    cards: [
      {
        title: "Hardware-Only Input Policy",
        description:
          "Activity is counted only when the operating system identifies keyboard or mouse input as originating from physical hardware **and** the session is a local console (not a remote or virtual-HID session). The Detection board on Dashboard and Activity is the live view of this policy and of work quality.\n\n**Layer 1a — injected input:** Windows discards events with `LLKHF_INJECTED` / `LLMHF_INJECTED` (SendInput, `mouse_event`, `keybd_event`, regardless of language). macOS accepts only HID-system events without a user-space source process.\n\n**Layer 1b — remote / virtual HID:** On Windows, input is ignored during an OS remote session (`SM_REMOTESESSION` / `SM_REMOTECONTROL`), when RDP-style enumerators are present, or when only software/virtual HID devices exist. Product names are never used. A leftover mirror adapter, even with a ROOT-enumerated HID, does not pause counting while a physical keyboard or mouse is present. On macOS the gate is session-only (`kCGSSessionOnConsoleKey`); HID-class detection is not used, and Screen Sharing the active console is not detected.\n\nForeground-window polling does not write app sessions to SQLite unless accepted hardware was seen in the last 30 seconds. Remote or idle window changes stay in RAM for the live UI only.\n\n**Known limits:** RDP Wrapper (concurrent console + RDP), remote tools that inject through the physical HID stack, USB gadgets that enumerate as real USB, and Windows remotes that leave a physical HID visible while adding only a mirror + ROOT HID. Kernel drivers, Arduino HID, and database/binary tampering are out of scope.",
      },
      {
        title: "Work quality vs presence",
        description:
          "Active **time** is still presence: any accepted hardware input plus a 30-second grace period. The **Focus Correlator**, live pulse, and Detection board plot **density** from 1-second LZ76 samples: `0.65 · c(n)·log_5(n)/n + 0.35 · permutation entropy` over the last 20s of action symbols. Idle is 0%. One-channel scroll or keys score from that formula (often well below 45%); mixed work scores higher. STATUS and the weekly heatmap still treat below 25% as inactive for persist/green.\n\nLive quality is collected in the backend (not per-tab) and flushed every 30s to a sidecar next to the database (`quality-live/quality-YYYY-MM-DD.bin`), not SQLite. Idle-heavy 30s slots whose mean is below `QUALITY_PERSIST_MIN` (default 0.25) skip activity DB writes (`skipActivityPersist`). The live board and sidecar still record those percents, including 5%.\n\nSparse windows (fewer than 12 symbols) scale the same formula instead of snapping to 100%. Quality on persisted minutes is still omitted when too short (`null` in SQLite).\n\n**Limitation:** a metronomic mix of two action types (for example key, click, key, click) can still look diverse; Layer 2 is for monotonous human behavior, not adversarial bots.",
      },
      {
        title: "Stat Cards (Activity)",
        description:
          "Four summary cards: **Total Active Time** (cumulative detected activity), **Mouse Clicks** (click count with trend), **Keystrokes/Min** (typing speed metric), and **Idle Periods** (number of detected idle gaps). Each includes a change indicator showing improvement or decline.",
      },
      {
        title: "Multi-Track Timeline Editor",
        description:
          "A ManicTime-style multi-track timeline editor that visualizes your day across multiple synchronized tracks:\n\n- **Activity Status Track**: Green when 1-second work quality is at least 25%; red for idle or low-quality seconds in the day's span; dark gray for shutdown. Sub-minute gaps match the sidecar, not a whole green minute.\n- **App Usage Track**: Horizontal bars representing which applications were in focus and for how long.\n- **Input Heatmap Track**: Height is the share of seconds in view with quality ≥ 25% (sidecar). Falls back to per-minute APM if the sidecar is not loaded.\n\nFeatures a minimap navigator at the bottom with a draggable viewing window instead of a traditional scrollbar. Zoom is controlled via the mouse wheel (up to 64×), with track visibility toggles and a zoom-level indicator in the toolbar.",
      },
      {
        title: "App Usage Breakdown (Sunburst Chart)",
        description:
          "A hierarchical sunburst visualization showing application usage organized by category. The inner ring displays categories (e.g., Development, Communication, Browsing) and the outer ring breaks down into specific applications (e.g., VS Code, Slack, Chrome). Click on segments to drill down into subcategories. Uses real application names for authentic representation.\n\nIncludes a **Category Manager Modal** (accessible via a gear icon) that provides:\n- A spring-animated modal for viewing and reassigning apps between categories\n- Adding, editing, and deleting categories with color pickers\n- A non-removable **Others** default category that catches unassigned apps\n- Uses the custom **PremiumSelect** dropdown component with portal-based rendering to escape parent `overflow-hidden` containers",
      },
      {
        title: "Live Activity Feed",
        description:
          "A bounded real-time feed of recent input events. Mouse movement and scrolling bursts are merged, and only the eight newest entries are kept so the feed remains lightweight during long sessions.",
      },
      {
        title: "Activity Timeline (Activity Page)",
        description:
          "The same active vs. inactive stacked bar chart as on the Dashboard, with its own independent date range selection. Placed in a stretch-matched row alongside the Activity Heatmap for comparative analysis.",
      },
      {
        title: "Activity Heatmap",
        description:
          "An 8-row grid: the last 7 days plus a blank **tomorrow** row, so the second-to-last row is always today. Each cell is one hour (24 per day), drawn as a square. Color is the share of seconds in that hour with work quality at or above 25%. Seconds below 25% are not counted.",
      },
    ],
  },
  {
    id: "ui-design",
    view: "UI & Design System",
    viewIcon: <HelpCircle className="w-4 h-4" />,
    cards: [
      {
        title: "Dark / Light Theme Toggle",
        description:
          "A theme toggle button in the top header bar switches between dark and light modes. The toggle uses CSS custom properties defined in `/src/styles/theme.css` and applies globally via a `data-theme` attribute. Animated with Motion spring transitions and icon rotation (Sun/Moon icons).",
      },
      {
        title: "Sidebar Navigation",
        description:
          "An animated sidebar with 5 navigable views: **Dashboard**, **Activity Tracker**, **System Logs**, **Changes**, and **Help & Documentation**. Features micro-animations on hover and selection including scale springs, glow effects, and sliding active indicators. On mobile (`<lg`), the sidebar collapses into a fixed bottom navigation bar with compact icons.",
      },
      {
        title: "Glass-Effect Top Bar",
        description:
          "A frosted-glass header bar with `backdrop-blur-sm` and a semi-transparent background. It displays the current page icon, title, subtitle, last-updated time, and theme toggle.",
      },
      {
        title: "Changes",
        description:
          "The **Changes** view lists every shipped minor version from `CHANGELOG.md` (newest first). Policy: `.cursor/VERSIONING.md`. Any change that ships in a release bumps MINOR and adds a bullet here in the same change set.",
      },
      {
        title: "Automatic updates",
        description:
          "Packaged builds check GitHub Releases a few seconds after launch, then about every six hours. When a newer version is published, a modal offers **Update now** or **Later**. Update now downloads the signed installer, verifies it, strips macOS Gatekeeper quarantine, and restarts MyTime. Later hides the prompt until the next launch. Development (`tauri dev`) does not check for updates.\n\n**macOS (no Apple Developer account):** install with `curl -fsSL https://github.com/sid0709/mytime/releases/latest/download/install-macos.sh | bash`. That copies the app and clears quarantine. You still need to allow **Input Monitoring** in System Settings. In-app updates clear quarantine automatically so the next launch should not say the app is damaged.",
      },
      {
        title: "PremiumDateRangePicker",
        description:
          "A custom date range picker for the Activity Timeline. It uses a portal-rendered dropdown (`createPortal` to `document.body`) with fixed positioning so it can escape parent overflow containers. It includes a selected-range summary, calendar navigation, range styling, quick presets, and dynamic repositioning.",
      },
      {
        title: "PremiumSelect",
        description:
          "A custom select dropdown component used in the Category Manager Modal, replacing native `<select>` elements. Renders its dropdown via `createPortal` to `document.body` with `fixed` positioning to escape parent `overflow-hidden` containers. Features smooth open/close animations, search filtering, and keyboard navigation.",
      },
      {
        title: "Infinite Scroll & Skeleton Loading",
        description:
          "A shared **useInfiniteScroll** hook and **SkeletonRows** component in `/src/app/components/ui/` provide consistent infinite-scroll behavior with skeleton placeholder rows during loading, including the Live Activity Feed and application lists.",
      },
      {
        title: "Responsive Design",
        description:
          "Full responsiveness pass across all views. The sidebar collapses to a bottom nav on mobile (`<lg`). App.tsx grids use responsive breakpoints (`grid-cols-1 lg:grid-cols-2`, etc.). Components use responsive padding (`p-4 sm:p-6`), wrapping headers (`flex-col sm:flex-row`), and horizontal scroll wrappers for dense content. A key CSS Grid fix pattern adds `min-w-0` on grid children to prevent Recharts `ResponsiveContainer` from expanding beyond `1fr` tracks.",
      },
    ],
  },
];

function generateMarkdown(): string {
  let md = "# MyTime Activity Tracker — Help Guide\n\n";
  md +=
    "A comprehensive reference for all views, cards, widgets, and UI components in the application.\n\n";
  md += "---\n\n";

  for (const section of helpData) {
    md += `## ${section.view}\n\n`;
    for (const card of section.cards) {
      md += `### ${card.title}\n\n`;
      md += `${card.description}\n\n`;
    }
    md += "---\n\n";
  }

  md += `*Generated on ${new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })}*\n`;

  return md;
}

export function HelpPage() {
  const [copied, setCopied] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(helpData.map((s) => s.id))
  );

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyAll = async () => {
    const md = generateMarkdown();
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = md;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-foreground text-xl">Help & Documentation</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Complete reference for all views, cards, widgets, and UI components
            in this application.
          </p>
        </div>
        <button
          onClick={handleCopyAll}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-sm transition-all duration-200 shrink-0 cursor-pointer ${
            copied
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
              : "bg-secondary hover:bg-secondary/80 text-foreground border border-border"
          }`}
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              Copy All as Markdown
            </>
          )}
        </button>
      </div>

      <ApiServerSettings />

      {/* Sections */}
      {helpData.map((section) => {
        const isExpanded = expandedSections.has(section.id);
        return (
          <div
            key={section.id}
            className="bg-card rounded-2xl border border-border overflow-hidden"
          >
            {/* Section header */}
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center gap-3 p-4 sm:p-5 hover:bg-secondary/30 transition-colors cursor-pointer"
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                {section.viewIcon}
              </div>
              <div className="flex-1 text-left">
                <h3 className="text-foreground">{section.view}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {section.cards.length} components
                </p>
              </div>
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>

            {/* Cards list */}
            {isExpanded && (
              <div className="border-t border-border">
                {section.cards.map((card, idx) => (
                  <div
                    key={card.title}
                    className={`px-4 sm:px-5 py-3 sm:py-4 ${
                      idx < section.cards.length - 1
                        ? "border-b border-border/50"
                        : ""
                    }`}
                  >
                    <h4 className="text-foreground text-sm mb-2 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-secondary text-muted-foreground flex items-center justify-center text-[10px] shrink-0">
                        {idx + 1}
                      </span>
                      {card.title}
                    </h4>
                    <p className="text-muted-foreground text-xs leading-relaxed pl-7 whitespace-pre-line">
                      {card.description.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
                        if (part.startsWith("**") && part.endsWith("**")) {
                          return (
                            <span key={i} className="text-foreground">
                              {part.slice(2, -2)}
                            </span>
                          );
                        }
                        return part;
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Footer note */}
      <div className="text-center py-4">
        <p className="text-xs text-muted-foreground">
          The desktop app records real activity locally. Use the Remote API section above
          to expose read-only JSON endpoints for a central dashboard on your LAN.
        </p>
      </div>
    </div>
  );
}
