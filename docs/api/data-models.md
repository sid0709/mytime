# Data models

All response fields use **camelCase**. Types below are shown in TypeScript style for the central server team.

## Machine and discovery

### HealthResponseDto

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | Always `true` when the server is reachable |
| `version` | `string` | MyTime app version |

### MetadataResponseDto

| Field | Type | Description |
|-------|------|-------------|
| `appName` | `string` | Always `MyTime` |
| `version` | `string` | App version |
| `platform` | `string` | OS name, e.g. `macos`, `windows` |
| `hostname` | `string` | Configured label or OS hostname |
| `startedAt` | `string` | ISO-8601 app start time |
| `backendMode` | `string` | Backend mode identifier |
| `collectorsRunning` | `boolean` | Whether collectors are active |
| `dataDir` | `string` | App data directory path |
| `logDir` | `string` | Log directory path |
| `dbPath` | `string` | SQLite database path |
| `dbExists` | `boolean` | Whether the database file exists |
| `apiServerPort` | `number` | Active API port |
| `apiBaseUrl` | `string` | Full API base URL |

## Dashboard and input

### MetricCardDto

| Field | Type |
|-------|------|
| `title` | `string` |
| `value` | `string` |
| `change` | `string \| null` |
| `trend` | `"up" \| "down" \| null` |
| `subtitle` | `string \| null` |

### DashboardSummaryDto

| Field | Type |
|-------|------|
| `generatedAt` | `string` |
| `metrics.activeTimeToday` | `MetricCardDto` |
| `metrics.mouseEvents` | `MetricCardDto` |
| `metrics.keystrokes` | `MetricCardDto` |

### InputStatsDto

| Field | Type |
|-------|------|
| `keyPressesToday` | `number` |
| `mouseEventsToday` | `number` |
| `scrollEventsToday` | `number` |
| `firstActivityTsMs` | `number \| null` |
| `lastActivityTsMs` | `number \| null` |

### LiveFeedEventDto

| Field | Type |
|-------|------|
| `id` | `number` |
| `eventType` | `"mouse" \| "keyboard" \| "scroll"` |
| `description` | `string` |
| `timestamp` | `string` |
| `detail` | `string \| null` |

## Activity

### AppUsageSessionDto

| Field | Type |
|-------|------|
| `id` | `number` |
| `appId` | `string` |
| `appName` | `string` |
| `iconDataUrl` | `string \| null` |
| `title` | `string` |
| `pid` | `number` |
| `startedAtMs` | `number` |
| `endedAtMs` | `number` |
| `durationMs` | `number` |
| `keyPresses` | `number` |
| `mouseClicks` | `number` |
| `scrollEvents` | `number` |

### AppUsageSummaryDto

| Field | Type |
|-------|------|
| `appId` | `string` |
| `appName` | `string` |
| `iconDataUrl` | `string \| null` |
| `sessionCount` | `number` |
| `totalDurationMs` | `number` |
| `keyPresses` | `number` |
| `mouseClicks` | `number` |
| `scrollEvents` | `number` |

### AppInputMinuteDto

| Field | Type |
|-------|------|
| `minuteOfDay` | `number` |
| `keyPresses` | `number` |
| `mouseClicks` | `number` |
| `mouseMoves` | `number` |
| `scrollEvents` | `number` |
| `diversity` | `number \| null` |
| `timing` | `number \| null` |
| `quality` | `number \| null` |

### ActivityOverviewDto

| Field | Type |
|-------|------|
| `generatedAt` | `string` |
| `totalSessions` | `number` |
| `apps` | `AppUsageSummaryDto[]` |
| `inputMinutes` | `AppInputMinuteDto[]` |
| `timelineSessions` | `AppUsageSessionDto[]` |

### ActivityAppUsageDto

| Field | Type |
|-------|------|
| `generatedAt` | `string` |
| `sessions` | `AppUsageSessionDto[]` |
| `apps` | `AppUsageSummaryDto[]` |
| `inputMinutes` | `AppInputMinuteDto[]` |

### ActivitySessionPageDto

| Field | Type |
|-------|------|
| `generatedAt` | `string` |
| `total` | `number` |
| `offset` | `number` |
| `limit` | `number` |
| `hasMore` | `boolean` |
| `sessions` | `AppUsageSessionDto[]` |

### ActivityTimelinePointDto

| Field | Type |
|-------|------|
| `label` | `string` |
| `active` | `number` |
| `inactive` | `number` |
| `fullDate` | `string` |

### ActivityTimelineDto

| Field | Type |
|-------|------|
| `generatedAt` | `string` |
| `startDate` | `string` |
| `endDate` | `string` |
| `isHourly` | `boolean` |
| `yLabel` | `string` |
| `maxValue` | `number` |
| `avgActive` | `number` |
| `points` | `ActivityTimelinePointDto[]` |

### ActivityHeatmapDto

| Field | Type |
|-------|------|
| `grid` | `number[][]` |
| `slotSeconds` | `number` |

`grid[row][col]` is intensity `0-100`: the share of 1-second sidecar samples in that slot whose mixed quality is at least `QUALITY_PERSIST_MIN` (default 25%). Rows are chronological: row `0` = six days ago, row `6` = today, row `7` = tomorrow (always empty). `slotSeconds` is `3600` (1 hour), so there are `24` columns per day. Seconds below the cutoff do not count.

## Query parameter types

### DateQuery

```typescript
{ date?: string }
```

### DateLimitQuery

```typescript
{ date?: string; limit?: number; includeIcons?: boolean }
```

### SessionPageQuery

```typescript
{
  date?: string;
  offset?: number;
  limit?: number;
  filterText?: string;
  appId?: string;
  sortField?: string;
  sortDir?: string;
  includeIcons?: boolean;
}
```

### TimelineQuery

```typescript
{ startDate?: string; endDate?: string }
```

### LimitQuery

```typescript
{ limit?: number }
```

## Error response

### ApiErrorDto

```typescript
{ error: string }
```
