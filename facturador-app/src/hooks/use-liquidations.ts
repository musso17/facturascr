'use client';

import { useCallback, useEffect, useState } from 'react';
import { LiquidationRecord, SupabaseLiquidationRow } from '@/lib/accounting-types';
import { describeSupabaseError } from '@/lib/accounting-service';
import { supabase } from '@/lib/supabase-client';

function mapRow(row: SupabaseLiquidationRow): LiquidationRecord {
  return {
    id: row.id,
    period: row.period,
    excedente: Number(row.excedente) || 0,
    reserva: Number(row.reserva) || 0,
    fondoCrecimiento: Number(row.fondo_crecimiento) || 0,
    utilidadNeta: Number(row.utilidad_neta) || 0,
    payouts: row.payouts ?? {},
    ventas: row.ventas ?? {},
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function useLiquidations() {
  const [liquidations, setLiquidations] = useState<LiquidationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // La tabla se crea con la migración manual; si falta, la UI muestra el aviso
  const [tableMissing, setTableMissing] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('utility_liquidations')
      .select('*')
      .order('period', { ascending: false });
    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') {
        setTableMissing(true);
      } else {
        console.error(error);
      }
      setLiquidations([]);
    } else {
      setTableMissing(false);
      setLiquidations(((data ?? []) as SupabaseLiquidationRow[]).map(mapRow));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(handle);
  }, [load]);

  const saveLiquidation = useCallback(
    async (input: Omit<LiquidationRecord, 'id' | 'createdAt'>) => {
      const payload = {
        period: input.period,
        excedente: input.excedente,
        reserva: input.reserva,
        fondo_crecimiento: input.fondoCrecimiento,
        utilidad_neta: input.utilidadNeta,
        payouts: input.payouts,
        ventas: input.ventas,
        notes: input.notes ?? null,
      };
      const { data, error } = await supabase
        .from('utility_liquidations')
        .upsert(payload, { onConflict: 'period' })
        .select()
        .single();
      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo guardar la liquidación.' };
      }
      const mapped = mapRow(data as SupabaseLiquidationRow);
      setLiquidations((prev) => {
        const rest = prev.filter((l) => l.period !== mapped.period);
        return [mapped, ...rest].sort((a, b) => b.period.localeCompare(a.period));
      });
      return { data: mapped };
    },
    [],
  );

  const deleteLiquidation = useCallback(async (id: string) => {
    const { error } = await supabase.from('utility_liquidations').delete().eq('id', id);
    if (error) {
      console.error(error);
      return { error: describeSupabaseError(error) ?? 'No se pudo eliminar la liquidación.' };
    }
    setLiquidations((prev) => prev.filter((l) => l.id !== id));
    return {};
  }, []);

  return { liquidations, isLoading, tableMissing, refresh: load, saveLiquidation, deleteLiquidation };
}
