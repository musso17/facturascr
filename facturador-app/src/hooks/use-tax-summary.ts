'use client';

import { useCallback, useEffect, useState } from 'react';
import { MonthlyTaxSummary } from '@/lib/accounting-types';
import { supabase } from '@/lib/supabase-client';

export function useTaxSummary() {
  const [items, setItems] = useState<MonthlyTaxSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from('v_monthly_tax_liabilities')
      .select('*')
      .order('period', { ascending: false });
    const normalized =
      data?.map((row) => ({
        period: row.period,
        taxableSales: Number(row.taxable_sales) || 0,
        igvSales: Number(row.igv_sales) || 0,
        taxablePurchases: Number(row.taxable_purchases) || 0,
        igvPurchases: Number(row.igv_purchases) || 0,
        igvPayable: Number(row.igv_payable) || 0,
        irRetentionExpenses: Number(row.ir_retention_expenses) || 0,
        irWithheldSales: Number(row.ir_withheld_sales) || 0,
      })) ?? [];
    setItems(normalized);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(handle);
  }, [load]);

  const currentMonth = items[0];

  return { items, currentMonth, isLoading, refresh: load };
}
