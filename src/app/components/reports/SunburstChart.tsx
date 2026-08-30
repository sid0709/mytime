import { useState, useMemo, useCallback, useEffect } from "react";
import { PieChart, ArrowLeft, Settings2 } from "lucide-react";
import {
  CategoryManagerModal,
  type AppEntry,
  type Category,
} from "./CategoryManagerModal";
import { getAppVisualMeta } from "../../activityAppUsage";
import {
  loadSunburstSettings,
  saveSunburstSettings,
} from "../../api/sunburstSettings";

// --- All known apps (flat list) ---
const ALL_APPS: AppEntry[] = [
  { id: "app-vscode", name: "VS Code", color: "#007acc", minutes: 108 },
  { id: "app-terminal", name: "Terminal", color: "#2d2d2d", minutes: 34 },
  { id: "app-postman", name: "Postman", color: "#ff6c37", minutes: 22 },
  {
    id: "app-docker",
    name: "Docker Desktop",
    color: "#2496ed",
    minutes: 12,
  },
  { id: "app-datagrip", name: "DataGrip", color: "#22d18a", minutes: 9 },
  { id: "app-chrome", name: "Chrome", color: "#4caf50", minutes: 52 },
  { id: "app-firefox", name: "Firefox", color: "#ff7139", minutes: 24 },
  { id: "app-edge", name: "Edge", color: "#0078d7", minutes: 18 },
  { id: "app-slack", name: "Slack", color: "#611f69", minutes: 28 },
  { id: "app-zoom", name: "Zoom", color: "#2d8cff", minutes: 14 },
  { id: "app-teams", name: "Teams", color: "#6264a7", minutes: 11 },
  { id: "app-discord", name: "Discord", color: "#5865f2", minutes: 9 },
  { id: "app-figma", name: "Figma", color: "#a259ff", minutes: 32 },
  { id: "app-photoshop", name: "Photoshop", color: "#31a8ff", minutes: 10 },
  { id: "app-blender", name: "Blender", color: "#ea7600", minutes: 6 },
  { id: "app-notion", name: "Notion", color: "#000000", minutes: 14 },
  { id: "app-outlook", name: "Outlook", color: "#0078d4", minutes: 10 },
  { id: "app-explorer", name: "Explorer", color: "#f0c040", minutes: 8 },
  { id: "app-onenote", name: "OneNote", color: "#7719aa", minutes: 6 },
  { id: "app-spotify", name: "Spotify", color: "#1db954", minutes: 12 },
  { id: "app-youtube", name: "YouTube", color: "#ff0000", minutes: 7 },
  { id: "app-vlc", name: "VLC", color: "#ff8800", minutes: 3 },
  { id: "app-git-gui", name: "Git GUI", color: "#f05032", minutes: 5 },
  {
    id: "app-sublime",
    name: "Sublime Text",
    color: "#ff9800",
    minutes: 4,
  },
  {
    id: "app-notepad",
    name: "Notepad++",
    color: "#90ee90",
    minutes: 3,
  },
  {
    id: "app-obs",
    name: "OBS Studio",
    color: "#302e2b",
    minutes: 8,
  },
  {
    id: "app-calc",
    name: "Calculator",
    color: "#607d8b",
    minutes: 2,
  },
  {
    id: "app-settings",
    name: "System Settings",
    color: "#78909c",
    minutes: 4,
  },
];

// --- Default categories ---
const DEFAULT_CATEGORIES: Category[] = [
  { id: "cat-dev", name: "Development", color: "#6366f1" },
  { id: "cat-browse", name: "Browsing", color: "#22d3ee" },
  { id: "cat-comm", name: "Communication", color: "#a78bfa" },
  { id: "cat-design", name: "Design", color: "#f97316" },
  { id: "cat-productivity", name: "Productivity", color: "#34d399" },
  { id: "cat-media", name: "Media", color: "#ef4444" },
  { id: "cat-others", name: "Others", color: "#64748b", isDefault: true },
];

