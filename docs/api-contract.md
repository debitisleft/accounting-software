# API Contract — Stable Commands

This document lists all Tauri commands exposed to the frontend. Commands are classified as:
- **STABLE** — safe for modules to depend on, signature will not change without deprecation
- **INTERNAL** — may change between versions, do not depend on from modules
- **SYSTEM** — never call directly, used internally by the engine

## File Management

| Command | Stability | Parameters | Returns |
|---------|-----------|-----------|---------|
| `create_new_file` | STABLE | `path: string, company_name: string` | `FileInfo` |
| `open_file` | STABLE | `path: string` | `FileInfo` |
| `close_file` | STABLE | _(none)_ | `void` |
| `is_file_open` | STABLE | _(none)_ | `boolean` |
| `get_recent_files` | STABLE | _(none)_ | `RecentFile[]` |
| `open_recent_file` | STABLE | `path: string` | `FileInfo` |
| `remove_recent_file` | STABLE | `path: string` | `void` |

## Accounts

| Command | Stability | Parameters | Returns |
|---------|-----------|-----------|---------|
| `get_accounts` | STABLE | _(none)_ | `Account[]` |
| `create_account` | STABLE | `code, name, type, parent_id?` | `string` (id) |
| `update_account` | STABLE | `account_id, name?, code?` | `void` |
| `deactivate_account` | STABLE | `account_id` | `void` |
| `reactivate_account` | STABLE | `account_id` | `void` |

## Transactions

| Command | Stability | Parameters | Returns |
|---------|-----------|-----------|---------|
| `create_transaction` | STABLE | `date, description, reference?, journal_type?, entries[]` | `string` (id) |
| `get_transaction_detail` | STABLE | `transaction_id` | `TransactionWithEntries` |
| `list_transactions` | STABLE | `offset?, limit?, start_date?, end_date?, account_id?, memo_search?` | `ListTransactionsResult` |
| `count_transactions` | STABLE | `start_date?, end_date?, account_id?, memo_search?` | `number` |
| `update_transaction` | STABLE | `transaction_id, date?, description?, reference?` | `void` |
| `update_transaction_lines` | STABLE | `transaction_id, entries[]` | `void` |
| `void_transaction` | STABLE | `transaction_id` | `string` (void tx id) |
| `get_audit_log` | STABLE | `transaction_id` | `AuditLogEntry[]` |

## Reports

| Command | Stability | Parameters | Returns |
|---------|-----------|-----------|---------|
| `get_account_balance` | STABLE | `account_id, as_of_date?` | `number` (cents) |
| `get_trial_balance` | STABLE | `as_of_date?, exclude_journal_types?` | `TrialBalanceResult` |
| `get_income_statement` | STABLE | `start_date, end_date, exclude_journal_types?` | `IncomeStatementResult` |
| `get_balance_sheet` | STABLE | `as_of_date` | `BalanceSheetResult` |
| `get_account_ledger` | STABLE | `account_id, start_date?, end_date?, offset?, limit?` | `AccountLedgerResult` |
| `get_dashboard_summary` | INTERNAL | _(none)_ | `DashboardSummary` |
| `export_csv` | STABLE | `export_type, options?` | `string` (CSV content) |

## Period Management

| Command | Stability | Parameters | Returns |
|---------|-----------|-----------|---------|
| `lock_period_global` | STABLE | `end_date` | `void` |
| `unlock_period_global` | STABLE | _(none)_ | `void` |
| `list_locked_periods_global` | STABLE | _(none)_ | `LockedPeriod[]` |
| `is_date_locked` | STABLE | `date` | `boolean` |

## Fiscal Year

| Command | Stability | Parameters | Returns |
|---------|-----------|-----------|---------|
| `enter_opening_balances` | STABLE | `balances[], effective_date` | `string` (tx id) |
| `close_fiscal_year` | STABLE | `fiscal_year_end_date` | `FiscalYearCloseResult` |
| `list_fiscal_year_closes` | STABLE | _(none)_ | `FiscalYearCloseInfo[]` |

## Settings

| Command | Stability | Parameters | Returns |
|---------|-----------|-----------|---------|
| `get_setting` | STABLE | `key` | `string \| null` |
| `set_setting` | STABLE | `key, value` | `void` |
| `get_all_settings` | STABLE | _(none)_ | `Record<string, string>` |

## Backup

| Command | Stability | Parameters | Returns |
|---------|-----------|-----------|---------|
| `export_database` | STABLE | `destination` | `ExportResult` |
| `import_database` | STABLE | `source` | `ImportResult` |
| `auto_backup` | INTERNAL | _(none)_ | `AutoBackupResult` |
| `list_backups` | INTERNAL | _(none)_ | `BackupInfo[]` |

## Modules

| Command | Stability | Parameters | Returns |
|---------|-----------|-----------|---------|
| `list_modules` | STABLE | _(none)_ | `Module[]` |
| `get_module` | STABLE | `module_id` | `Module` |

## Module Convention

- Module tables use prefix: `mod_{module_name}_` (e.g., `mod_invoicing_invoices`)
- Core engine tables never use the `mod_` prefix
- Module data lives inside each `.sqlite` file (same data ownership principle)
- Modules register in the `modules` table with a unique `table_prefix`
