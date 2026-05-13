'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  BankTransaction,
  SupabaseBankTransactionRow,
  BankImportResult,
} from '@/lib/bank-types';
import { parseBankStatement } from '@/lib/bank-parser';
import { supabase } from '@/lib/supabase-client';

// ─── Row mapper ──────────────────────────────────────────────────────

function mapRow(row: SupabaseBankTransactionRow): BankTransaction {
  return {
    id: row.id,
    accountName: row.account_name,
    transactionDate: row.transaction_date,
    valueDate: row.value_date,
    description: row.description,
    reference: row.reference,
    amount: Number(row.amount),
    balance: row.balance != null ? Number(row.balance) : null,
    category: row.category,
    sourceFile: row.source_file,
    importBatch: row.import_batch,
    isReconciled: row.is_reconciled,
    notes: row.notes,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useBankTransactions() {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadTransactions = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('bank_transactions')
      .select('*')
      .order('transaction_date', { ascending: false });

    if (error) {
      console.error(error);
      setSyncError('No se pudo cargar los movimientos bancarios.');
      setTransactions([]);
    } else {
      setSyncError(null);
      setTransactions(
        (data ?? []).map((row) => mapRow(row as SupabaseBankTransactionRow)),
      );
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  // ─── Import from file ──────────────────────────────────────────────

  const importFromFile = useCallback(
    async (
      file: File,
      accountName = 'Principal',
    ): Promise<{ result: BankImportResult; insertedCount: number; duplicateCount: number }> => {
      const result = await parseBankStatement(file);

      if (result.rows.length === 0) {
        return { result, insertedCount: 0, duplicateCount: 0 };
      }

      // Generate a batch ID for this import
      const batchId = `${file.name}_${Date.now()}`;

      // Check for duplicates: same date + amount + description
      const { data: existing } = await supabase
        .from('bank_transactions')
        .select('transaction_date, amount, description');

      const existingSet = new Set(
        (existing ?? []).map(
          (row: { transaction_date: string; amount: number; description: string }) =>
            `${row.transaction_date}|${row.amount}|${row.description}`,
        ),
      );

      const newRows = result.rows.filter(
        (row) =>
          !existingSet.has(
            `${row.transactionDate}|${row.amount}|${row.description}`,
          ),
      );
      const duplicateCount = result.rows.length - newRows.length;

      if (newRows.length === 0) {
        return { result, insertedCount: 0, duplicateCount };
      }

      // Bulk insert
      const payload = newRows.map((row) => ({
        account_name: accountName,
        transaction_date: row.transactionDate,
        value_date: row.valueDate,
        description: row.description,
        reference: row.reference,
        amount: row.amount,
        balance: row.balance,
        source_file: file.name,
        import_batch: batchId,
      }));

      const { error } = await supabase.from('bank_transactions').insert(payload);

      if (error) {
        console.error(error);
        result.errors.push(`Error al guardar: ${error.message}`);
        return { result, insertedCount: 0, duplicateCount };
      }

      // Refresh list
      await loadTransactions();

      return { result, insertedCount: newRows.length, duplicateCount };
    },
    [loadTransactions],
  );

  // ─── Quick categorize ──────────────────────────────────────────────

  const categorizeTransaction = useCallback(
    async (id: string, category: string): Promise<{ error?: string }> => {
      const { error } = await supabase
        .from('bank_transactions')
        .update({ category, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) {
        console.error(error);
        return { error: 'No se pudo categorizar el movimiento.' };
      }

      setTransactions((prev) =>
        prev.map((tx) => (tx.id === id ? { ...tx, category } : tx)),
      );
      return {};
    },
    [],
  );

  // ─── Bulk Reconcile Month ──────────────────────────────────────────

  const bulkReconcileMonth = useCallback(
    async (monthPrefix: string): Promise<{ error?: string }> => {
      const pendingIds = transactions
        .filter(tx => tx.transactionDate.startsWith(monthPrefix) && !tx.isReconciled)
        .map(tx => tx.id);

      if (pendingIds.length === 0) return {};

      const { error } = await supabase
        .from('bank_transactions')
        .update({ 
          is_reconciled: true, 
          category: 'Cierre Macro',
          notes: 'Conciliado en bloque (Modo Macro)',
          updated_at: new Date().toISOString() 
        })
        .in('id', pendingIds);

      if (error) {
        console.error(error);
        return { error: 'No se pudo hacer el cierre del mes.' };
      }

      await loadTransactions();
      return {};
    },
    [transactions, loadTransactions],
  );

  // ─── Delete single ─────────────────────────────────────────────────

  const deleteTransaction = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const { error } = await supabase
        .from('bank_transactions')
        .delete()
        .eq('id', id);

      if (error) {
        console.error(error);
        return { error: 'No se pudo eliminar el movimiento.' };
      }

      setTransactions((prev) => prev.filter((tx) => tx.id !== id));
      return {};
    },
    [],
  );

  // ─── Delete entire import batch ────────────────────────────────────

  const deleteImportBatch = useCallback(
    async (batchId: string): Promise<{ error?: string }> => {
      const { error } = await supabase
        .from('bank_transactions')
        .delete()
        .eq('import_batch', batchId);

      if (error) {
        console.error(error);
        return { error: 'No se pudo eliminar el lote.' };
      }

      setTransactions((prev) =>
        prev.filter((tx) => tx.importBatch !== batchId),
      );
      return {};
    },
    [],
  );

  return {
    transactions,
    isLoading,
    syncError,
    refresh: loadTransactions,
    importFromFile,
    categorizeTransaction,
    bulkReconcileMonth,
    deleteTransaction,
    deleteImportBatch,
  };
}