// --- Default assignments ---
const DEFAULT_ASSIGNMENTS: Record<string, string> = {
  "app-vscode": "cat-dev",
  "app-terminal": "cat-dev",
  "app-postman": "cat-dev",
  "app-docker": "cat-dev",
  "app-datagrip": "cat-dev",
  "app-git-gui": "cat-dev",
  "app-sublime": "cat-dev",
  "app-chrome": "cat-browse",
  "app-firefox": "cat-browse",
  "app-edge": "cat-browse",
  "app-slack": "cat-comm",
  "app-zoom": "cat-comm",
  "app-teams": "cat-comm",
  "app-discord": "cat-comm",
  "app-figma": "cat-design",
  "app-photoshop": "cat-design",
  "app-blender": "cat-design",
  "app-notion": "cat-productivity",
  "app-outlook": "cat-productivity",
  "app-explorer": "cat-productivity",
  "app-onenote": "cat-productivity",
  "app-spotify": "cat-media",
  "app-youtube": "cat-media",
  "app-vlc": "cat-media",
  "app-obs": "cat-media",
  "app-notepad": "cat-others",
  "app-calc": "cat-others",
  "app-settings": "cat-others",
};

function getCategoryIdForApp(app: AppEntry) {
  const category = getAppVisualMeta(app.id, app.name).category;
  switch (category) {
    case "Development":
      return "cat-dev";
    case "Browsing":
      return "cat-browse";
    case "Communication":
      return "cat-comm";
    case "Design":
      return "cat-design";
    case "Productivity":
      return "cat-productivity";
    case "Media":
      return "cat-media";
    default:
      return "cat-others";
  }
}

function buildDefaultAssignments(apps: AppEntry[]) {
  const merged: Record<string, string> = { ...DEFAULT_ASSIGNMENTS };
  apps.forEach((app) => {
    if (!(app.id in merged)) {
      merged[app.id] = getCategoryIdForApp(app);
    }
  });
  return merged;
}

function sanitizeCategorySettings(
  categories: Category[],
  assignments: Record<string, string>,
  apps: AppEntry[],
) {
  const seenIds = new Set<string>();
  const sanitizedCategories = categories.filter((category) => {
    if (!category.id.trim() || seenIds.has(category.id)) {
      return false;
    }
    seenIds.add(category.id);
    return true;
  });

  if (!sanitizedCategories.some((category) => category.id === "cat-others")) {
    const others = DEFAULT_CATEGORIES.find((category) => category.id === "cat-others");
    if (others) {
      sanitizedCategories.push(others);
    }
  }

  const validCategoryIds = new Set(sanitizedCategories.map((category) => category.id));
  const sanitizedAssignments = buildDefaultAssignments(apps);

  apps.forEach((app) => {
    const assignedCategory = assignments[app.id];
    sanitizedAssignments[app.id] =
      assignedCategory && validCategoryIds.has(assignedCategory)
        ? assignedCategory
        : sanitizedAssignments[app.id] ?? "cat-others";
  });

  return {
    categories: sanitizedCategories,
    assignments: sanitizedAssignments,
  };
}

// --- Types & Helpers ---

interface SunburstNode {
  id: string;
  name: string;
  color: string;
  minutes: number;
  children?: SunburstNode[];
}

function describeArc(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number
): string {
  const clampedEnd = Math.min(endAngle, startAngle + 359.99);
  const startRad = ((startAngle - 90) * Math.PI) / 180;
  const endRad = ((clampedEnd - 90) * Math.PI) / 180;

  const x1Outer = cx + outerR * Math.cos(startRad);
  const y1Outer = cy + outerR * Math.sin(startRad);
  const x2Outer = cx + outerR * Math.cos(endRad);
  const y2Outer = cy + outerR * Math.sin(endRad);

  const x1Inner = cx + innerR * Math.cos(endRad);
  const y1Inner = cy + innerR * Math.sin(endRad);
  const x2Inner = cx + innerR * Math.cos(startRad);
  const y2Inner = cy + innerR * Math.sin(startRad);

  const largeArc = clampedEnd - startAngle > 180 ? 1 : 0;

  return [
    `M ${x1Outer} ${y1Outer}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2Outer} ${y2Outer}`,
    `L ${x1Inner} ${y1Inner}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x2Inner} ${y2Inner}`,
    "Z",
  ].join(" ");
}

