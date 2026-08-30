# MyTime Remote API

Each MyTime desktop instance can expose a read-only HTTP API on the local network. A central dashboard can poll these endpoints on a schedule to aggregate activity data from multiple machines.

## Base URL

```
http://{machineIp}:{port}/api/v1
```

Default port: **18765**

Discover the machine address and port via `GET /api/v1/metadata`.

## Authentication

No authentication is required. The API is intended for trusted LAN/VPN environments only.

Exposed data includes window titles, application names, session durations, and input counts. Restrict inbound access with host firewall rules when possible.

## Polling workflow

1. Maintain a machine registry with `ip`, `port`, and optional `hostname` label.
2. Probe `GET /api/v1/health` or `GET /api/v1/metadata` on an interval.
3. Pull Dashboard, input, and activity endpoints per machine.
4. Store responses keyed by `machineId` and each payload's `generatedAt` field.
5. Paginate sessions with `offset` and `limit`.
6. Use `includeIcons=false` by default to avoid large base64 icon payloads.

## Date and time conventions

| Field kind | Format | Example |
|------------|--------|---------|
| `date`, `startDate`, `endDate` | `YYYY-MM-DD` in the machine's local timezone | `2026-07-02` |
| `startedAtMs`, `endedAtMs`, `firstActivityTsMs`, `lastActivityTsMs` | Unix epoch milliseconds | `1751455200000` |
| `generatedAt`, `startedAt`, `timestamp` | ISO-8601 string | `2026-07-02T14:30:00Z` |

## HTTP methods

All data endpoints support **GET** (query parameters) and **POST** (JSON body with the same fields).

## Errors

| Status | Meaning |
|--------|---------|
| `400` | Invalid query/body parameters |
| `404` | Unknown route |
| `500` | Internal server error |

Error body:

```json
{ "error": "invalid date '2026-13-40': ..." }
```

## CORS

Cross-origin requests are allowed so browser-based central dashboards can call the API from another origin.

## Documentation map

- [Endpoint catalog](./endpoints.md)
- [Data models](./data-models.md)
- [Example JSON fixtures](./examples/)
- [OpenAPI spec](./openapi.yaml)

## Quick examples

```bash
# Discovery
curl -s http://192.168.1.42:18765/api/v1/metadata

# Health check
curl -s http://192.168.1.42:18765/api/v1/health

# Today's dashboard summary
curl -s http://192.168.1.42:18765/api/v1/dashboard

# Paginated sessions without icons
curl -s "http://192.168.1.42:18765/api/v1/activity/sessions?limit=100&offset=0&includeIcons=false"

# Historical timeline
curl -s "http://192.168.1.42:18765/api/v1/activity/timeline?startDate=2026-06-01&endDate=2026-07-02"
```

POST example:

```bash
curl -s -X POST http://192.168.1.42:18765/api/v1/activity/sessions \
  -H 'Content-Type: application/json' \
  -d '{"limit":100,"offset":0,"filterText":"chrome","includeIcons":false}'
```

## Suggested central-server storage model

```typescript
interface MachineRecord {
  machineId: string;
  hostname: string;
  apiBaseUrl: string;
  lastSeenAt: string;
  platform: string;
  version: string;
}

interface ActivitySnapshot {
  machineId: string;
  polledAt: string;
  date: string;
  dashboard: DashboardSummaryDto;
  inputStats: InputStatsDto;
  overview: ActivityOverviewDto;
}

interface SessionBatch {
  machineId: string;
  polledAt: string;
  date: string;
  offset: number;
  sessions: AppUsageSessionDto[];
}
```

These types are documentation-only. The central server team can map them to any database schema.
