'use client';

import { useCallback, useEffect, useState } from 'react';
import { PartnerRecord, SupabasePartnerRow } from '@/lib/accounting-types';
import { describeSupabaseError } from '@/lib/accounting-service';
import { supabase } from '@/lib/supabase-client';

const MIGRATION_HINT =
  'Falta ejecutar supabase/migration-cobranza.sql en Supabase para guardar este dato.';

export function usePartners() {
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // false hasta ejecutar supabase/migration-cobranza.sql
  const [collectionColumns, setCollectionColumns] = useState(true);

  const mapPartner = useCallback((row: SupabasePartnerRow): PartnerRecord => {
    return {
      id: row.id,
      role: row.role,
      name: row.name,
      tradeName: row.trade_name,
      documentType: row.document_type,
      documentNumber: row.document_number,
      email: row.email,
      phone: row.phone,
      address: row.address,
      notes: row.notes,
      isRetentionAgent: row.is_retention_agent ?? false,
      bankAliases: row.bank_aliases ?? [],
    };
  }, []);

  const loadPartners = useCallback(async () => {
    setIsLoading(true);
    const { data } = await supabase.from('partners').select('*').order('name');
    const rows = (data ?? []) as SupabasePartnerRow[];
    setCollectionColumns(rows.length === 0 || 'bank_aliases' in rows[0]);
    setPartners(rows.map(mapPartner));
    setIsLoading(false);
  }, [mapPartner]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadPartners();
    }, 0);
    return () => clearTimeout(handle);
  }, [loadPartners]);

  /** Datos de cobranza del cliente: agente de retención y alias bancarios */
  const updatePartnerCollection = useCallback(
    async (
      id: string,
      patch: { isRetentionAgent?: boolean; bankAliases?: string[] },
    ): Promise<{ error?: string }> => {
      if (!collectionColumns) return { error: MIGRATION_HINT };
      const payload: Record<string, unknown> = {};
      if (patch.isRetentionAgent !== undefined) payload.is_retention_agent = patch.isRetentionAgent;
      if (patch.bankAliases !== undefined) {
        payload.bank_aliases = Array.from(
          new Set(patch.bankAliases.map((alias) => alias.trim()).filter(Boolean)),
        );
      }
      const { data, error } = await supabase
        .from('partners')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) {
        console.error(error);
        if (error.code === 'PGRST204' || error.code === '42703') return { error: MIGRATION_HINT };
        return { error: describeSupabaseError(error) ?? 'No se pudo actualizar el cliente.' };
      }
      const mapped = mapPartner(data as SupabasePartnerRow);
      setPartners((prev) => prev.map((partner) => (partner.id === id ? mapped : partner)));
      return {};
    },
    [collectionColumns, mapPartner],
  );

  /** Crea el cliente en el directorio (si solo existía como texto en las facturas) */
  const createClientPartner = useCallback(
    async (input: { name: string; documentNumber: string; bankAliases?: string[] }) => {
      const documentNumber = input.documentNumber.trim();
      const payload: Record<string, unknown> = {
        name: input.name.trim(),
        role: 'cliente',
        document_type: documentNumber.length === 11 ? 'ruc' : 'otros',
        // document_number es único y obligatorio
        document_number: documentNumber || `SIN-DOC-${Date.now()}`,
      };
      if (collectionColumns && input.bankAliases) payload.bank_aliases = input.bankAliases;
      const { data, error } = await supabase.from('partners').insert(payload).select().single();
      if (error) {
        console.error(error);
        return {
          error:
            error.code === '23505'
              ? 'Ya existe un cliente con ese RUC en Configuración.'
              : describeSupabaseError(error) ?? 'No se pudo crear el cliente.',
        };
      }
      const mapped = mapPartner(data as SupabasePartnerRow);
      setPartners((prev) => [...prev, mapped].sort((a, b) => a.name.localeCompare(b.name, 'es')));
      return { data: mapped };
    },
    [collectionColumns, mapPartner],
  );

  return {
    partners,
    isLoading,
    collectionColumns,
    refresh: loadPartners,
    updatePartnerCollection,
    createClientPartner,
  };
}
