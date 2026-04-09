-- Invoicing module schema, version 1.
-- Tables are created via the SDK Storage API into module_com_bookkeeping_invoicing.*
-- Money is stored as INTEGER cents (matches the kernel's hard rule).

CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT UNIQUE NOT NULL,
    customer_contact_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','viewed','partial','paid','overdue','void')),
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    terms TEXT NOT NULL DEFAULT 'Net 30',
    subtotal INTEGER NOT NULL DEFAULT 0,
    tax_amount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    amount_paid INTEGER NOT NULL DEFAULT 0,
    balance_due INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    transaction_id TEXT,
    payment_transaction_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_lines (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_price INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS invoice_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO invoice_settings (key, value) VALUES
    ('next_invoice_number', '1'),
    ('default_terms', 'Net 30'),
    ('default_ar_account_id', ''),
    ('company_name', ''),
    ('company_address', ''),
    ('payment_instructions', '');
