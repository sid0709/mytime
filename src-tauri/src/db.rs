//! Bounded SQLite persistence for aggregated activity telemetry.
//!
//! Raw hook events are intentionally not persisted. The durable model is minute aggregates,
//! application sessions, and one icon per application. This keeps write volume and database size
//! independent of keyboard/mouse event rate.
use rusqlite::{Connection, OpenFlags, Transaction, TransactionBehavior};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tracing::{info, warn};

#[derive(Clone)]
pub struct ActivitySessionRow {
    pub id: u64,
    pub app_id: String,
    pub app_name: String,
    pub title: String,
    pub pid: u32,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
    pub key_presses: u32,
    pub mouse_clicks: u32,
    pub scroll_events: u32,
}

#[derive(Clone)]
pub struct ActivityAppSummaryRow {
    pub app_id: String,
    pub app_name: String,
    pub icon_data_url: Option<String>,
    pub session_count: u32,
    pub total_duration_ms: u64,
    pub key_presses: u32,
    pub mouse_clicks: u32,
    pub scroll_events: u32,
}

#[derive(Clone, Debug)]
pub struct InputMinuteRow {
    pub minute_of_day: u32,
    pub key_presses: u32,
    pub mouse_clicks: u32,
    pub mouse_moves: u32,
    pub scroll_events: u32,
}

const SCHEMA_VERSION: i32 = 5;

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

#[derive(Default)]
struct MigrationOutcome {
    removed_high_volume_storage: bool,
}

/// Initialize the database at the given path. Call once during app setup.
pub fn init(path: &Path) -> Result<(), String> {
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
        | OpenFlags::SQLITE_OPEN_CREATE
        | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags).map_err(|e| e.to_string())?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "synchronous", "FULL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "busy_timeout", 5000_i32)
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_size_limit", 8 * 1024 * 1024_i64)
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "wal_autocheckpoint", 1000_i32)
        .map_err(|e| e.to_string())?;

    let migration = migrate(&conn)?;
    if migration.removed_high_volume_storage {
        compact_after_legacy_migration(&conn);
    }

    DB.set(Mutex::new(conn))
        .map_err(|_| "DB already initialized".to_string())?;

    thread::spawn(maintenance_loop);

    info!("SQLite DB initialized: {:?}", path);
    Ok(())
}

const MAINTENANCE_INTERVAL_SECS: u64 = 15 * 60;
const SESSION_RETENTION_DAYS: i64 = 366;
const MINUTE_RETENTION_DAYS: i64 = 366 * 2;

fn maintenance_loop() {
    loop {
        thread::sleep(Duration::from_secs(MAINTENANCE_INTERVAL_SECS));
        if let Err(error) = run_maintenance() {
            warn!(%error, "database maintenance failed");
        }
    }
}

fn run_maintenance() -> Result<(), String> {
    let today = chrono::Local::now().date_naive();
    let session_cutoff = (today - chrono::Duration::days(SESSION_RETENTION_DAYS))
        .format("%Y-%m-%d")
        .to_string();
    let minute_cutoff = (today - chrono::Duration::days(MINUTE_RETENTION_DAYS))
        .format("%Y-%m-%d")
        .to_string();

    let (sessions, minutes) = with_tx_result(|tx| {
        let sessions = tx.execute(
            "DELETE FROM activity_sessions WHERE date < ?1",
            [&session_cutoff],
        )?;
        let minutes = tx.execute(
            "DELETE FROM input_minutes WHERE date < ?1",
            [&minute_cutoff],
        )?;
        Ok((sessions, minutes))
    })?;

    if sessions > 0 || minutes > 0 {
        info!(
            sessions,
            minutes, "database retention pruned old aggregates"
        );
    }
    wal_checkpoint_passive()
}

