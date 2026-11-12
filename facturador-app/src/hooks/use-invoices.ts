'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DetractionStatus,
  InvoiceFormState,
  InvoiceRecord,
  SupabaseInvoiceRow,
} from '@/lib/accounting-types';
import {
  buildInvoicePayload,
  describeSupabaseError,
  mapInvoiceRow,
  parseSunatInvoiceXML,
  round,
} from '@/lib/accounting-service';
import { calcDetraction } from '@/lib/detraction';
import { supabase } from '@/lib/supabase-client';

type InvoiceMutationResult = { error?: string; data?: InvoiceRecord };

/** Datos de un cobro: a qué cuenta entró, cuánto y qué se descontó en el camino */
export interface CollectionInput {
  paymentDate: string; // YYYY-MM-DD
  paymentAccount: string;
  paymentReference: string;
  /** Lo que efectivamente entró a la cuenta */
  receivedAmount: number;
  igvRetention: number;
  retentionReceipt: string;
  detractionStatus: DetractionStatus | null;
  detractionReceipt: string;
}

export function useInvoices() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  // false hasta ejecutar supabase/migration-cobranza.sql
  const [collectionColumns, setCollectionColumns] = useState(true);

  const loadInvoices = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .order('issue_date', { ascending: false });

    if (error) {
      console.error(error);
      setSyncError('No se pudo sincronizar con Supabase.');
      setInvoices([]);
    } else {
      const rows = (data ?? []) as SupabaseInvoiceRow[];
      setSyncError(null);
      setCollectionColumns(rows.length === 0 || 'detraction_status' in rows[0]);
      setInvoices(rows.map(mapInvoiceRow));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadInvoices();
    }, 0);
    return () => clearTimeout(handle);
  }, [loadInvoices]);

  const applyRow = useCallback((invoiceId: string, data: unknown): InvoiceMutationResult => {
    if (!data) return { error: 'Respuesta inesperada de Supabase.' };
    const mapped = mapInvoiceRow(data as SupabaseInvoiceRow);
    setInvoices((prev) =>
      prev.map((invoice) => (invoice.recordId === invoiceId ? mapped : invoice)),
    );
    return { data: mapped };
  }, []);

  const ensureInvoiceDoesNotExist = useCallback(async (invoiceNumber: string) => {
    const normalized = invoiceNumber.trim();
    if (!normalized) {
      throw new Error('El XML no contiene un ID de factura válido.');
    }
    const { data, error } = await supabase
      .from('invoices')
      .select('id')
      .eq('invoice_number', normalized)
      .maybeSingle();

    if (error) {
      console.error(error);
      throw new Error(
        describeSupabaseError(error) ?? 'No se pudo validar si la factura ya existe.',
      );
    }
    if (data) {
      throw new Error(`La factura ${normalized} ya está registrada.`);
    }
  }, []);

  const createInvoice = useCallback(
    async (input: InvoiceFormState): Promise<InvoiceMutationResult> => {
      try {
        await ensureInvoiceDoesNotExist(input.id);
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'No se pudo validar la factura.' };
      }

      const payload = buildInvoicePayload(input, collectionColumns);
      const { data, error } = await supabase.from('invoices').insert(payload).select().single();

      if (error) {
        console.error(error);
        return {
          error: describeSupabaseError(error) ?? 'No se pudo guardar en Supabase.',
        };
      }
      if (data) {
        const mapped = mapInvoiceRow(data as SupabaseInvoiceRow);
        setInvoices((prev) => [mapped, ...prev]);
        return { data: mapped };
      }
      return { error: 'Respuesta inesperada de Supabase.' };
    },
    [ensureInvoiceDoesNotExist, collectionColumns],
  );

  const createInvoiceFromXML = useCallback(
    async (xmlContent: string): Promise<InvoiceMutationResult> => {
      try {
        const parsed = parseSunatInvoiceXML(xmlContent);
        return await createInvoice(parsed);
      } catch (error) {
        console.error(error);
        return {
          error: error instanceof Error ? error.message : 'No se pudo interpretar el XML.',
        };
      }
    },
    [createInvoice],
  );

  /**
   * Registra un cobro (total o parcial). Lo saldado = lo que entró a la cuenta
   * + retención IGV + detracción (si el cliente la depositó o la va a depositar).
   */
  const registerCollection = useCallback(
    async (invoiceId: string, input: CollectionInput): Promise<InvoiceMutationResult> => {
      const target = invoices.find((invoice) => invoice.recordId === invoiceId);
      if (!target) return { error: 'Factura no encontrada.' };
      if (input.receivedAmount < 0 || input.igvRetention < 0) {
        return { error: 'Los montos no pueden ser negativos.' };
      }

      const detraction = calcDetraction(target.total);
      const detractionCovers =
        detraction.applies && input.detractionStatus !== 'no_aplicada'
          ? detraction.detractionAmount
          : 0;
      const settled = input.receivedAmount + input.igvRetention + detractionCovers;
      let newPaid = round(Math.min(target.paid + settled, target.total));
      // Diferencias de céntimos por redondeo de la detracción: se da por saldada
      if (target.total - newPaid <= 1) newPaid = target.total;

      const payload: Record<string, unknown> = {
        paid: newPaid,
        status: newPaid >= target.total ? 'pagado' : 'pendiente',
        payment_date: input.paymentDate || null,
        payment_reference: input.paymentReference.trim() || null,
      };
      if (collectionColumns) {
        payload.payment_account = input.paymentAccount.trim() || null;
        payload.igv_retention = round(input.igvRetention);
        payload.retention_receipt = input.retentionReceipt.trim() || null;
        if (detraction.applies) {
          payload.detraction_status = input.detractionStatus;
          payload.detraction_receipt = input.detractionReceipt.trim() || null;
        }
      } else if (detraction.applies) {
        payload.metadata = { detraction_deposited: input.detractionStatus === 'depositada' };
      }

      const { data, error } = await supabase
        .from('invoices')
        .update(payload)
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo registrar el cobro.' };
      }
      return applyRow(invoiceId, data);
    },
    [invoices, collectionColumns, applyRow],
  );

  const revertPayment = useCallback(
    async (invoiceId: string): Promise<InvoiceMutationResult> => {
      const target = invoices.find((invoice) => invoice.recordId === invoiceId);
      if (!target) return { error: 'Factura no encontrada.' };

      const payload: Record<string, unknown> = {
        paid: 0,
        status: 'pendiente',
        payment_date: null,
        payment_reference: null,
      };
      if (collectionColumns) payload.payment_account = null;

      const { data, error } = await supabase
        .from('invoices')
        .update(payload)
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo revertir el pago.' };
      }
      return applyRow(invoiceId, data);
    },
    [invoices, collectionColumns, applyRow],
  );

  const updateInvoice = useCallback(
    async (invoiceId: string, input: InvoiceFormState): Promise<InvoiceMutationResult> => {
      const payload = buildInvoicePayload(input, collectionColumns);
      const { data, error } = await supabase
        .from('invoices')
        .update(payload)
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo actualizar la factura.' };
      }
      return applyRow(invoiceId, data);
    },
    [collectionColumns, applyRow],
  );

  const setDetractionStatus = useCallback(
    async (
      invoiceId: string,
      status: DetractionStatus,
      receipt?: string,
    ): Promise<InvoiceMutationResult> => {
      const payload: Record<string, unknown> = collectionColumns
        ? {
            detraction_status: status,
            ...(receipt !== undefined ? { detraction_receipt: receipt.trim() || null } : {}),
          }
        : { metadata: { detraction_deposited: status === 'depositada' } };

      const { data, error } = await supabase
        .from('invoices')
        .update(payload)
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo actualizar la detracción.' };
      }
      return applyRow(invoiceId, data);
    },
    [collectionColumns, applyRow],
  );

  /** P6: corrige la cuenta a la que entró un cobro ya registrado */
  const setPaymentAccount = useCallback(
    async (invoiceId: string, account: string): Promise<InvoiceMutationResult> => {
      if (!collectionColumns) {
        return { error: 'Ejecuta supabase/migration-cobranza.sql para guardar la cuenta destino.' };
      }
      const { data, error } = await supabase
        .from('invoices')
        .update({ payment_account: account.trim() || null })
        .eq('id', invoiceId)
        .select()
        .single();
      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo guardar la cuenta.' };
      }
      return applyRow(invoiceId, data);
    },
    [collectionColumns, applyRow],
  );

  const deleteInvoice = useCallback(
    async (invoiceId: string): Promise<{ error?: string }> => {
      const { error } = await supabase.from('invoices').delete().eq('id', invoiceId);
      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo eliminar la factura.' };
      }
      setInvoices((prev) => prev.filter((invoice) => invoice.recordId !== invoiceId));
      return {};
    },
    [],
  );

  return {
    invoices,
    isLoading,
    syncError,
    collectionColumns,
    refresh: loadInvoices,
    createInvoice,
    createInvoiceFromXML,
    updateInvoice,
    deleteInvoice,
    registerCollection,
    revertPayment,
    setDetractionStatus,
    setPaymentAccount,
  };
}
