// Phase 43: SDK postMessage bridge dispatcher.
//
// Pure function the host frame uses to translate an incoming
// `{ type: 'sdk_call', module_id, request_id, method, params }` message into
// a Tauri invoke + permission check + response. Extracted from ModuleFrame
// so the dispatch logic can be unit tested in node without a DOM.

import { invoke } from '@tauri-apps/api/core'

export interface SdkCallMessage {
  type: 'sdk_call'
  module_id: string
  request_id: string
  method: string
  params: Record<string, unknown>
}

export interface SdkResponseMessage {
  type: 'sdk_response'
  request_id: string
  result?: unknown
  error?: string
}

/// Methods modules are allowed to call through the bridge. The set is the
/// SDK v1 surface plus the UI extension and version helpers — anything not on
/// this list is rejected with a stable error before any Tauri call.
const ALLOWED_METHODS = new Set([
  // Versioning
  'get_sdk_version',
  // Ledger
  'sdk_create_transaction', 'sdk_void_transaction', 'sdk_get_account_balance',
  'sdk_get_trial_balance', 'sdk_get_journal_entries',
  // Account
  'sdk_create_account', 'sdk_update_account', 'sdk_deactivate_account',
  'sdk_get_chart_of_accounts',
  // Contact
  'sdk_create_contact', 'sdk_get_contact', 'sdk_list_contacts', 'sdk_get_contact_ledger',
  // Document
  'sdk_attach_document', 'sdk_get_documents', 'sdk_delete_document',
  // Report
  'sdk_get_income_statement', 'sdk_get_balance_sheet', 'sdk_get_cash_flow',
  // Storage
  'sdk_storage_create_table', 'sdk_storage_insert', 'sdk_storage_query',
  'sdk_storage_update', 'sdk_storage_delete',
  // Service
  'sdk_register_service', 'sdk_call_service', 'sdk_list_services',
  // Hooks & Events
  'sdk_register_hook', 'sdk_unregister_hook',
  'sdk_subscribe_event', 'sdk_unsubscribe_event', 'sdk_emit_event',
  // UI extensions
  'sdk_register_nav_item', 'sdk_register_settings_pane', 'sdk_register_transaction_action',
])

/// Validate that an incoming postMessage is a well-formed SDK call from the
/// expected module id. Returns null if valid, an error string otherwise.
export function validateSdkCall(
  msg: unknown,
  expectedModuleId: string,
): { ok: true; call: SdkCallMessage } | { ok: false; error: string; request_id?: string } {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Invalid message: not an object' }
  const m = msg as Record<string, unknown>
  if (m.type !== 'sdk_call') return { ok: false, error: 'Invalid message: type must be sdk_call' }
  if (typeof m.module_id !== 'string') return { ok: false, error: 'Invalid message: missing module_id' }
  if (m.module_id !== expectedModuleId) {
    return {
      ok: false,
      error: `Module id mismatch: iframe owns '${expectedModuleId}' but message claims '${m.module_id}'`,
      request_id: typeof m.request_id === 'string' ? m.request_id : undefined,
    }
  }
  if (typeof m.request_id !== 'string') return { ok: false, error: 'Invalid message: missing request_id' }
  if (typeof m.method !== 'string') return { ok: false, error: 'Invalid message: missing method', request_id: m.request_id }
  if (!ALLOWED_METHODS.has(m.method)) {
    return {
      ok: false,
      error: `Method not on the SDK allow-list: ${m.method}`,
      request_id: m.request_id,
    }
  }
  return {
    ok: true,
    call: {
      type: 'sdk_call',
      module_id: m.module_id as string,
      request_id: m.request_id as string,
      method: m.method as string,
      params: (m.params as Record<string, unknown>) ?? {},
    },
  }
}

/// Dispatch a validated SDK call through Tauri IPC. Returns the response
/// message that should be posted back into the iframe.
export async function dispatchSdkCall(call: SdkCallMessage): Promise<SdkResponseMessage> {
  // Every SDK v1 method takes module_id as the first parameter; the bridge
  // injects it from the iframe's owner so the iframe can never spoof another
  // module's id (defence in depth — validateSdkCall already enforces this).
  const args = { moduleId: call.module_id, ...call.params }
  try {
    const result = await invoke<unknown>(call.method, args)
    return { type: 'sdk_response', request_id: call.request_id, result }
  } catch (e) {
    return {
      type: 'sdk_response',
      request_id: call.request_id,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/// Convenience: validate + dispatch in one call. Returns a response message
/// in all cases (validation failure produces an error response).
export async function handleIncomingMessage(
  msg: unknown,
  expectedModuleId: string,
): Promise<SdkResponseMessage> {
  const v = validateSdkCall(msg, expectedModuleId)
  if (!v.ok) {
    return {
      type: 'sdk_response',
      request_id: v.request_id ?? 'invalid',
      error: v.error,
    }
  }
  return dispatchSdkCall(v.call)
}
