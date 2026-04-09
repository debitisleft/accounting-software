// Phase 42: Sync hook bus.
//
// Hooks run INSIDE the database transaction. A `before_*` hook can reject and
// abort the operation entirely. An `after_*` hook can also reject — and rolls
// back the transaction if it does. The kernel-side registry stored here is the
// authoritative list of who is listening; the actual cross-process invocation
// of module-side handlers is wired through the iframe postMessage bridge in
// Phase 43. For Phase 42 the Rust `run_hooks` is a no-op iterator that the
// engine commands call at the right points so that integration is in place
// before the bridge lands.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::DbState;
use crate::permissions::check_permission;

pub const HOOK_TYPES: &[&str] = &[
    "before_transaction_create",
    "after_transaction_create",
    "before_transaction_void",
    "after_transaction_void",
    "before_account_update",
    "after_account_update",
];

#[derive(Debug, Clone, Serialize)]
pub struct RegisteredHook {
    pub module_id: String,
    pub hook_type: String,
    pub priority: i64,
}

/// In-memory hook registry. Key: hook_type → ordered list of registered hooks
/// (sorted by priority ascending).
pub type HookRegistry = Mutex<HashMap<String, Vec<RegisteredHook>>>;

pub fn new_registry() -> HookRegistry {
    Mutex::new(HashMap::new())
}

fn validate_hook_type(t: &str) -> Result<(), String> {
    if !HOOK_TYPES.contains(&t) {
        return Err(format!("Unknown hook type: {}", t));
    }
    Ok(())
}

pub fn register_hook_internal(
    db: &DbState,
    module_id: String,
    hook_type: String,
    priority: i64,
) -> Result<(), String> {
    validate_hook_type(&hook_type)?;
    let mut reg = db.hook_registry.lock().map_err(|e| e.to_string())?;
    let entry = reg.entry(hook_type.clone()).or_default();
    entry.retain(|h| h.module_id != module_id);
    entry.push(RegisteredHook { module_id, hook_type, priority });
    entry.sort_by_key(|h| h.priority);
    Ok(())
}

pub fn unregister_hook_internal(
    db: &DbState,
    module_id: &str,
    hook_type: &str,
) -> Result<(), String> {
    let mut reg = db.hook_registry.lock().map_err(|e| e.to_string())?;
    if let Some(list) = reg.get_mut(hook_type) {
        list.retain(|h| h.module_id != module_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn sdk_register_hook(
    db: State<'_, DbState>,
    module_id: String,
    hook_type: String,
    priority: Option<i64>,
) -> Result<(), String> {
    check_permission(&db, &module_id, "hooks:before_write")?;
    register_hook_internal(&db, module_id, hook_type, priority.unwrap_or(100))
}

#[tauri::command]
pub async fn sdk_unregister_hook(
    db: State<'_, DbState>,
    module_id: String,
    hook_type: String,
) -> Result<(), String> {
    unregister_hook_internal(&db, &module_id, &hook_type)
}

#[tauri::command]
pub async fn list_hooks(
    db: State<'_, DbState>,
) -> Result<Vec<RegisteredHook>, String> {
    let reg = db.hook_registry.lock().map_err(|e| e.to_string())?;
    let mut out: Vec<RegisteredHook> = reg.values().flatten().cloned().collect();
    out.sort_by(|a, b| a.hook_type.cmp(&b.hook_type).then(a.priority.cmp(&b.priority)));
    Ok(out)
}

/// Run all registered hooks for a given hook_type with the supplied context.
///
/// Phase 42: stub. Returns Ok(()) immediately because there is no live
/// cross-process channel into module iframes yet. Phase 43 (UI Isolation)
/// will replace this with a postMessage round-trip that can return rejection.
///
/// Engine commands MUST still call this at the right points so that the
/// integration sites are in place when Phase 43 lands.
pub fn run_hooks(
    _db: &DbState,
    _hook_type: &str,
    _context: &serde_json::Value,
) -> Result<(), String> {
    Ok(())
}

/// Cleanup helper called from disable/uninstall_module.
pub fn unregister_all_for_module(db: &DbState, module_id: &str) {
    if let Ok(mut reg) = db.hook_registry.lock() {
        for list in reg.values_mut() {
            list.retain(|h| h.module_id != module_id);
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct HookContext {
    #[allow(dead_code)]
    pub data: serde_json::Value,
}
