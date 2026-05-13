import type { ExpenseCategory } from './accounting-types';

// ─── Bank Transaction ────────────────────────────────────────────────

export interface BankTransaction {
  id: string;
  accountName: string;
  transactionDate: string; // YYYY-MM-DD
  valueDate: string | null;
  description: string;
  reference: string | null;
  amount: number; // positive = income, negative = expense
  balance: number | null;
  category: string | null;
  sourceFile: string | null;
  importBatch: string | null;
  isReconciled: boolean;
  notes: string | null;
}

export interface SupabaseBankTransactionRow {
  id: string;
  account_name: string;
  transaction_date: string;
  value_date: string | null;
  description: string;
  reference: string | null;
  amount: number;
  balance: number | null;
  category: string | null;
  source_file: string | null;
  import_batch: string | null;
  is_reconciled: boolean;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

// ─── Reconciliation (Junction Table) ─────────────────────────────────

export type ReconciliationMatchType = 'exact' | 'sum' | 'partial' | 'manual';
export type AdjustmentReason =
  | 'comision_banco'
  | 'itf'
  | 'retencion'
  | 'diferencia_tipo_cambio'
  | 'redondeo'
  | 'otro';

export interface Reconciliation {
  id: string;
  bankTransactionId: string;
  invoiceId: string | null;
  expenseId: string | null;
  appliedAmount: number;
  adjustmentAmount: number;
  adjustmentReason: AdjustmentReason | null;
  matchType: ReconciliationMatchType;
  matchConfidence: number | null;
  notes: string | null;
}

export interface SupabaseReconciliationRow {
  id: string;
  bank_transaction_id: string;
  invoice_id: string | null;
  expense_id: string | null;
  applied_amount: number;
  adjustment_amount: number;
  adjustment_reason: string | null;
  match_type: string;
  match_confidence: number | null;
  notes: string | null;
  created_at: string | null;
}

// ─── Matching Engine Types ───────────────────────────────────────────

export interface ReconciliationAllocation {
  invoiceId?: string;
  expenseId?: string;
  appliedAmount: number;
  /** Label for display, e.g. "F001-200 · Carbono" */
  label: string;
}

export interface ReconciliationCandidate {
  matchType: ReconciliationMatchType;
  confidence: number; // 0.00 – 1.00
  allocations: ReconciliationAllocation[];
  /** Residual after allocations (usually a bank fee) */
  residual: number;
  /** Human-readable explanation */
  explanation: string;
}

// ─── Import Types ────────────────────────────────────────────────────

export interface ParsedBankRow {
  transactionDate: string; // YYYY-MM-DD
  valueDate: string | null;
  description: string;
  reference: string | null;
  amount: number;
  balance: number | null;
}

export interface BankImportResult {
  rows: ParsedBankRow[];
  bankName: string | null;
  accountName: string | null;
  errors: string[];
  skippedCount: number;
}

// ─── Quick-Label Categories ──────────────────────────────────────────

export const BANK_QUICK_LABELS = [
  { value: 'comision_banco', label: 'Comisión bancaria' },
  { value: 'itf', label: 'ITF' },
  { value: 'mantenimiento', label: 'Mantenimiento de cuenta' },
  { value: 'transferencia_propia', label: 'Transferencia entre cuentas' },
  { value: 'sunat', label: 'Pago SUNAT' },
  { value: 'taxi_transporte', label: 'Taxi / Transporte' },
  { value: 'alimentacion', label: 'Alimentación' },
  { value: 'caja_chica', label: 'Caja chica' },
  { value: 'sueldo', label: 'Pago sueldo' },
  { value: 'honorarios', label: 'Pago honorarios' },
  { value: 'devolucion', label: 'Devolución' },
  { value: 'otro', label: 'Otro' },
] as const;

export type BankQuickLabel = (typeof BANK_QUICK_LABELS)[number]['value'];

// ─── Dashboard Summary ──────────────────────────────────────────────

export interface ReconciliationSummary {
  /** Total bank transactions imported */
  totalTransactions: number;
  /** Count that have been reconciled */
  reconciledCount: number;
  /** Count pending reconciliation */
  pendingCount: number;
  /** Sum of all positive bank movements (deposits) */
  totalDeposits: number;
  /** Sum of all negative bank movements (withdrawals) */
  totalWithdrawals: number;
  /** Last known bank balance */
  lastBankBalance: number | null;
  /** Unreconciled amount (sum of pending positive txs) */
  unreconciledIncome: number;
  /** Unreconciled expenses (sum of pending negative txs) */
  unreconciledExpenses: number;
}
