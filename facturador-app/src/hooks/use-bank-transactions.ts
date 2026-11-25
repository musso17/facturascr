'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  BankTransaction,
  SupabaseBankTransactionRow,
  BankImportResult,
} from '@/lib/bank-types';
import { parseBankStatement } from '@/lib/bank-parser';
import { DEFAULT_ACCOUNT, LEGACY_ACCOUNT, sameAccount } from '@/lib/bank-accounts';
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
    itf: Number((row.metadata as { itf?: number } | null)?.itf) || 0,
  };
}

/** ¿Es un N° de operación real? Los formatos antiguos guardaban la fecha como "referencia" */
function isOperationNumber(reference: string | null | undefined) {
  const ref = (reference ?? '').trim();
  return ref.length > 0 && !/^\d{1,2}[-/.]\d{1,2}([-/.]\d{2,4})?$/.test(ref);
}

function looseKey(date: string, amount: number, description: string) {
  return `${date}|${Number(amount).toFixed(2)}|${description.trim().replace(/\s+/g, ' ').toUpperCase()}`;
}

function bump(map: Map<string, number>, key: string, delta = 1) {
  map.set(key, (map.get(key) ?? 0) + delta);
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useBankTransactions() {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Facturas y egresos que ya están ligados a un movimiento del banco
  const [reconciledInvoiceIds, setReconciledInvoiceIds] = useState<Set<string>>(new Set());
  const [reconciledExpenseIds, setReconciledExpenseIds] = useState<Set<string>>(new Set());
  // movimiento → facturas/egresos vinculados (para mostrar con qué se concilió)
  const [links, setLinks] = useState<Map<string, { invoiceId: string | null; expenseId: string | null }[]>>(
    new Map(),
  );

  // Si las conciliaciones no cargan, la revisión trataría lo ya vinculado como pendiente
  const [reconciliationsLoaded, setReconciliationsLoaded] = useState(false);
  const [reconciliationsError, setReconciliationsError] = useState<string | null>(null);

  const loadReconciliations = useCallback(async () => {
    const { data, error } = await supabase
      .from('reconciliations')
      .select('bank_transaction_id, invoice_id, expense_id');
    if (error) {
      console.error(error);
      setReconciliationsError('No se pudieron cargar las conciliaciones guardadas. Recarga la página antes de vincular.');
      setReconciliationsLoaded(false);
      return;
    }
    setReconciliationsError(null);
    setReconciliationsLoaded(true);
    const rows = (data ?? []) as {
      bank_transaction_id: string;
      invoice_id: string | null;
      expense_id: string | null;
    }[];
    setReconciledInvoiceIds(new Set(rows.flatMap((row) => (row.invoice_id ? [row.invoice_id] : []))));
    setReconciledExpenseIds(new Set(rows.flatMap((row) => (row.expense_id ? [row.expense_id] : []))));
    const map = new Map<string, { invoiceId: string | null; expenseId: string | null }[]>();
    for (const row of rows) {
      const list = map.get(row.bank_transaction_id) ?? [];
      list.push({ invoiceId: row.invoice_id, expenseId: row.expense_id });
      map.set(row.bank_transaction_id, list);
    }
    setLinks(map);
  }, []);

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
    const handle = setTimeout(() => {
      void loadTransactions();
      void loadReconciliations();
    }, 0);
    return () => clearTimeout(handle);
  }, [loadTransactions, loadReconciliations]);

  // ─── Conciliar un abono con una o varias facturas ──────────────────

  const reconcileCredit = useCallback(
    async (
      transactionId: string,
      allocations: { invoiceId?: string; expenseId?: string; appliedAmount: number }[],
      meta: { matchType: 'exact' | 'sum' | 'manual'; confidence: number | null; notes?: string },
    ): Promise<{ error?: string }> => {
      const { error } = await supabase.from('reconciliations').insert(
        allocations.map((allocation) => ({
          bank_transaction_id: transactionId,
          invoice_id: allocation.invoiceId ?? null,
          expense_id: allocation.expenseId ?? null,
          applied_amount: allocation.appliedAmount,
          match_type: meta.matchType,
          match_confidence: meta.confidence,
          notes: meta.notes ?? null,
        })),
      );
      if (error) {
        console.error(error);
        return { error: 'No se pudo guardar la conciliación.' };
      }
      const { error: txError } = await supabase
        .from('bank_transactions')
        .update({ is_reconciled: true, updated_at: new Date().toISOString() })
        .eq('id', transactionId);
      if (txError) {
        console.error(txError);
        return { error: 'Se ligó la factura pero no se pudo marcar el movimiento como conciliado.' };
      }
      setTransactions((prev) =>
        prev.map((tx) => (tx.id === transactionId ? { ...tx, isReconciled: true } : tx)),
      );
      setReconciledInvoiceIds((prev) => {
        const next = new Set(prev);
        allocations.forEach((allocation) => allocation.invoiceId && next.add(allocation.invoiceId));
        return next;
      });
      setReconciledExpenseIds((prev) => {
        const next = new Set(prev);
        allocations.forEach((allocation) => allocation.expenseId && next.add(allocation.expenseId));
        return next;
      });
      setLinks((prev) => {
        const next = new Map(prev);
        next.set(transactionId, [
          ...(prev.get(transactionId) ?? []),
          ...allocations.map((allocation) => ({
            invoiceId: allocation.invoiceId ?? null,
            expenseId: allocation.expenseId ?? null,
          })),
        ]);
        return next;
      });
      return {};
    },
    [],
  );

  /** Clasifica varios movimientos a la vez (comisiones, ITF, SUNAT…) */
  const categorizeMany = useCallback(
    async (ids: string[], category: string): Promise<{ error?: string }> => {
      if (ids.length === 0) return {};
      const { error } = await supabase
        .from('bank_transactions')
        .update({ category, updated_at: new Date().toISOString() })
        .in('id', ids);
      if (error) {
        console.error(error);
        return { error: 'No se pudieron clasificar los movimientos.' };
      }
      const idSet = new Set(ids);
      setTransactions((prev) => prev.map((tx) => (idSet.has(tx.id) ? { ...tx, category } : tx)));
      return {};
    },
    [],
  );

  // ─── Import from file ──────────────────────────────────────────────

  const importFromFile = useCallback(
    async (
      file: File,
      /** Cuenta destino, o una función que la elige con lo que se detectó en el archivo */
      account: string | ((result: BankImportResult) => string) = DEFAULT_ACCOUNT,
    ): Promise<{ result: BankImportResult; insertedCount: number; duplicateCount: number; accountName: string }> => {
      const result = await parseBankStatement(file);
      const accountName = typeof account === 'function' ? account(result) : account;
      // Los movimientos antiguos "Principal" son de la cuenta BBVA
      const sameStoredAccount = (stored: string) =>
        stored === accountName || (stored === LEGACY_ACCOUNT && sameAccount(accountName, DEFAULT_ACCOUNT));

      if (result.rows.length === 0) {
        return { result, insertedCount: 0, duplicateCount: 0, accountName };
      }

      // Generate a batch ID for this import
      const batchId = `${file.name}_${Date.now()}`;

      // Duplicados: misma cuenta + fecha + monto + glosa + N° de operación
      const { data: existing } = await supabase
        .from('bank_transactions')
        .select('transaction_date, amount, description, reference, account_name');

      // Conteo por clave (multiconjunto): si el archivo trae dos movimientos idénticos y la
      // base tiene uno, se inserta el que falta. Con N° de operación real la clave lo incluye;
      // los movimientos antiguos (referencia = fecha) se comparan por fecha + monto + glosa.
      const strict = new Map<string, number>();
      const legacy = new Map<string, number>();
      const any = new Map<string, number>();
      for (const row of (existing ?? []) as {
        transaction_date: string;
        amount: number;
        description: string;
        reference: string | null;
        account_name: string;
      }[]) {
        if (!sameStoredAccount(row.account_name)) continue;
        const loose = looseKey(row.transaction_date, row.amount, row.description);
        bump(any, loose);
        if (isOperationNumber(row.reference)) bump(strict, `${loose}|${row.reference!.trim()}`);
        else bump(legacy, loose);
      }

      const take = (map: Map<string, number>, key: string) => {
        const count = map.get(key) ?? 0;
        if (count <= 0) return false;
        map.set(key, count - 1);
        return true;
      };
      const newRows = result.rows.filter((row) => {
        const loose = looseKey(row.transactionDate, row.amount, row.description);
        if (isOperationNumber(row.reference)) {
          const duplicate = take(strict, `${loose}|${row.reference!.trim()}`) || take(legacy, loose);
          if (duplicate) bump(any, loose, -1);
          return !duplicate;
        }
        return !take(any, loose);
      });
      const duplicateCount = result.rows.length - newRows.length;

      if (newRows.length === 0) {
        return { result, insertedCount: 0, duplicateCount, accountName };
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
        metadata: {
          ...(row.itf ? { itf: row.itf } : {}),
          ...(row.office ? { office: row.office } : {}),
          ...(row.channel ? { channel: row.channel } : {}),
        },
      }));

      const { error } = await supabase.from('bank_transactions').insert(payload);

      if (error) {
        console.error(error);
        result.errors.push(`Error al guardar: ${error.message}`);
        return { result, insertedCount: 0, duplicateCount, accountName };
      }

      // Refresh list
      await loadTransactions();

      return { result, insertedCount: newRows.length, duplicateCount, accountName };
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
    reconciledInvoiceIds,
    reconciledExpenseIds,
    links,
    reconciliationsLoaded,
    reconciliationsError,
    refresh: loadTransactions,
    importFromFile,
    reconcileCredit,
    categorizeMany,
    categorizeTransaction,
    bulkReconcileMonth,
    deleteTransaction,
    deleteImportBatch,
  };
}
