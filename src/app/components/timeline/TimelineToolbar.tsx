import {
  Layers,
  RotateCcw,
} from "lucide-react";

export type ToolType = "select" | null;
type TrackKey = "status" | "windows" | "apm";

interface TimelineToolbarProps {
  zoom: number;
  visibleTracks: Record<TrackKey, boolean>;
  onToggleTrack: (track: TrackKey) => void;
  selectedCount: number;
  onClearSelection: () => void;
}

export function TimelineToolbar({
  zoom,
  visibleTracks,
  onToggleTrack,
  selectedCount,
  onClearSelection,
}: TimelineToolbarProps) {
  const trackToggles: { id: TrackKey; label: string; color: string }[] = [
    { id: "status", label: "Activity Status", color: "#22c55e" },
    { id: "windows", label: "Active Windows", color: "#6366f1" },
    { id: "apm", label: "Input Heatmap", color: "#f97316" },
  ];

  return (
    <div className="bg-card border border-border rounded-xl px-3 sm:px-4 py-2 flex flex-wrap items-center gap-1">
      {/* Zoom indicator */}
      <div className="flex items-center gap-1.5 pr-3 border-r border-border">
        <span className="text-[10px] text-muted-foreground">Zoom</span>
        <span className="text-[10px] text-foreground tabular-nums bg-secondary px-1.5 py-0.5 rounded">
          {zoom.toFixed(2)}x
        </span>
        <span className="text-[9px] text-muted-foreground/50 hidden sm:inline">scroll to zoom</span>
      </div>

      {/* Track Visibility Toggles */}
      <div className="flex items-center gap-1 px-3">
        <Layers className="w-3.5 h-3.5 text-muted-foreground mr-1" />
        {trackToggles.map((track) => {
          const isVisible = visibleTracks[track.id];
          return (
            <button
              key={track.id}
              onClick={() => onToggleTrack(track.id)}
              title={`${isVisible ? "Hide" : "Show"} ${track.label}`}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-all cursor-pointer ${
                isVisible
                  ? "text-foreground bg-secondary"
                  : "text-muted-foreground/50 hover:text-muted-foreground"
              }`}
            >
              <div
                className="w-2 h-2 rounded-full transition-opacity"
                style={{
                  backgroundColor: track.color,
                  opacity: isVisible ? 1 : 0.3,
                }}
              />
              <span className="hidden xl:inline">{track.label}</span>
            </button>
          );
        })}
      </div>

      {/* Selection Info & Reset */}
      <div className="flex items-center gap-2 pl-3 ml-auto">
        {selectedCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-primary">
              {selectedCount} block{selectedCount > 1 ? "s" : ""} selected
            </span>
            <button
              onClick={onClearSelection}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