/// Run a passive WAL checkpoint to move WAL pages into the main DB file.
/// Keeps WAL size bounded (e.g. after many hours of activity) and reduces crash risk.
fn wal_checkpoint_passive() -> Result<(), String> {
    with_conn_result(|conn| {
        let busy: i32 = conn.query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |row| row.get(0))?;
        if busy != 0 {
            warn!("db WAL checkpoint skipped: database busy");
        }
        Ok(())
    })
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get::<_, bool>(0),
    )
    .map_err(|error| error.to_string())
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;
    for name in columns {
        if name.map_err(|error| error.to_string())? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn compact_after_legacy_migration(conn: &Connection) {
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    let page_count = conn
        .query_row("PRAGMA page_count", [], |row| row.get::<_, i64>(0))
        .unwrap_or(0);
    let free_pages = conn
        .query_row("PRAGMA freelist_count", [], |row| row.get::<_, i64>(0))
        .unwrap_or(0);
    let page_size = conn
        .query_row("PRAGMA page_size", [], |row| row.get::<_, i64>(0))
        .unwrap_or(4096);
    let reclaimable_bytes = free_pages.saturating_mul(page_size);

    if reclaimable_bytes < 16 * 1024 * 1024 || page_count == 0 {
        return;
    }

    info!(
        reclaimable_mb = reclaimable_bytes / (1024 * 1024),
        "compacting legacy activity database"
    );
    if let Err(error) = conn
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")
    {
        // Compaction is an optimization. The migration has already removed the high-volume rows,
        // and SQLite can reuse their free pages even if disk space cannot be reclaimed right now.
        warn!(%error, "legacy database compaction skipped");
    }
}

fn migrate(conn: &Connection) -> Result<MigrationOutcome, String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version)
        SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM schema_version);

        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_icons (
            app_id TEXT PRIMARY KEY,
            icon_data_url TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activity_sessions (
            id INTEGER PRIMARY KEY,
            date TEXT NOT NULL,
            app_id TEXT NOT NULL,
            app_name TEXT NOT NULL,
            title TEXT,
            pid INTEGER NOT NULL,
            started_at_ms INTEGER NOT NULL,
            ended_at_ms INTEGER NOT NULL,
            key_presses INTEGER NOT NULL DEFAULT 0,
            mouse_clicks INTEGER NOT NULL DEFAULT 0,
            scroll_events INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_activity_sessions_date ON activity_sessions(date);
        CREATE INDEX IF NOT EXISTS idx_activity_sessions_started ON activity_sessions(started_at_ms);

        CREATE TABLE IF NOT EXISTS input_minutes (
            date TEXT NOT NULL,
            minute_of_day INTEGER NOT NULL,
            key_presses INTEGER NOT NULL DEFAULT 0,
            mouse_clicks INTEGER NOT NULL DEFAULT 0,
            mouse_moves INTEGER NOT NULL DEFAULT 0,
            scroll_events INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (date, minute_of_day)
        );

        "#,
    )
    .map_err(|e| e.to_string())?;

    let current: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let had_raw_events = table_exists(conn, "input_events")?;
    let had_inline_icons = table_has_column(conn, "activity_sessions", "icon_data_url")?;
    let mut outcome = MigrationOutcome::default();

    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;

    if current < 4 {
        if had_inline_icons {
            tx.execute_batch(
                r#"
                INSERT OR IGNORE INTO app_icons (app_id, icon_data_url, updated_at_ms)
                SELECT latest.app_id, latest.icon_data_url, latest.ended_at_ms
                FROM activity_sessions AS latest
                INNER JOIN (
                    SELECT app_id, MAX(id) AS id
                    FROM activity_sessions
                    WHERE icon_data_url IS NOT NULL AND icon_data_url <> ''
                    GROUP BY app_id
                ) AS selected ON selected.id = latest.id;

                ALTER TABLE activity_sessions RENAME TO activity_sessions_legacy_v3;
                CREATE TABLE activity_sessions (
                    id INTEGER PRIMARY KEY,
                    date TEXT NOT NULL,
                    app_id TEXT NOT NULL,
                    app_name TEXT NOT NULL,
                    title TEXT,
                    pid INTEGER NOT NULL,
                    started_at_ms INTEGER NOT NULL,
                    ended_at_ms INTEGER NOT NULL,
                    key_presses INTEGER NOT NULL DEFAULT 0,
                    mouse_clicks INTEGER NOT NULL DEFAULT 0,
                    scroll_events INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO activity_sessions (
                    id, date, app_id, app_name, title, pid, started_at_ms, ended_at_ms,
                    key_presses, mouse_clicks, scroll_events
                )
                SELECT id, date, app_id, app_name, title, pid, started_at_ms, ended_at_ms,
                       key_presses, mouse_clicks, scroll_events
                FROM activity_sessions_legacy_v3;
                DROP TABLE activity_sessions_legacy_v3;
                "#,
            )
            .map_err(|error| error.to_string())?;
            outcome.removed_high_volume_storage = true;
        }

        if had_raw_events {
            tx.execute_batch("DROP TABLE input_events;")
                .map_err(|error| error.to_string())?;
            outcome.removed_high_volume_storage = true;
        }
    }

    tx.execute_batch(
        r#"
            CREATE INDEX IF NOT EXISTS idx_activity_sessions_date
                ON activity_sessions(date);
            CREATE INDEX IF NOT EXISTS idx_activity_sessions_started
                ON activity_sessions(started_at_ms);
            CREATE INDEX IF NOT EXISTS idx_activity_sessions_date_started
                ON activity_sessions(date, started_at_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_activity_sessions_date_app_started
                ON activity_sessions(date, app_id, started_at_ms DESC);
            "#,
    )
    .map_err(|error| error.to_string())?;

    if current <= SCHEMA_VERSION {
        tx.execute("DELETE FROM schema_version", [])
            .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            [SCHEMA_VERSION],
        )
        .map_err(|error| error.to_string())?;
    }
    if current < SCHEMA_VERSION {
        info!("DB migrated to schema version {}", SCHEMA_VERSION);
    }

    tx.commit().map_err(|error| error.to_string())?;
    Ok(outcome)
}

fn with_conn<F, T>(f: F) -> Option<T>
where
    F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
{
    with_conn_result(f).ok()
}

fn with_conn_result<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
{
    let guard = DB
        .get()
        .ok_or_else(|| "database is not initialized".to_string())?
        .lock()
        .map_err(|_| "database lock is poisoned".to_string())?;
    f(&guard).map_err(|error| error.to_string())
}

/// Get config value by key. Returns `None` when the key is absent.
pub fn get_config(key: &str) -> Option<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT value FROM config WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        match rows.next()? {
            Some(row) => row.get(0),
            None => Err(rusqlite::Error::QueryReturnedNoRows),
        }
    })
}

