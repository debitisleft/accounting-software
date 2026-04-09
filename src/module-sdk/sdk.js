// Phase 43: Module-side SDK bridge.
//
// Modules import this file (or include it via <script>) and call into a
// clean namespaced API. Internally each call posts a message to the host
// frame and waits for a matching response.
//
// SECURITY: this file runs INSIDE the iframe sandbox. It has no DOM access to
// the host app. The only channel out is window.parent.postMessage, which the
// host validates against the iframe's module_id and the module's permissions.

const PENDING = new Map(); // request_id -> { resolve, reject, timer }
const TIMEOUT_MS = 30000;
let nextRequestId = 1;

// MODULE_ID is injected by the host when constructing the iframe srcdoc.
// Modules MUST NOT spoof another module's id — the host re-validates each
// incoming message against the iframe's owner.
const MODULE_ID = (typeof window !== 'undefined' && window.__MODULE_ID__) || 'unknown';

function call(method, params) {
  return new Promise((resolve, reject) => {
    const request_id = `req_${nextRequestId++}`;
    const timer = setTimeout(() => {
      PENDING.delete(request_id);
      reject(new Error(`SDK call '${method}' timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    PENDING.set(request_id, { resolve, reject, timer });
    window.parent.postMessage(
      { type: 'sdk_call', module_id: MODULE_ID, request_id, method, params },
      '*',
    );
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || msg.type !== 'sdk_response') return;
    const pending = PENDING.get(msg.request_id);
    if (!pending) return;
    clearTimeout(pending.timer);
    PENDING.delete(msg.request_id);
    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(msg.result);
  });
}

// Public API surface — keep namespaces aligned with sdk_v1.rs categories.
export const sdk = {
  ledger: {
    createTransaction: (input) => call('sdk_create_transaction', input),
    voidTransaction: (txId, reason) => call('sdk_void_transaction', { tx_id: txId, reason }),
    getAccountBalance: (accountId, asOf) => call('sdk_get_account_balance', { account_id: accountId, as_of: asOf }),
    getTrialBalance: () => call('sdk_get_trial_balance', {}),
    getJournalEntries: (filters) => call('sdk_get_journal_entries', filters),
  },
  accounts: {
    create: (data) => call('sdk_create_account', data),
    update: (id, fields) => call('sdk_update_account', { id, ...fields }),
    deactivate: (id) => call('sdk_deactivate_account', { id }),
    getChartOfAccounts: () => call('sdk_get_chart_of_accounts', {}),
  },
  contacts: {
    create: (data) => call('sdk_create_contact', { data }),
    get: (id) => call('sdk_get_contact', { id }),
    list: (filters) => call('sdk_list_contacts', filters || {}),
    getLedger: (id, range) => call('sdk_get_contact_ledger', { contact_id: id, ...(range || {}) }),
  },
  documents: {
    attach: (entityType, entityId, filePath, filename, description) =>
      call('sdk_attach_document', { entity_type: entityType, entity_id: entityId, file_path: filePath, filename, description }),
    list: (entityType, entityId) =>
      call('sdk_get_documents', { entity_type: entityType, entity_id: entityId }),
    delete: (id) => call('sdk_delete_document', { document_id: id }),
  },
  reports: {
    incomeStatement: (start, end) => call('sdk_get_income_statement', { start_date: start, end_date: end }),
    balanceSheet: (asOf) => call('sdk_get_balance_sheet', { as_of: asOf }),
    cashFlow: (start, end) => call('sdk_get_cash_flow', { start_date: start, end_date: end }),
  },
  storage: {
    createTable: (name, columnsSql) => call('sdk_storage_create_table', { table_name: name, columns_sql: columnsSql }),
    insert: (table, row) => call('sdk_storage_insert', { table_name: table, row }),
    query: (table, filters) => call('sdk_storage_query', { table_name: table, filters }),
    update: (table, id, fields) => call('sdk_storage_update', { table_name: table, id, fields }),
    delete: (table, id) => call('sdk_storage_delete', { table_name: table, id }),
  },
  hooks: {
    register: (hookType, priority) => call('sdk_register_hook', { hook_type: hookType, priority }),
    unregister: (hookType) => call('sdk_unregister_hook', { hook_type: hookType }),
  },
  events: {
    subscribe: (eventType) => call('sdk_subscribe_event', { event_type: eventType }),
    unsubscribe: (eventType) => call('sdk_unsubscribe_event', { event_type: eventType }),
    emit: (eventType, payload) => call('sdk_emit_event', { event_type: eventType, payload }),
  },
  services: {
    register: (serviceName, info) => call('sdk_register_service', { service_name: serviceName, info }),
    call: (targetModuleId, serviceName, params) =>
      call('sdk_call_service', { target_module_id: targetModuleId, service_name: serviceName, params }),
    list: () => call('sdk_list_services', {}),
  },
  ui: {
    registerNavItem: (label, icon, route) => call('sdk_register_nav_item', { label, icon, route }),
    registerSettingsPane: (label, route) => call('sdk_register_settings_pane', { label, route }),
    registerTransactionAction: (label, actionId) => call('sdk_register_transaction_action', { label, action_id: actionId }),
  },
  version: () => call('get_sdk_version', {}),
};

if (typeof window !== 'undefined') {
  window.sdk = sdk;
}
