'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ManagementIncomeRecord,
  SupabaseManagementIncomeRow,
} from '@/lib/accounting-types';
import { describeSupabaseError } from '@/lib/accounting-service';
import { supabase } from '@/lib/supabase-client';

function mapRow(row: SupabaseManagementIncomeRow): ManagementIncomeRecord {
  return {
    id: row.id,
    issueDate: row.income_date,
    amount: Number(row.amount) || 0,
    description: row.description,
    clientId: row.client_id,
    clientName: row.client_name,
  };
}

export function useManagementIncomes() {
  const [incomes, setIncomes] = useState<ManagementIncomeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // La tabla se crea con supabase/migration-otros-ingresos.sql
  const [tableMissing, setTableMissing] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('management_incomes')
      .select('*')
      .order('income_date', { ascending: false });
    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') {
        setTableMissing(true);
      } else {
        console.error(error);
      }
      setIncomes([]);
    } else {
      setTableMissing(false);
      setIncomes(((data ?? []) as SupabaseManagementIncomeRow[]).map(mapRow));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(handle);
  }, [load]);

  const insertIncome = useCallback(
    async (input: Omit<ManagementIncomeRecord, 'id'>) => {
      const { data, error } = await supabase
        .from('management_incomes')
        .insert({
          income_date: input.issueDate,
          amount: input.amount,
          description: input.description,
          client_id: input.clientId ?? null,
          client_name: input.clientName ?? null,
        })
        .select()
        .single();
      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo registrar el ingreso.' };
      }
      const mapped = mapRow(data as SupabaseManagementIncomeRow);
      setIncomes((prev) =>
        [mapped, ...prev].sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
      );
      return { data: mapped };
    },
    [],
  );

  const deleteIncome = useCallback(async (id: string) => {
    const { error } = await supabase.from('management_incomes').delete().eq('id', id);
    if (error) {
      console.error(error);
      return { error: describeSupabaseError(error) ?? 'No se pudo eliminar el ingreso.' };
    }
    setIncomes((prev) => prev.filter((i) => i.id !== id));
    return {};
  }, []);

  return { incomes, isLoading, tableMissing, refresh: load, insertIncome, deleteIncome };
}
