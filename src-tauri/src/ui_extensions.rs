// Phase 43: UI Extension Registry.
//
// Modules can register navigation items, settings panes, and per-transaction
// actions. The registry is in-memory only — modules re-register on init each
// time the company file is opened.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::DbState;
use crate::permissions::check_permission;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavItemExtension {
    pub module_id: String,
    pub label: String,
    pub icon: Option<String>,
    pub route: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsPaneExtension {
    pub module_id: String,
    pub label: String,
    pub route: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionActionExtension {
    pub module_id: String,
    pub label: String,
    pub action_id: String,
}

pub struct UiExtensionRegistry {
    pub nav_items: Mutex<HashMap<String, Vec<NavItemExtension>>>,        // module_id -> items
    pub settings_panes: Mutex<HashMap<String, Vec<SettingsPaneExtension>>>,
    pub transaction_actions: Mutex<HashMap<String, Vec<TransactionActionExtension>>>,
}

pub fn new_registry() -> UiExtensionRegistry {
    UiExtensionRegistry {
        nav_items: Mutex::new(HashMap::new()),
        settings_panes: Mutex::new(HashMap::new()),
        transaction_actions: Mutex::new(HashMap::new()),
    }
}

#[tauri::command]
pub async fn sdk_register_nav_item(
    db: State<'_, DbState>,
    module_id: String,
    label: String,
    icon: Option<String>,
    route: Option<String>,
) -> Result<(), String> {
    check_permission(&db, &module_id, "ui:nav_item")?;
    let route = route.unwrap_or_else(|| format!("/module/{}", module_id));
    let mut reg = db.ui_extensions.nav_items.lock().map_err(|e| e.to_string())?;
    let entry = reg.entry(module_id.clone()).or_default();
    entry.retain(|n| n.label != label);
    entry.push(NavItemExtension { module_id, label, icon, route });
    Ok(())
}

#[tauri::command]
pub async fn sdk_register_settings_pane(
    db: State<'_, DbState>,
    module_id: String,
    label: String,
    route: Option<String>,
) -> Result<(), String> {
    check_permission(&db, &module_id, "ui:settings_pane")?;
    let route = route.unwrap_or_else(|| format!("/module/{}/settings", module_id));
    let mut reg = db.ui_extensions.settings_panes.lock().map_err(|e| e.to_string())?;
    let entry = reg.entry(module_id.clone()).or_default();
    entry.retain(|s| s.label != label);
    entry.push(SettingsPaneExtension { module_id, label, route });
    Ok(())
}

#[tauri::command]
pub async fn sdk_register_transaction_action(
    db: State<'_, DbState>,
    module_id: String,
    label: String,
    action_id: String,
) -> Result<(), String> {
    check_permission(&db, &module_id, "ui:transaction_action")?;
    let mut reg = db.ui_extensions.transaction_actions.lock().map_err(|e| e.to_string())?;
    let entry = reg.entry(module_id.clone()).or_default();
    entry.retain(|a| a.action_id != action_id);
    entry.push(TransactionActionExtension { module_id, label, action_id });
    Ok(())
}

#[tauri::command]
pub async fn get_nav_items(db: State<'_, DbState>) -> Result<Vec<NavItemExtension>, String> {
    let reg = db.ui_extensions.nav_items.lock().map_err(|e| e.to_string())?;
    let mut out: Vec<NavItemExtension> = reg.values().flatten().cloned().collect();
    out.sort_by(|a, b| a.module_id.cmp(&b.module_id).then(a.label.cmp(&b.label)));
    Ok(out)
}

#[tauri::command]
pub async fn get_settings_panes(db: State<'_, DbState>) -> Result<Vec<SettingsPaneExtension>, String> {
    let reg = db.ui_extensions.settings_panes.lock().map_err(|e| e.to_string())?;
    let mut out: Vec<SettingsPaneExtension> = reg.values().flatten().cloned().collect();
    out.sort_by(|a, b| a.module_id.cmp(&b.module_id).then(a.label.cmp(&b.label)));
    Ok(out)
}

#[tauri::command]
pub async fn get_transaction_actions(db: State<'_, DbState>) -> Result<Vec<TransactionActionExtension>, String> {
    let reg = db.ui_extensions.transaction_actions.lock().map_err(|e| e.to_string())?;
    let mut out: Vec<TransactionActionExtension> = reg.values().flatten().cloned().collect();
    out.sort_by(|a, b| a.module_id.cmp(&b.module_id).then(a.label.cmp(&b.label)));
    Ok(out)
}

/// Cleanup helper for disable/uninstall.
pub fn unregister_all_for_module(db: &DbState, module_id: &str) {
    if let Ok(mut r) = db.ui_extensions.nav_items.lock() {
        r.remove(module_id);
    }
    if let Ok(mut r) = db.ui_extensions.settings_panes.lock() {
        r.remove(module_id);
    }
    if let Ok(mut r) = db.ui_extensions.transaction_actions.lock() {
        r.remove(module_id);
    }
}

// ── Module file serving (Phase 43, Part 4) ──────────────

fn safe_mime_type(filename: &str) -> &'static str {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html",
        "js" | "mjs" => "application/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

#[derive(Debug, Serialize)]
pub struct ModuleFile {
    pub mime_type: String,
    pub content: String, // base64 for binary, raw text for text
    pub is_binary: bool,
}

#[tauri::command]
pub async fn get_module_file(
    db: State<'_, DbState>,
    module_id: String,
    file_path: String,
) -> Result<ModuleFile, String> {
    // Reject path traversal
    if file_path.contains("..") || file_path.starts_with('/') || file_path.starts_with('\\') {
        return Err(format!("Invalid file path: {}", file_path));
    }

    // Look up the module's install path from the registry
    let install_path: Option<String> = {
        let guard = db.conn.lock().map_err(|e| e.to_string())?;
        let conn = guard.as_ref().ok_or("No file is open")?;
        conn.query_row(
            "SELECT install_path FROM module_registry WHERE id = ?1",
            rusqlite::params![module_id],
            |row| row.get(0),
        ).map_err(|_| format!("Module not found: {}", module_id))?
    };
    let install_path = install_path.ok_or_else(|| format!("Module has no install_path: {}", module_id))?;

    let full = std::path::Path::new(&install_path).join(&file_path);
    let bytes = std::fs::read(&full).map_err(|e| format!("Failed to read {}: {}", file_path, e))?;
    let mime = safe_mime_type(&file_path);
    let is_binary = !mime.starts_with("text/")
        && mime != "application/javascript"
        && mime != "application/json"
        && mime != "image/svg+xml";

    let content = if is_binary {
        // Hex-encode binary so we don't need to add the base64 crate
        bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };

    Ok(ModuleFile {
        mime_type: mime.to_string(),
        content,
        is_binary,
    })
}