/// Set config value (upsert). Used e.g. to remember that startup was registered.
#[cfg(windows)]
pub fn set_config(key: &str, value: &str) -> Option<()> {
    set_config_result(key, value).ok()
}

/// Set config value (upsert) and preserve the DB error for user-facing saves.
pub fn set_config_result(key: &str, value: &str) -> Result<(), String> {
    use chrono::Utc;
    with_tx_result(|tx| {
        let now = Utc::now().timestamp_millis();
        tx.execute(
            r#"INSERT INTO config (key, value, updated_at_ms) VALUES (?1, ?2, ?3)
               ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at_ms = ?3"#,
            rusqlite::params![key, value, now],
        )?;
        Ok(())
    })
}

/// Run a function inside an immediate transaction (blocks until lock acquired).
/// Ensures atomic writes and crash safety.
fn with_tx<F, T>(f: F) -> Option<T>
where
    F: FnOnce(&Transaction) -> Result<T, rusqlite::Error>,
{
    with_tx_result(f).ok()
}

fn with_tx_result<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&Transaction) -> Result<T, rusqlite::Error>,
{
    let mut guard = DB
        .get()
        .ok_or_else(|| "database is not initialized".to_string())?
        .lock()
        .map_err(|_| "database lock is poisoned".to_string())?;
    let tx = guard
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let result = f(&tx).map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

/// Save activity session (upsert by id for today).
pub fn upsert_activity_session(
    tx: &Transaction,
    id: u64,
    date: &str,
    app_id: &str,
    app_name: &str,
    title: &str,
    pid: u32,
    started_at_ms: i64,
    ended_at_ms: i64,
    key_presses: u32,
    mouse_clicks: u32,
    scroll_events: u32,
) -> Result<(), rusqlite::Error> {
    tx.execute(
        r#"INSERT INTO activity_sessions (id, date, app_id, app_name, title, pid, started_at_ms, ended_at_ms, key_presses, mouse_clicks, scroll_events)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
           ON CONFLICT(id) DO UPDATE SET
             date = excluded.date,
             app_id = excluded.app_id,
             app_name = excluded.app_name,
             title = excluded.title,
             pid = excluded.pid,
             started_at_ms = excluded.started_at_ms,
             ended_at_ms = excluded.ended_at_ms,
             key_presses = excluded.key_presses,
             mouse_clicks = excluded.mouse_clicks,
             scroll_events = excluded.scroll_events"#,
        rusqlite::params![
            id as i64,
            date,
            app_id,
            app_name,
            title,
            pid as i64,
            started_at_ms,
            ended_at_ms,
            key_presses as i64,
            mouse_clicks as i64,
            scroll_events as i64,
        ],
    )?;
    Ok(())
}

/// Store one icon per application. Existing icons are immutable so recurring checkpoints never
/// rewrite large blobs into the WAL.
pub fn insert_app_icon(
    tx: &Transaction,
    app_id: &str,
    icon_data_url: &str,
    updated_at_ms: i64,
) -> Result<(), rusqlite::Error> {
    tx.execute(
        r#"INSERT OR IGNORE INTO app_icons (app_id, icon_data_url, updated_at_ms)
           VALUES (?1, ?2, ?3)"#,
        rusqlite::params![app_id, icon_data_url, updated_at_ms],
    )?;
    Ok(())
}

pub fn load_max_activity_session_id() -> u64 {
    with_conn(|conn| {
        conn.query_row(
            "SELECT COALESCE(MAX(id), 0) FROM activity_sessions",
            [],
            |row| row.get::<_, i64>(0),
        )
    })
    .unwrap_or(0)
    .max(0) as u64
}
/// Replace input minutes for a date (clear and reinsert for today's snapshot).
pub fn replace_input_minutes_for_date(
    tx: &Transaction,
    date: &str,
    minutes: &[InputMinuteRow],
) -> Result<(), rusqlite::Error> {
    tx.execute("DELETE FROM input_minutes WHERE date = ?1", [date])?;
    for row in minutes {
        tx.execute(
            r#"INSERT INTO input_minutes (
                 date, minute_of_day, key_presses, mouse_clicks, mouse_moves, scroll_events
               )
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
            rusqlite::params![
                date,
                row.minute_of_day as i64,
                row.key_presses as i64,
                row.mouse_clicks as i64,
                row.mouse_moves as i64,
                row.scroll_events as i64,
            ],
        )?;
    }
    Ok(())
}

