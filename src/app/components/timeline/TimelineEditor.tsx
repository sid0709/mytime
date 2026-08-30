import { useState, useMemo, useCallback } from "react";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineTracks } from "./TimelineTracks";
import { AppUsageList } from "./AppUsageList";
import type { AppUsageSummaryDto } from "../../types/backend";
import {
  type APMDataPoint,
  type ActivityStatus,
  type TimelineMarker,
  type TimelineBlock,
  generateTimelineBlocks,
  generateAPMData,
  generateMarkers,
  generateActivityStatus,
} from "./timeline-data";

interface TimelineEditorProps {
  blocks?: TimelineBlock[];
  apmData?: APMDataPoint[];
  markers?: TimelineMarker[];
  activityStatus?: ActivityStatus[];
  qualityDay?: ArrayLike<number>;
  appSummaries?: AppUsageSummaryDto[];
  appIconDataUrlById?: Record<string, string | null | undefined>;
  isLoading?: boolean;
}

type TrackKey = "status" | "windows" | "apm";

export function TimelineEditor({
  blocks: externalBlocks,
  apmData: externalApmData,
  markers: externalMarkers,
  activityStatus: externalActivityStatus,
  qualityDay,
  appSummaries = [],
  appIconDataUrlById = {},
  isLoading = false,
}: TimelineEditorProps) {
  const [blocks] = useState<TimelineBlock[]>(() =>
    externalBlocks ?? generateTimelineBlocks()
  );
  const [zoom, setZoom] = useState(1.5);
  const [visibleTracks, setVisibleTracks] = useState({
    status: true,
    windows: true,
    apm: externalApmData === undefined ? true : externalApmData.length > 0,
  });
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(
    new Set()
  );

  const apmData = useMemo(
    () => externalApmData ?? generateAPMData(),
    [externalApmData],
  );
  const markers = useMemo(
    () => externalMarkers ?? generateMarkers(),
    [externalMarkers],
  );
  const activityStatus = useMemo(
    () => externalActivityStatus ?? generateActivityStatus(),
    [externalActivityStatus],
  );
  const resolvedBlocks = externalBlocks ?? blocks;

  const handleSelectBlock = useCallback(
    (block: TimelineBlock) => {
      setSelectedBlockIds((prev) => {
        const next = new Set(prev);
        if (next.has(block.id)) {
          next.delete(block.id);
        } else {
          next.add(block.id);
        }
        return next;
      });
    },
    []
  );

  const handleToggleTrack = (track: TrackKey) => {
    setVisibleTracks((prev) => ({ ...prev, [track]: !prev[track] }));
  };

  return (
    <div className="space-y-3 w-full min-w-0">
      {/* Toolbar */}
      <TimelineToolbar
        zoom={zoom}
        visibleTracks={visibleTracks}
        onToggleTrack={handleToggleTrack}
        selectedCount={selectedBlockIds.size}
        onClearSelection={() => setSelectedBlockIds(new Set())}
      />

      {/* Multi-Track Timeline */}
      <TimelineTracks
        blocks={resolvedBlocks}
        apmData={apmData}
        markers={markers}
        activityStatus={activityStatus}
        qualityDay={qualityDay}
        zoom={zoom}
        onZoomChange={setZoom}
        visibleTracks={visibleTracks}
        onSelectBlock={handleSelectBlock}
        selectedBlockIds={selectedBlockIds}
      />

      {/* App Usage Detail List */}
      <AppUsageList
        appSummaries={appSummaries}
        appIconDataUrlById={appIconDataUrlById}
        isLoading={isLoading}
        onBlockSelect={handleSelectBlock}
        selectedBlockIds={selectedBlockIds}
      />
    </div>
  );
}
