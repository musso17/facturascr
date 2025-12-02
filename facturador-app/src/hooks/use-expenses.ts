'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ExpenseRecord,
  PaymentMethod,
  SupabaseExpenseRow,
} from '@/lib/accounting-types';
import { describeSupabaseError } from '@/lib/accounting-service';
import { supabase } from '@/lib/supabase-client';

type ExpenseInput = Omit<
  ExpenseRecord,
  'id' | 'status' | 'paidAmount' | 'notes' | 'category'
> & {
  status?: ExpenseRecord['status'];
  paidAmount?: ExpenseRecord['paidAmount'];
  notes?: string | null;
  category?: ExpenseRecord['category'];
};

export function useExpenses() {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);

  const mapExpenseRow = useCallback((row: SupabaseExpenseRow): ExpenseRecord => {
    return {
      id: row.id,
      documentType: row.document_type,
      documentSeries: row.document_series,
      documentNumber: row.document_number,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      partnerId: row.partner_id,
      providerName: row.provider_name,
      providerDocument: row.provider_document,
      concept: row.concept,
      paymentMethod: row.payment_method,
      operationNumber: row.operation_number,
      paymentDate: row.payment_date,
      baseAmount: row.base_amount,
      igvAmount: row.igv_amount,
      irRetention: row.ir_retention,
      otherTaxes: row.other_taxes,
      totalAmount: row.total_amount,
      category: row.category,
      status: row.status,
      paidAmount: row.status === 'pagado' ? row.total_amount : row.paid_amount,
      notes: row.notes,
    };
  }, []);

  const loadExpenses = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .order('issue_date', { ascending: false });

    if (error) {
      console.error(error);
      setSyncError('No se pudo sincronizar los egresos.');
      setExpenses([]);
    } else {
      setSyncError(null);
      setExpenses((data ?? []).map(mapExpenseRow));
    }
    setIsLoading(false);
  }, [mapExpenseRow]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadExpenses();
    }, 0);
    return () => clearTimeout(handle);
  }, [loadExpenses]);

  const insertExpense = useCallback(
    async (input: ExpenseInput) => {
      const payload = {
        document_type: input.documentType,
        document_series: input.documentSeries ?? null,
        document_number: input.documentNumber,
        issue_date: input.issueDate,
        due_date: input.dueDate ?? input.issueDate,
        partner_id: input.partnerId ?? null,
        provider_name: input.providerName,
        provider_document: input.providerDocument ?? null,
        concept: input.concept,
        payment_method: input.paymentMethod ?? null,
        operation_number: input.operationNumber ?? null,
        payment_date: input.paymentDate ?? null,
        base_amount: input.baseAmount,
        igv_amount: input.igvAmount,
        ir_retention: input.irRetention,
        other_taxes: input.otherTaxes,
        total_amount: input.totalAmount,
        category: input.category ?? 'servicios',
        status: input.status ?? 'pendiente',
        paid_amount: input.paidAmount ?? 0,
        notes: input.notes ?? null,
      };

      const { data, error } = await supabase.from('expenses').insert(payload).select().single();
      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo registrar el egreso.' };
      }
      if (data) {
        const mapped = mapExpenseRow(data as SupabaseExpenseRow);
        setExpenses((prev) => [mapped, ...prev]);
        return { data: mapped };
      }
      return { error: 'Respuesta inesperada al registrar el egreso.' };
    },
    [mapExpenseRow],
  );

  const updateExpense = useCallback(
    async (id: string, patch: Partial<ExpenseInput>) => {
      const payload: Record<string, unknown> = {};
      if (patch.documentType) payload.document_type = patch.documentType;
      if ('documentSeries' in patch) payload.document_series = patch.documentSeries ?? null;
      if (patch.documentNumber) payload.document_number = patch.documentNumber;
      if (patch.issueDate) payload.issue_date = patch.issueDate;
      if ('dueDate' in patch) payload.due_date = patch.dueDate ?? null;
      if ('partnerId' in patch) payload.partner_id = patch.partnerId ?? null;
      if (patch.providerName) payload.provider_name = patch.providerName;
      if ('providerDocument' in patch) payload.provider_document = patch.providerDocument ?? null;
      if (patch.concept) payload.concept = patch.concept;
      if ('paymentMethod' in patch)
        payload.payment_method = (patch.paymentMethod ?? null) as PaymentMethod | null;
      if ('operationNumber' in patch) payload.operation_number = patch.operationNumber ?? null;
      if ('paymentDate' in patch) payload.payment_date = patch.paymentDate ?? null;
      if ('baseAmount' in patch) payload.base_amount = patch.baseAmount;
      if ('igvAmount' in patch) payload.igv_amount = patch.igvAmount;
      if ('irRetention' in patch) payload.ir_retention = patch.irRetention;
      if ('otherTaxes' in patch) payload.other_taxes = patch.otherTaxes;
      if ('totalAmount' in patch) payload.total_amount = patch.totalAmount;
      if ('category' in patch) payload.category = patch.category ?? 'servicios';
      if ('status' in patch) payload.status = patch.status;
      if ('paidAmount' in patch) payload.paid_amount = patch.paidAmount ?? 0;
      if ('notes' in patch) payload.notes = patch.notes ?? null;

      const { data, error } = await supabase.from('expenses').update(payload).eq('id', id).select().single();

      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo actualizar el egreso.' };
      }
      if (data) {
        const mapped = mapExpenseRow(data as SupabaseExpenseRow);
        setExpenses((prev) => prev.map((expense) => (expense.id === id ? mapped : expense)));
        return { data: mapped };
      }
      return { error: 'Respuesta inesperada al actualizar el egreso.' };
    },
    [mapExpenseRow],
  );

  const markExpensePaid = useCallback(
    async (id: string) => {
      const target = expenses.find((expense) => expense.id === id);
      if (!target) return { error: 'Egreso no encontrado.' };
      return updateExpense(id, {
        paidAmount: target.totalAmount,
        status: 'pagado',
        paymentDate: new Date().toISOString().slice(0, 10),
      });
    },
    [expenses, updateExpense],
  );

  const revertExpensePayment = useCallback(
    async (id: string) => {
      return updateExpense(id, { paidAmount: 0, status: 'pendiente', paymentDate: null });
    },
    [updateExpense],
  );

  return {
    expenses,
    isLoading,
    syncError,
    refresh: loadExpenses,
    insertExpense,
    updateExpense,
    markExpensePaid,
    revertExpensePayment,
  };
}