/// Upsert only minute buckets changed since the previous checkpoint.
pub fn upsert_input_minutes_for_date(
    tx: &Transaction,
    date: &str,
    minutes: &[InputMinuteRow],
) -> Result<(), rusqlite::Error> {
    let mut statement = tx.prepare_cached(
        r#"INSERT INTO input_minutes
             (date, minute_of_day, key_presses, mouse_clicks, mouse_moves, scroll_events)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(date, minute_of_day) DO UPDATE SET
             key_presses = excluded.key_presses,
             mouse_clicks = excluded.mouse_clicks,
             mouse_moves = excluded.mouse_moves,
             scroll_events = excluded.scroll_events"#,
    )?;
    for row in minutes {
        statement.execute(rusqlite::params![
            date,
            row.minute_of_day as i64,
            row.key_presses as i64,
            row.mouse_clicks as i64,
            row.mouse_moves as i64,
            row.scroll_events as i64,
        ])?;
    }
    Ok(())
}

pub fn load_activity_session_rows_for_date(date: &str, limit: usize) -> Vec<ActivitySessionRow> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            r#"SELECT id, app_id, app_name, title, pid, started_at_ms, ended_at_ms,
                      key_presses, mouse_clicks, scroll_events
               FROM activity_sessions
               WHERE date = ?1
               ORDER BY started_at_ms DESC
               LIMIT ?2"#,
        )?;
        let rows = stmt.query_map(rusqlite::params![date, limit as i64], |r| {
            Ok(ActivitySessionRow {
                id: r.get::<_, i64>(0)? as u64,
                app_id: r.get(1)?,
                app_name: r.get(2)?,
                title: r.get(3)?,
                pid: r.get::<_, i64>(4)? as u32,
                started_at_ms: r.get(5)?,
                ended_at_ms: r.get(6)?,
                key_presses: r.get::<_, i64>(7)? as u32,
                mouse_clicks: r.get::<_, i64>(8)? as u32,
                scroll_events: r.get::<_, i64>(9)? as u32,
            })
        })?;
        let out: Result<Vec<_>, _> = rows.collect();
        out
    })
    .unwrap_or_default()
}

