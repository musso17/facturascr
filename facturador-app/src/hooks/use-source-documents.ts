'use client';

import { useCallback, useEffect, useState } from 'react';
import { describeSupabaseError } from '@/lib/accounting-service';
import { supabase } from '@/lib/supabase-client';

/**
 * XML originales de SUNAT asociados a facturas (invoices) o egresos (expenses).
 * La tabla se crea con supabase/migration-documentos.sql.
 *
 * El índice (qué registros tienen XML) se carga liviano al inicio; el XML
 * completo solo se descarga al abrir "Ver factura".
 */
export type SourceDocumentKind = 'invoice' | 'expense';

export type StoredSourceDocument = { xml: string; fileName: string | null };

const isMissingTable = (code?: string) => code === 'PGRST205' || code === '42P01';

export function useSourceDocuments(kind: SourceDocumentKind) {
  const column = kind === 'invoice' ? 'invoice_id' : 'expense_id';
  // recordId -> nombre del archivo XML
  const [documents, setDocuments] = useState<Map<string, string>>(new Map());
  const [tableMissing, setTableMissing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('source_documents')
      .select(`${column}, file_name`)
      .not(column, 'is', null);
    if (error) {
      if (isMissingTable(error.code)) {
        setTableMissing(true);
      } else {
        console.error(error);
      }
      return;
    }
    setTableMissing(false);
    const next = new Map<string, string>();
    for (const row of (data ?? []) as Record<string, string | null>[]) {
      const recordId = row[column];
      if (recordId) next.set(recordId, row.file_name ?? 'comprobante.xml');
    }
    setDocuments(next);
  }, [column]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(handle);
  }, [load]);

  const fetchDocument = useCallback(
    async (recordId: string): Promise<{ data?: StoredSourceDocument | null; error?: string }> => {
      const { data, error } = await supabase
        .from('source_documents')
        .select('xml, file_name')
        .eq(column, recordId)
        .maybeSingle();
      if (error) {
        if (isMissingTable(error.code)) {
          setTableMissing(true);
          return { data: null };
        }
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo leer el comprobante.' };
      }
      if (!data) return { data: null };
      return { data: { xml: data.xml as string, fileName: (data.file_name as string | null) ?? null } };
    },
    [column],
  );

  const saveDocument = useCallback(
    async (recordId: string, xml: string, fileName: string): Promise<{ error?: string }> => {
      const { error } = await supabase
        .from('source_documents')
        .upsert({ [column]: recordId, xml, file_name: fileName }, { onConflict: column });
      if (error) {
        if (isMissingTable(error.code)) {
          setTableMissing(true);
          return {
            error:
              'Falta crear la tabla de comprobantes: ejecuta supabase/migration-documentos.sql en Supabase.',
          };
        }
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo guardar el XML.' };
      }
      setDocuments((prev) => new Map(prev).set(recordId, fileName));
      return {};
    },
    [column],
  );

  return {
    documents,
    tableMissing,
    refresh: load,
    fetchDocument,
    saveDocument,
  };
}
