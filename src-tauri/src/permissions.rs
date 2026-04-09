// Phase 41: Permission enforcer.
//
// Every SDK v1 method calls `check_permission(db, module_id, scope)` at the
// top of its body. The check looks up `module_permissions` for the module's
// granted scopes — modules cannot use any SDK method they were not granted
// permission for at install time (or via grant_module_permission).

use rusqlite::params;
use tauri::State;

use crate::DbState;

/// Full permission taxonomy. The kernel enforces this set; modules declare
/// these strings in their manifest. Unknown scopes are accepted at install
/// time but never grant access to anything.
pub const ALL_SCOPES: &[&str] = &[
    // READ
    "ledger:read",
    "ledger:read_balances",
    "accounts:read",
    "contacts:read",
    "reports:read",
    "documents:read",
    // WRITE
    "ledger:write",
    "ledger:write_reversals",
    "accounts:write",
    "contacts:write",
    "reports:create_custom",
    "documents:write",
    // SYSTEM
    "events:subscribe",
    "hooks:before_write",
    "storage:own",
    "services:register",
    "services:call",
    "ui:nav_item",
    "ui:settings_pane",
    "ui:transaction_action",
    "ui:column_provider",
];

/// Check whether a module has been granted a specific scope. Returns Err
/// with a stable, parseable message that the host can surface to the user.
pub fn check_permission(
    db: &DbState,
    module_id: &str,
    scope: &str,
) -> Result<(), String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("No file is open")?;
    let granted: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM module_permissions WHERE module_id = ?1 AND scope = ?2",
        params![module_id, scope],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if !granted {
        return Err(format!(
            "Module '{}' does not have permission '{}'",
            module_id, scope
        ));
    }
    Ok(())
}

/// Insert a permission grant row. Idempotent (UNIQUE constraint).
pub fn grant_internal(
    db: &DbState,
    module_id: &str,
    scope: &str,
) -> Result<(), String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("No file is open")?;
    conn.execute(
        "INSERT OR IGNORE INTO module_permissions (module_id, scope) VALUES (?1, ?2)",
        params![module_id, scope],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn grant_module_permission(
    db: State<'_, DbState>,
    module_id: String,
    scope: String,
) -> Result<(), String> {
    // Verify the module exists
    {
        let guard = db.conn.lock().map_err(|e| e.to_string())?;
        let conn = guard.as_ref().ok_or("No file is open")?;
        let exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM module_registry WHERE id = ?1",
            params![module_id],
            |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        if !exists {
            return Err(format!("Module not found: {}", module_id));
        }
    }
    grant_internal(&db, &module_id, &scope)
}

#[tauri::command]
pub async fn revoke_module_permission(
    db: State<'_, DbState>,
    module_id: String,
    scope: String,
) -> Result<(), String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("No file is open")?;
    let n = conn.execute(
        "DELETE FROM module_permissions WHERE module_id = ?1 AND scope = ?2",
        params![module_id, scope],
    ).map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!(
            "Module '{}' does not have permission '{}'",
            module_id, scope
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_module_permissions(
    db: State<'_, DbState>,
    module_id: String,
) -> Result<Vec<String>, String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("No file is open")?;
    let mut stmt = conn.prepare(
        "SELECT scope FROM module_permissions WHERE module_id = ?1 ORDER BY scope"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![module_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

/// Wipe all permissions for a module. Used by uninstall_module.
pub fn revoke_all(db: &DbState, module_id: &str) -> Result<(), String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("No file is open")?;
    conn.execute(
        "DELETE FROM module_permissions WHERE module_id = ?1",
        params![module_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