pub fn load_activity_app_summaries_for_date(
    date: &str,
    include_icons: bool,
) -> Vec<ActivityAppSummaryRow> {
    with_conn(|conn| {
        let icon_column = if include_icons {
            "app_icons.icon_data_url"
        } else {
            "NULL"
        };
        let icon_join = if include_icons {
            "LEFT JOIN app_icons ON app_icons.app_id = totals.app_id"
        } else {
            ""
        };
        let sql = format!(
            r#"WITH totals AS (
                   SELECT app_id,
                          app_name,
                          COUNT(*) AS session_count,
                          SUM(CASE
                                WHEN ended_at_ms > started_at_ms THEN ended_at_ms - started_at_ms
                                ELSE 0
                              END) AS total_duration_ms,
                          SUM(key_presses) AS key_presses,
                          SUM(mouse_clicks) AS mouse_clicks,
                          SUM(scroll_events) AS scroll_events
                   FROM activity_sessions
                   WHERE date = ?1
                   GROUP BY app_id, app_name
               )
               SELECT totals.app_id,
                      totals.app_name,
                      {icon_column},
                      totals.session_count,
                      totals.total_duration_ms,
                      totals.key_presses,
                      totals.mouse_clicks,
                      totals.scroll_events
               FROM totals
               {icon_join}
               ORDER BY totals.total_duration_ms DESC, totals.app_name ASC"#,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([date], |r| {
            Ok(ActivityAppSummaryRow {
                app_id: r.get(0)?,
                app_name: r.get(1)?,
                icon_data_url: r.get(2)?,
                session_count: r.get::<_, i64>(3)? as u32,
                total_duration_ms: r.get::<_, i64>(4)?.max(0) as u64,
                key_presses: r.get::<_, i64>(5)? as u32,
                mouse_clicks: r.get::<_, i64>(6)? as u32,
                scroll_events: r.get::<_, i64>(7)? as u32,
            })
        })?;
        let out: Result<Vec<_>, _> = rows.collect();
        out
    })
    .unwrap_or_default()
}

/// Load only icon keys needed by the foreground collector. Avoid pulling every base64 icon blob
/// into memory at startup merely to discard it.
pub fn load_app_icon_ids(limit: usize) -> Vec<String> {
    with_conn(|conn| {
        let mut statement = conn.prepare("SELECT app_id FROM app_icons LIMIT ?1")?;
        let rows = statement.query_map([limit as i64], |row| row.get(0))?;
        let output: Result<Vec<_>, _> = rows.collect();
        output
    })
    .unwrap_or_default()
}

pub fn load_activity_sessions_page_for_date(
    date: &str,
    filter_text: Option<&str>,
    app_id: Option<&str>,
    sort_field: &str,
    sort_dir: &str,
    limit: u32,
    offset: u32,
) -> (u32, Vec<ActivitySessionRow>) {
    with_conn(|conn| {
        let filter_value = filter_text
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("%{}%", value.to_lowercase()));
        let app_id_value = app_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        let total: u32 = conn.query_row(
            r#"SELECT COUNT(*)
                   FROM activity_sessions
                   WHERE date = :date
                     AND (
                       :filter IS NULL
                       OR LOWER(title) LIKE :filter
                       OR LOWER(app_name) LIKE :filter
                     )
                     AND (:app_id IS NULL OR app_id = :app_id)"#,
            rusqlite::named_params! {
                ":date": date,
                ":filter": filter_value.as_deref(),
                ":app_id": app_id_value.as_deref(),
            },
            |row| row.get::<_, i64>(0),
        )? as u32;

        let order_expr = match sort_field {
            "title" => "title COLLATE NOCASE",
            "app" => "app_name COLLATE NOCASE",
            "end" => "ended_at_ms",
            "duration" => "(ended_at_ms - started_at_ms)",
            _ => "started_at_ms",
        };
        let order_dir = if sort_dir.eq_ignore_ascii_case("asc") {
            "ASC"
        } else {
            "DESC"
        };

        let sql = format!(
            r#"SELECT id, app_id, app_name, title, pid, started_at_ms, ended_at_ms,
                      key_presses, mouse_clicks, scroll_events
               FROM activity_sessions
               WHERE date = :date
                 AND (
                   :filter IS NULL
                   OR LOWER(title) LIKE :filter
                   OR LOWER(app_name) LIKE :filter
                 )
                 AND (:app_id IS NULL OR app_id = :app_id)
               ORDER BY {order_expr} {order_dir}, started_at_ms DESC, id DESC
               LIMIT :limit OFFSET :offset"#,
        );

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::named_params! {
                ":date": date,
                ":filter": filter_value.as_deref(),
                ":app_id": app_id_value.as_deref(),
                ":limit": limit as i64,
                ":offset": offset as i64,
            },
            |r| {
                Ok(ActivitySessionRow {
                    id: r.get::<_, i64>(0)? as u64,
                    app_id: r.get(1)?,
                    app_name: r.get(2)?,
                    title: r.get(3)?,
                    pid: r.get::<_, i64>(4)? as u32,
                    started_at_ms: r.get(5)?,
                    ended_at_ms: r.get(6)?,
                    key_presses: r.get::<_, i64>(7)? as u32,
                    mouse_clicks: r.get::<_, i64>(8)? as u32,
                    scroll_events: r.get::<_, i64>(9)? as u32,
                })
            },
        )?;
        let sessions: Result<Vec<_>, _> = rows.collect();
        Ok((total, sessions?))
    })
    .unwrap_or_default()
}