interface SliceInfo {
  node: SunburstNode;
  level: number;
  startAngle: number;
  endAngle: number;
  path: string;
  midAngle: number;
  parentName?: string;
}

function formatTime(minutes: number): string {
  if (minutes <= 0) {
    return "0s";
  }
  const totalSeconds = Math.round(minutes * 60);
  if (totalSeconds < 1) {
    return "<1s";
  }
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h === 0) {
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  if (s === 0) {
    return `${h}h ${m}m`;
  }
  return `${h}h ${m}m ${s}s`;
}

interface SunburstChartProps {
  allApps?: AppEntry[];
}

export function SunburstChart({ allApps }: SunburstChartProps = {}) {
  const [drillPath, setDrillPath] = useState<string[]>([]);
  const [hoveredSlice, setHoveredSlice] = useState<SliceInfo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  /** `undefined` = demo/mock data; empty array = real API returned no apps today */
  const resolvedApps = allApps === undefined ? ALL_APPS : allApps;
  const isEmptyRealData =
    allApps !== undefined && allApps.length === 0;

  // Stateful categories & assignments
  const [categories, setCategories] =
    useState<Category[]>(DEFAULT_CATEGORIES);
  const [assignments, setAssignments] = useState<Record<string, string>>(
    () => buildDefaultAssignments(resolvedApps)
  );

  // Saved settings may omit "Others"; apps assigned to cat-others would otherwise vanish.
  const categoriesForChart = useMemo(() => {
    const ids = new Set(categories.map((c) => c.id));
    if (ids.has("cat-others")) return categories;
    const others = DEFAULT_CATEGORIES.find((c) => c.id === "cat-others");
    return others ? [...categories, others] : categories;
  }, [categories]);

  useEffect(() => {
    setAssignments((prev) => {
      const next = { ...prev };
      let changed = false;
      resolvedApps.forEach((app) => {
        if (!(app.id in next)) {
          next[app.id] = getCategoryIdForApp(app);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [resolvedApps]);

  // Restore category layout from SQLite (config table)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await loadSunburstSettings();
        if (cancelled || !saved?.categories?.length) return;
        const sanitized = sanitizeCategorySettings(
          saved.categories,
          saved.assignments,
          resolvedApps,
        );
        setCategories(sanitized.categories);
        setAssignments(sanitized.assignments);
      } catch {
        /* ignore corrupted/stale persisted settings */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build sunburst data from categories + assignments
  const sunburstData: SunburstNode[] = useMemo(() => {
    const result: SunburstNode[] = [];
    const categoryIds = new Set(categoriesForChart.map((c) => c.id));

    const categoryIdForApp = (app: AppEntry): string => {
      const raw = assignments[app.id] || "cat-others";
      if (categoryIds.has(raw)) return raw;
      return categoryIds.has("cat-others") ? "cat-others" : categoriesForChart[0]?.id ?? raw;
    };

    for (const cat of categoriesForChart) {
      const catApps = resolvedApps.filter(
        (app) => categoryIdForApp(app) === cat.id,
      );
      if (catApps.length === 0) continue;

      const totalMinutes = catApps.reduce((s, a) => s + a.minutes, 0);
      result.push({
        id: cat.id,
        name: cat.name,
        color: cat.color,
        minutes: totalMinutes,
        children: catApps
          .sort((a, b) => b.minutes - a.minutes)
          .map((a) => ({
            id: a.id,
            name: a.name,
            color: a.color,
            minutes: a.minutes,
          })),
      });
    }

    return result.sort((a, b) => b.minutes - a.minutes);
  }, [categoriesForChart, assignments, resolvedApps]);

  const cx = 200;
  const cy = 200;
  const ringWidth = 54;
  const gap = 2;
  const baseInner = 76;

  // Get current view data based on drill path
  const currentData = useMemo(() => {
    let nodes = sunburstData;
    for (const id of drillPath) {
      const found = nodes.find((n) => n.id === id);
      if (found?.children) {
        nodes = found.children;
      }
    }
    return nodes;
  }, [sunburstData, drillPath]);

  const currentParentName = useMemo(() => {
    if (drillPath.length === 0) return null;
    let nodes = sunburstData;
    let name = "";
    for (const id of drillPath) {
      const found = nodes.find((n) => n.id === id);
      if (found) {
        name = found.name;
        if (found.children) nodes = found.children;
      }
    }
    return name;
  }, [sunburstData, drillPath]);

  const totalMinutes = currentData.reduce((s, n) => s + n.minutes, 0);

  // Build all slices
  const slices = useMemo(() => {
    const result: SliceInfo[] = [];

    const buildSlices = (
      nodes: SunburstNode[],
      level: number,
      parentStart: number,
      parentSpan: number,
      parentName?: string
    ) => {
      const parentTotal = nodes.reduce((s, n) => s + n.minutes, 0);
      let currentAngle = parentStart;

      nodes.forEach((node) => {
        const span = (node.minutes / parentTotal) * parentSpan;
        // Skip only truly negligible arcs (many tiny slices would otherwise disappear at 0.5°).
        if (span < 0.08) {
          currentAngle += span;
          return;
        }

        const innerR = baseInner + level * (ringWidth + gap);
        const outerR = innerR + ringWidth;
        const padAngle = 1;
        const startAngle = currentAngle + padAngle / 2;
        const endAngle = currentAngle + span - padAngle / 2;

        if (endAngle > startAngle) {
          const path = describeArc(
            cx,
            cy,
            innerR,
            outerR,
            startAngle,
            endAngle
          );
          const midAngle = (startAngle + endAngle) / 2;

          result.push({
            node,
            level,
            startAngle,
            endAngle,
            path,
            midAngle,
            parentName,
          });

          if (node.children && node.children.length > 0) {
            buildSlices(
              node.children,
              level + 1,
              currentAngle,
              span,
              node.name
            );
          }
        }

        currentAngle += span;
      });
    };

    buildSlices(currentData, 0, 0, 360);
    return result;
  }, [currentData]);

  const handleSliceClick = (slice: SliceInfo) => {
    if (slice.node.children && slice.node.children.length > 0) {
      setDrillPath((prev) => [...prev, slice.node.id]);
      setHoveredSlice(null);
    }
  };

  const handleModalSave = useCallback(
    async (newCategories: Category[], newAssignments: Record<string, string>) => {
      const sanitized = sanitizeCategorySettings(
        newCategories,
        newAssignments,
        resolvedApps,
      );
      try {
        await saveSunburstSettings({
          categories: sanitized.categories,
          assignments: sanitized.assignments,
        });
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Failed to save category settings.",
        );
      }
      setCategories(sanitized.categories);
      setAssignments(sanitized.assignments);
      setDrillPath([]);
    },
    [resolvedApps]
  );

  const levelLabels =
    drillPath.length === 0 ? ["Categories", "Apps"] : ["Apps"];

  return (
    <div className="bg-card rounded-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-foreground flex items-center gap-2">
            <PieChart className="w-5 h-5 text-chart-3" />
            App Usage Breakdown
          </h3>
          <p className="text-muted-foreground text-xs mt-1">
            {drillPath.length === 0
              ? "Click any category slice to drill into individual apps"
              : `Viewing: ${currentParentName} — individual app breakdown`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {drillPath.length > 0 && (
            <button
              onClick={() => setDrillPath((p) => p.slice(0, -1))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-xs text-foreground hover:bg-accent transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
          )}
          <button
            onClick={() => setModalOpen(true)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
            title="Manage categories"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-6">
        {/* SVG Chart */}
        <div className="flex items-center justify-center overflow-x-auto">
          <div className="relative min-w-[400px]">
            {isEmptyRealData ? (
              <div className="flex flex-col items-center justify-center min-h-[320px] text-center px-6">
                <p className="text-muted-foreground text-sm max-w-sm">
                  No application usage recorded for today yet. Usage appears here
                  after focus sessions are saved to the database.
                </p>
                <p className="text-foreground text-2xl font-semibold mt-4 tabular-nums">
                  0s
                </p>
                <p className="text-muted-foreground text-xs mt-1">All Apps</p>
              </div>
            ) : (
            <svg width="400" height="400" viewBox="0 0 400 400">
              {/* Subtle ring guides */}
              {[0, 1].map((level) => {
                if (level >= levelLabels.length) return null;
                const r =
                  baseInner + level * (ringWidth + gap) + ringWidth / 2;
                return (
                  <circle
                    key={`guide-${level}`}
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke="var(--grid-stroke)"
                    strokeWidth={ringWidth}
                  />
                );
              })}

              {/* Slices */}
              {slices.map((slice) => {
                const isHovered =
                  hoveredSlice?.node.id === slice.node.id;
                return (
                  <path
                    key={slice.node.id}
                    d={slice.path}
                    fill={slice.node.color}
                    opacity={
                      hoveredSlice
                        ? isHovered
                          ? 1
                          : 0.3
                        : 0.75
                    }
                    stroke="var(--card)"
                    strokeWidth="1.5"
                    className={`transition-all duration-300 ${
                      slice.node.children
                        ? "cursor-pointer"
                        : "cursor-default"
                    }`}
                    onMouseEnter={() => setHoveredSlice(slice)}
                    onMouseLeave={() => setHoveredSlice(null)}
                    onClick={() => handleSliceClick(slice)}
                  />
                );
              })}

              {/* Slice labels for large enough slices */}
              {slices
                .filter((s) => s.endAngle - s.startAngle > 15)
                .map((slice) => {
                  const innerR =
                    baseInner + slice.level * (ringWidth + gap);
                  const outerR = innerR + ringWidth;
                  const midR = (innerR + outerR) / 2;
                  const midRad =
                    ((slice.midAngle - 90) * Math.PI) / 180;
                  const tx = cx + midR * Math.cos(midRad);
                  const ty = cy + midR * Math.sin(midRad);
                  const span = slice.endAngle - slice.startAngle;

                  return (
                    <text
                      key={`label-${slice.node.id}`}
                      x={tx}
                      y={ty}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="white"
                      fontSize={span > 30 ? 12 : 9}
                      opacity={0.9}
                      className="pointer-events-none select-none"
                      transform={`rotate(${
                        slice.midAngle > 90 && slice.midAngle < 270
                          ? slice.midAngle + 180
                          : slice.midAngle
                      }, ${tx}, ${ty})`}
                    >
                      {slice.node.name.length > 12
                        ? slice.node.name.slice(0, 11) + "\u2026"
                        : slice.node.name}
                    </text>
                  );
                })}

              {/* Center text */}
              <text
                x={cx}
                y={cy - 12}
                textAnchor="middle"
                fill="var(--foreground)"
                fontSize="22"
                className="pointer-events-none"
              >
                {formatTime(totalMinutes)}
              </text>
              <text
                x={cx}
                y={cy + 10}
                textAnchor="middle"
                fill="var(--muted-foreground)"
                fontSize="12"
                className="pointer-events-none"
              >
                {drillPath.length === 0 ? "All Apps" : currentParentName}
              </text>
            </svg>
            )}

            {/* Hover Tooltip */}
            {hoveredSlice && !isEmptyRealData && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
                <div className="bg-popover border border-border rounded-xl p-3 shadow-xl min-w-[160px] -translate-y-24">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{
                        backgroundColor: hoveredSlice.node.color,
                      }}
                    />
                    <span className="text-xs text-foreground">
                      {hoveredSlice.node.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Time</span>
                    <span className="text-foreground tabular-nums">
                      {formatTime(hoveredSlice.node.minutes)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Share</span>
                    <span className="text-foreground tabular-nums">
                      {totalMinutes > 0
                        ? Math.round(
                            (hoveredSlice.node.minutes / totalMinutes) *
                              100,
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  {hoveredSlice.parentName && (
                    <div className="flex items-center justify-between text-[11px] mt-1 pt-1 border-t border-border">
                      <span className="text-muted-foreground">
                        Category
                      </span>
                      <span className="text-primary">
                        {hoveredSlice.parentName}
                      </span>
                    </div>
                  )}
                  {hoveredSlice.node.children && (
                    <p className="text-[9px] text-primary mt-1.5">
                      Click to drill down
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Category Manager Modal */}
      <CategoryManagerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        categories={categories}
        appAssignments={assignments}
        allApps={resolvedApps}
        onSave={handleModalSave}
      />
    </div>
  );
}
