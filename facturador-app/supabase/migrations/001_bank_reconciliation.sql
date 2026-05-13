-- ============================================================
-- Cerezo · Bank Reconciliation Module — Supabase Migration
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Bank Transactions table
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name TEXT NOT NULL DEFAULT 'Principal',
  transaction_date DATE NOT NULL,
  value_date DATE,
  description TEXT NOT NULL,
  reference TEXT,
  amount NUMERIC(12,2) NOT NULL,
  balance NUMERIC(12,2),
  category TEXT,
  source_file TEXT,
  import_batch TEXT,
  is_reconciled BOOLEAN DEFAULT FALSE,
  notes TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_tx_date ON bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_bank_tx_reconciled ON bank_transactions(is_reconciled);
CREATE INDEX IF NOT EXISTS idx_bank_tx_amount ON bank_transactions(amount);
CREATE INDEX IF NOT EXISTS idx_bank_tx_batch ON bank_transactions(import_batch);

-- 2. Reconciliations junction table
CREATE TABLE IF NOT EXISTS reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id UUID NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  applied_amount NUMERIC(12,2) NOT NULL,
  adjustment_amount NUMERIC(12,2) DEFAULT 0,
  adjustment_reason TEXT,
  match_type TEXT DEFAULT 'manual',
  match_confidence NUMERIC(3,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (
    (invoice_id IS NOT NULL AND expense_id IS NULL) OR
    (invoice_id IS NULL AND expense_id IS NOT NULL) OR
    (invoice_id IS NULL AND expense_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_recon_bank_tx ON reconciliations(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_recon_invoice ON reconciliations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_recon_expense ON reconciliations(expense_id);

-- 3. RLS
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON bank_transactions
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON reconciliations
  FOR ALL USING (true) WITH CHECK (true);
