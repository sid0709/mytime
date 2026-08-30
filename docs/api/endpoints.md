# Endpoint catalog

Base path: `/api/v1`

All successful responses use `Content-Type: application/json` and camelCase field names.

## Discovery

| Method | Path | Params | Response |
|--------|------|--------|----------|
| GET, POST | `/health` | — | `HealthResponseDto` |
| GET, POST | `/metadata` | — | `MetadataResponseDto` |

## Dashboard and input

| Method | Path | Params | Response |
|--------|------|--------|----------|
| GET, POST | `/dashboard` | — | `DashboardSummaryDto` |
| GET, POST | `/input/stats` | — | `InputStatsDto` |
| GET, POST | `/input/events` | `limit?` | `LiveFeedEventDto[]` |

## Activity

| Method | Path | Params | Response |
|--------|------|--------|----------|
| GET, POST | `/activity/overview` | `date?` | `ActivityOverviewDto` |
| GET, POST | `/activity/app-usage` | `date?`, `limit?`, `includeIcons?` | `ActivityAppUsageDto` |
| GET, POST | `/activity/sessions` | `date?`, `offset?`, `limit?`, `filterText?`, `appId?`, `sortField?`, `sortDir?`, `includeIcons?` | `ActivitySessionPageDto` |
| GET, POST | `/activity/input-minutes` | `date?` | `AppInputMinuteDto[]` |
| GET, POST | `/activity/timeline` | `startDate?`, `endDate?` | `ActivityTimelineDto` |
| GET, POST | `/activity/heatmap` | — | `ActivityHeatmapDto` |

### Activity query notes

- `date` defaults to today in the machine's local timezone.
- `limit` defaults to `150` for sessions, max `500`.
- App-usage `limit` defaults to `500` and is capped at `2,000`; use the paged sessions endpoint for larger result sets.
- `sortField`: `start` (default), `duration`, `app`, `title`, `keys`, `clicks`, `scrolls`
- `sortDir`: `desc` (default) or `asc`
- `includeIcons` defaults to `false` on HTTP responses

Unknown paths, including former telemetry paths, return `404 Not Found`.

## Example fixtures

See [`examples/`](./examples/) for sample response bodies.
