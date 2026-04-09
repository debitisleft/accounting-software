// Phase 42: Async event bus.
//
// Events fire AFTER commit. Subscribers receive them fire-and-forget — errors
// in any subscriber are logged but never propagated, never roll back the
// originating transaction, and never block other subscribers from receiving
// the event.
//
// Phase 42: the kernel keeps the subscription registry and an in-memory
// emission buffer (most-recent-first, capped). Phase 43 wires real cross-
// process delivery via iframe postMessage. Tests against the kernel inspect
// the buffer; tests against MockApi register live JS callbacks.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use crate::DbState;
use crate::permissions::check_permission;

pub const EVENT_TYPES: &[&str] = &[
    "transaction.created",
    "transaction.voided",
    "transaction.updated",
    "account.created",
    "account.updated",
    "account.deactivated",
    "contact.created",
    "contact.updated",
    "period.locked",
    "period.unlocked",
    "module.installed",
    "module.uninstalled",
    "reconciliation.completed",
    "fiscal_year.closed",
];

const EMISSION_BUFFER_CAPACITY: usize = 256;

#[derive(Debug, Clone, Serialize)]
pub struct Subscription {
    pub module_id: String,
    pub event_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EmittedEvent {
    pub event_type: String,
    pub timestamp: String,
    pub data: serde_json::Value,
}

pub struct EventBus {
    pub subscribers: Mutex<HashMap<String, Vec<String>>>, // event_type → [module_id]
    pub emissions: Mutex<Vec<EmittedEvent>>,
}

pub fn new_bus() -> EventBus {
    EventBus {
        subscribers: Mutex::new(HashMap::new()),
        emissions: Mutex::new(Vec::new()),
    }
}

pub fn subscribe_internal(db: &DbState, module_id: String, event_type: String) -> Result<(), String> {
    let mut subs = db.event_bus.subscribers.lock().map_err(|e| e.to_string())?;
    let entry = subs.entry(event_type).or_default();
    if !entry.contains(&module_id) {
        entry.push(module_id);
    }
    Ok(())
}

pub fn unsubscribe_internal(db: &DbState, module_id: &str, event_type: &str) -> Result<(), String> {
    let mut subs = db.event_bus.subscribers.lock().map_err(|e| e.to_string())?;
    if let Some(list) = subs.get_mut(event_type) {
        list.retain(|m| m != module_id);
    }
    Ok(())
}

/// Emit an event. Records it in the in-memory buffer (capped) and — once
/// Phase 43 lands — dispatches to each subscribed module's iframe via
/// postMessage. Errors in subscribers are LOGGED, never propagated.
pub fn emit_event(db: &DbState, event_type: &str, data: serde_json::Value) {
    let now = chrono::Utc::now().to_rfc3339();
    let evt = EmittedEvent {
        event_type: event_type.to_string(),
        timestamp: now,
        data,
    };

    if let Ok(mut buf) = db.event_bus.emissions.lock() {
        buf.push(evt.clone());
        if buf.len() > EMISSION_BUFFER_CAPACITY {
            let drop_n = buf.len() - EMISSION_BUFFER_CAPACITY;
            buf.drain(0..drop_n);
        }
    }

    // Phase 43 will iterate subscribers and postMessage to each iframe.
    // For now we just record the emission so the host can verify routing.
}

#[tauri::command]
pub async fn sdk_subscribe_event(
    db: State<'_, DbState>,
    module_id: String,
    event_type: String,
) -> Result<(), String> {
    check_permission(&db, &module_id, "events:subscribe")?;
    subscribe_internal(&db, module_id, event_type)
}

#[tauri::command]
pub async fn sdk_unsubscribe_event(
    db: State<'_, DbState>,
    module_id: String,
    event_type: String,
) -> Result<(), String> {
    unsubscribe_internal(&db, &module_id, &event_type)
}

#[tauri::command]
pub async fn sdk_emit_event(
    db: State<'_, DbState>,
    module_id: String,
    event_type: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    let _ = module_id; // any installed module can emit a custom event
    emit_event(&db, &event_type, payload);
    Ok(())
}

#[tauri::command]
pub async fn list_subscriptions(
    db: State<'_, DbState>,
) -> Result<Vec<Subscription>, String> {
    let subs = db.event_bus.subscribers.lock().map_err(|e| e.to_string())?;
    let mut out: Vec<Subscription> = Vec::new();
    for (event_type, modules) in subs.iter() {
        for m in modules {
            out.push(Subscription { module_id: m.clone(), event_type: event_type.clone() });
        }
    }
    out.sort_by(|a, b| a.event_type.cmp(&b.event_type).then(a.module_id.cmp(&b.module_id)));
    Ok(out)
}

#[tauri::command]
pub async fn get_recent_events(
    db: State<'_, DbState>,
    limit: Option<usize>,
) -> Result<Vec<EmittedEvent>, String> {
    let buf = db.event_bus.emissions.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(buf.len());
    let start = if buf.len() > lim { buf.len() - lim } else { 0 };
    Ok(buf[start..].iter().rev().cloned().collect())
}

/// Cleanup helper called from disable/uninstall_module.
pub fn unsubscribe_all_for_module(db: &DbState, module_id: &str) {
    if let Ok(mut subs) = db.event_bus.subscribers.lock() {
        for list in subs.values_mut() {
            list.retain(|m| m != module_id);
        }
    }
}
