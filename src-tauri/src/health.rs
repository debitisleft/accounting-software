// Phase 44: Health Monitor.
//
// Per-module in-memory error counters with a sliding time window. When a
// module accumulates more than `error_threshold` errors within
// `error_window_minutes`, it is auto-disabled: detached, hooks/events/UI
// extensions stripped, status set to FAILED. The app ALWAYS boots — module
// failures never take down core bookkeeping.

use std::collections::HashMap;
use std::sync::Mutex;

use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::DbState;

pub const STATUS_HEALTHY: &str = "HEALTHY";
pub const STATUS_DEGRADED: &str = "DEGRADED";
pub const STATUS_FAILED: &str = "FAILED";
pub const STATUS_DISABLED: &str = "DISABLED";

#[derive(Debug, Clone, Serialize)]
pub struct ModuleHealth {
    pub module_id: String,
    pub status: String,
    pub error_count: i64,
    pub last_error: Option<String>,
    pub last_success_at: Option<i64>,
    pub window_start: Option<i64>,
}

pub struct HealthMonitor {
    pub modules: Mutex<HashMap<String, ModuleHealth>>,
}

pub fn new_monitor() -> HealthMonitor {
    HealthMonitor { modules: Mutex::new(HashMap::new()) }
}

fn read_thresholds(db: &DbState) -> (i64, i64) {
    // Defaults: 10 errors / 5 minutes. Read from settings if a company file
    // is open; fall back to defaults otherwise (e.g. during early startup).
    let mut threshold = 10_i64;
    let mut window_min = 5_i64;
    if let Ok(guard) = db.conn.lock() {
        if let Some(ref c) = *guard {
            if let Ok(v) = c.query_row::<String, _, _>(
                "SELECT value FROM settings WHERE key = 'module_error_threshold'",
                [], |r| r.get(0),
            ) {
                if let Ok(n) = v.parse::<i64>() { threshold = n; }
            }
            if let Ok(v) = c.query_row::<String, _, _>(
                "SELECT value FROM settings WHERE key = 'module_error_window_minutes'",
                [], |r| r.get(0),
            ) {
                if let Ok(n) = v.parse::<i64>() { window_min = n; }
            }
        }
    }
    (threshold, window_min)
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

fn write_log(
    db: &DbState,
    module_id: &str,
    event_type: &str,
    message: Option<&str>,
    error_count: i64,
) {
    if let Ok(guard) = db.conn.lock() {
        if let Some(ref c) = *guard {
            let _ = c.execute(
                "INSERT INTO module_health_log (module_id, event_type, message, error_count)
                 VALUES (?1, ?2, ?3, ?4)",
                params![module_id, event_type, message, error_count],
            );
        }
    }
}

/// Record an error for a module. Increments the in-window count and triggers
/// auto-disable if the count exceeds the threshold. Returns true iff this
/// call caused an auto-disable.
pub fn record_error(db: &DbState, module_id: &str, message: &str) -> bool {
    let (threshold, window_min) = read_thresholds(db);
    let window_secs = window_min * 60;
    let now = now_secs();

    let auto_disabled;
    let new_count;
    {
        let mut guard = db.health_monitor.modules.lock().unwrap();
        let entry = guard.entry(module_id.to_string()).or_insert_with(|| ModuleHealth {
            module_id: module_id.to_string(),
            status: STATUS_HEALTHY.to_string(),
            error_count: 0,
            last_error: None,
            last_success_at: None,
            window_start: None,
        });

        // Reset window if expired
        let in_window = entry.window_start.map(|ws| now - ws < window_secs).unwrap_or(false);
        if !in_window {
            entry.window_start = Some(now);
            entry.error_count = 0;
        }

        entry.error_count += 1;
        entry.last_error = Some(message.to_string());

        if entry.status == STATUS_HEALTHY {
            entry.status = STATUS_DEGRADED.to_string();
        }

        new_count = entry.error_count;
        if new_count > threshold {
            entry.status = STATUS_FAILED.to_string();
            auto_disabled = true;
        } else {
            auto_disabled = false;
        }
    }

    write_log(db, module_id, "error", Some(message), new_count);

    if auto_disabled {
        write_log(db, module_id, "auto_disable",
                  Some(&format!("exceeded {} errors in {} minutes", threshold, window_min)),
                  new_count);
        // Tear down: detach DB, unregister hooks/events/UI, mark FAILED in registry
        tear_down_module(db, module_id);
    }

    auto_disabled
}

/// Record a successful SDK call for a module. Resets the degraded counter
/// (without changing FAILED status — that requires explicit enable).
pub fn record_success(db: &DbState, module_id: &str) {
    let mut guard = db.health_monitor.modules.lock().unwrap();
    let entry = guard.entry(module_id.to_string()).or_insert_with(|| ModuleHealth {
        module_id: module_id.to_string(),
        status: STATUS_HEALTHY.to_string(),
        error_count: 0,
        last_error: None,
        last_success_at: None,
        window_start: None,
    });
    entry.last_success_at = Some(now_secs());
    if entry.status == STATUS_DEGRADED {
        entry.status = STATUS_HEALTHY.to_string();
        entry.error_count = 0;
        entry.window_start = None;
    }
}

/// Tear down a module after auto-disable: detach DB, clear hooks/events/UI
/// extensions/services, mark module_registry status='failed' with error msg.
fn tear_down_module(db: &DbState, module_id: &str) {
    let alias = module_id.replace(['.', '-'], "_");

    // Detach DB if attached
    let attached_now = db.attached_modules.lock().ok()
        .map(|a| a.iter().any(|m| m == &alias))
        .unwrap_or(false);
    if attached_now {
        if let Ok(guard) = db.conn.lock() {
            if let Some(ref c) = *guard {
                let alias_safe: String = alias.chars()
                    .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
                    .collect();
                let _ = c.execute_batch(&format!("DETACH DATABASE module_{};", alias_safe));
            }
        }
        if let Ok(mut a) = db.attached_modules.lock() {
            a.retain(|m| m != &alias);
        }
    }

    crate::sdk_v1::unregister_module_services(db, module_id);
    crate::hooks::unregister_all_for_module(db, module_id);
    crate::events::unsubscribe_all_for_module(db, module_id);
    crate::ui_extensions::unregister_all_for_module(db, module_id);

    if let Ok(guard) = db.conn.lock() {
        if let Some(ref c) = *guard {
            let _ = c.execute(
                "UPDATE module_registry SET status = 'failed',
                 error_message = 'auto-disabled: error threshold exceeded',
                 updated_at = datetime('now') WHERE id = ?1",
                params![module_id],
            );
        }
    }
}

#[tauri::command]
pub async fn get_health_status(
    db: State<'_, DbState>,
    module_id: String,
) -> Result<ModuleHealth, String> {
    let guard = db.health_monitor.modules.lock().map_err(|e| e.to_string())?;
    guard.get(&module_id).cloned().ok_or_else(|| format!("No health record for module: {}", module_id))
}

#[tauri::command]
pub async fn get_all_health_statuses(
    db: State<'_, DbState>,
) -> Result<Vec<ModuleHealth>, String> {
    let guard = db.health_monitor.modules.lock().map_err(|e| e.to_string())?;
    let mut out: Vec<ModuleHealth> = guard.values().cloned().collect();
    out.sort_by(|a, b| a.module_id.cmp(&b.module_id));
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct HealthLogEntry {
    pub id: i64,
    pub module_id: String,
    pub event_type: String,
    pub message: Option<String>,
    pub error_count: i64,
    pub timestamp: String,
}

#[tauri::command]
pub async fn get_health_history(
    db: State<'_, DbState>,
    module_id: String,
    limit: Option<i64>,
) -> Result<Vec<HealthLogEntry>, String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("No file is open")?;
    let lim = limit.unwrap_or(100);
    let mut stmt = conn.prepare(
        "SELECT id, module_id, event_type, message, error_count, timestamp
         FROM module_health_log WHERE module_id = ?1
         ORDER BY id DESC LIMIT ?2"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![module_id, lim], |row| {
        Ok(HealthLogEntry {
            id: row.get(0)?,
            module_id: row.get(1)?,
            event_type: row.get(2)?,
            message: row.get(3)?,
            error_count: row.get(4)?,
            timestamp: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

/// Manual init failure path: called by install/lifecycle code when a module
/// throws during init. Marks the module FAILED in the registry without
/// taking down the rest of the app.
pub fn record_init_failure(db: &DbState, module_id: &str, error: &str) {
    write_log(db, module_id, "init_failed", Some(error), 0);
    {
        let mut guard = db.health_monitor.modules.lock().unwrap();
        let entry = guard.entry(module_id.to_string()).or_insert_with(|| ModuleHealth {
            module_id: module_id.to_string(),
            status: STATUS_HEALTHY.to_string(),
            error_count: 0,
            last_error: None,
            last_success_at: None,
            window_start: None,
        });
        entry.status = STATUS_FAILED.to_string();
        entry.last_error = Some(error.to_string());
    }
    if let Ok(guard) = db.conn.lock() {
        if let Some(ref c) = *guard {
            let _ = c.execute(
                "UPDATE module_registry SET status = 'failed', error_message = ?2,
                 updated_at = datetime('now') WHERE id = ?1",
                params![module_id, error],
            );
        }
    }
}