/// Load input minutes for a date.
pub fn load_input_minutes_for_date(date: &str) -> Vec<InputMinuteRow> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            r#"SELECT minute_of_day, key_presses, mouse_clicks, mouse_moves, scroll_events
               FROM input_minutes WHERE date = ?1 ORDER BY minute_of_day ASC"#,
        )?;
        let rows = stmt.query_map([date], |r| {
            Ok(InputMinuteRow {
                minute_of_day: r.get::<_, i64>(0)? as u32,
                key_presses: r.get::<_, i64>(1)? as u32,
                mouse_clicks: r.get::<_, i64>(2)? as u32,
                mouse_moves: r.get::<_, i64>(3)? as u32,
                scroll_events: r.get::<_, i64>(4)? as u32,
            })
        })?;
        let out: Result<Vec<_>, _> = rows.collect();
        out
    })
    .unwrap_or_default()
}

/// Execute multiple operations in a single atomic transaction.
pub fn with_atomic_tx<F, T>(f: F) -> Option<T>
where
    F: FnOnce(&Transaction) -> Result<T, rusqlite::Error>,
{
    with_tx(f)
}

#[cfg(test)]
mod tests {
    use super::{migrate, SCHEMA_VERSION};
    use rusqlite::Connection;

    #[test]
    fn fresh_schema_does_not_create_legacy_network_table() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate(&conn).expect("migrate fresh database");

        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'network_samples'",
                [],
                |row| row.get(0),
            )
            .expect("query schema");
        let version: i32 = conn
            .query_row("SELECT version FROM schema_version", [], |row| row.get(0))
            .expect("query schema version");

        assert_eq!(table_count, 0);
        assert!(!super::table_exists(&conn, "input_events").expect("query input table"));
        assert!(super::table_exists(&conn, "app_icons").expect("query icon table"));
        assert!(
            !super::table_has_column(&conn, "activity_sessions", "icon_data_url")
                .expect("query session columns")
        );
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn upgrade_normalizes_icons_and_removes_raw_events() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch(
            r#"
            CREATE TABLE schema_version (version INTEGER NOT NULL);
            INSERT INTO schema_version (version) VALUES (3);
            CREATE TABLE input_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts_ms INTEGER NOT NULL,
                kind TEXT NOT NULL,
                action TEXT,
                label TEXT,
                state_key TEXT,
                button TEXT,
                direction TEXT,
                x INTEGER,
                y INTEGER
            );
            INSERT INTO input_events (ts_ms, kind) VALUES (1, 'keyboard');
            CREATE TABLE activity_sessions (
                id INTEGER PRIMARY KEY,
                date TEXT NOT NULL,
                app_id TEXT NOT NULL,
                app_name TEXT NOT NULL,
                title TEXT,
                pid INTEGER NOT NULL,
                started_at_ms INTEGER NOT NULL,
                ended_at_ms INTEGER NOT NULL,
                key_presses INTEGER NOT NULL DEFAULT 0,
                mouse_clicks INTEGER NOT NULL DEFAULT 0,
                scroll_events INTEGER NOT NULL DEFAULT 0,
                icon_data_url TEXT
            );
            INSERT INTO activity_sessions VALUES
                (1, '2026-08-03', 'editor', 'Editor', 'First', 10, 100, 200, 3, 2, 1, 'data:old'),
                (2, '2026-08-03', 'editor', 'Editor', 'Second', 10, 201, 300, 4, 3, 2, 'data:new');
            "#,
        )
        .expect("create version 3 schema");

        let outcome = migrate(&conn).expect("migrate version 3 database");

        assert!(outcome.removed_high_volume_storage);
        assert!(!super::table_exists(&conn, "input_events").expect("query input table"));
        assert!(
            !super::table_has_column(&conn, "activity_sessions", "icon_data_url")
                .expect("query session columns")
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM activity_sessions", [], |row| row
                .get::<_, i64>(0))
                .expect("count sessions"),
            2
        );
        assert_eq!(
            conn.query_row(
                "SELECT icon_data_url FROM app_icons WHERE app_id = 'editor'",
                [],
                |row| row.get::<_, String>(0),
            )
            .expect("load normalized icon"),
            "data:new"
        );
    }

    #[test]
    fn recurring_checkpoints_update_small_rows_without_duplicating_icons() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate(&conn).expect("migrate fresh database");

        let tx = conn.unchecked_transaction().expect("begin transaction");
        super::insert_app_icon(&tx, "editor", "data:first", 10).expect("insert icon");
        super::insert_app_icon(&tx, "editor", "data:second", 20).expect("ignore duplicate icon");
        super::upsert_activity_session(
            &tx,
            1,
            "2026-08-03",
            "editor",
            "Editor",
            "Document",
            42,
            100,
            200,
            3,
            2,
            1,
        )
        .expect("insert session");
        super::upsert_activity_session(
            &tx,
            1,
            "2026-08-03",
            "editor",
            "Editor",
            "Document",
            42,
            100,
            300,
            5,
            4,
            2,
        )
        .expect("update session");
        super::upsert_input_minutes_for_date(
            &tx,
            "2026-08-03",
            &[super::InputMinuteRow {
                minute_of_day: 10,
                key_presses: 1,
                mouse_clicks: 2,
                mouse_moves: 3,
                scroll_events: 4,
            }],
        )
        .expect("insert minute");
        super::upsert_input_minutes_for_date(
            &tx,
            "2026-08-03",
            &[super::InputMinuteRow {
                minute_of_day: 10,
                key_presses: 5,
                mouse_clicks: 6,
                mouse_moves: 7,
                scroll_events: 8,
            }],
        )
        .expect("update minute");
        tx.commit().expect("commit transaction");

        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM app_icons", [], |row| row
                .get::<_, i64>(0))
                .expect("count icons"),
            1
        );
        assert_eq!(
            conn.query_row("SELECT icon_data_url FROM app_icons", [], |row| row
                .get::<_, String>(0))
                .expect("load icon"),
            "data:first"
        );
        assert_eq!(
            conn.query_row(
                "SELECT ended_at_ms, key_presses FROM activity_sessions WHERE id = 1",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("load session"),
            (300, 5)
        );
        assert_eq!(
            conn.query_row(
                "SELECT key_presses, scroll_events FROM input_minutes WHERE date = '2026-08-03' AND minute_of_day = 10",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("load minute"),
            (5, 8)
        );
    }

    #[test]
    fn upgrade_preserves_legacy_network_rows() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch(
            r#"
            CREATE TABLE schema_version (version INTEGER NOT NULL);
            INSERT INTO schema_version (version) VALUES (2);
            CREATE TABLE network_samples (
                id INTEGER PRIMARY KEY,
                date TEXT NOT NULL,
                ts_ms INTEGER NOT NULL
            );
            INSERT INTO network_samples (id, date, ts_ms)
            VALUES (7, '2026-08-03', 1770000000000);
            "#,
        )
        .expect("create legacy schema");

        migrate(&conn).expect("migrate legacy database");

        let preserved: (i64, String, i64) = conn
            .query_row(
                "SELECT id, date, ts_ms FROM network_samples WHERE id = 7",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("query preserved legacy row");
        let version: i32 = conn
            .query_row("SELECT version FROM schema_version", [], |row| row.get(0))
            .expect("query schema version");

        assert_eq!(preserved, (7, "2026-08-03".to_string(), 1770000000000));
        assert_eq!(version, SCHEMA_VERSION);
    }
}
