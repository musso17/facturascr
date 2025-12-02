'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  InvoiceFormState,
  InvoiceRecord,
  SupabaseInvoiceRow,
} from '@/lib/accounting-types';
import {
  buildInvoicePayload,
  describeSupabaseError,
  mapInvoiceRow,
  parseSunatInvoiceXML,
} from '@/lib/accounting-service';
import { supabase } from '@/lib/supabase-client';

type InvoiceMutationResult = { error?: string; data?: InvoiceRecord };

export function useInvoices() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);

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
      setSyncError(null);
      setInvoices((data ?? []).map(mapInvoiceRow));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadInvoices();
    }, 0);
    return () => clearTimeout(handle);
  }, [loadInvoices]);

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

      const payload = buildInvoicePayload(input);
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
    [ensureInvoiceDoesNotExist],
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

  const applyManualPayment = useCallback(
    async (invoiceId: string, amount: number): Promise<InvoiceMutationResult> => {
      if (!amount || amount <= 0) {
        return { error: 'Ingresa un monto válido.' };
      }
      const target = invoices.find((invoice) => invoice.recordId === invoiceId);
      if (!target) {
        return { error: 'Factura no encontrada.' };
      }
      const newPaid = Math.min(target.paid + amount, target.total);
      const { data, error } = await supabase
        .from('invoices')
        .update({ paid: newPaid })
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo actualizar el pago.' };
      }
      if (data) {
        const mapped = mapInvoiceRow(data as SupabaseInvoiceRow);
        setInvoices((prev) =>
          prev.map((invoice) => (invoice.recordId === invoiceId ? mapped : invoice)),
        );
        return { data: mapped };
      }
      return { error: 'Respuesta inesperada de Supabase.' };
    },
    [invoices],
  );

  const markAsPaid = useCallback(
    async (invoiceId: string): Promise<InvoiceMutationResult> => {
      const target = invoices.find((invoice) => invoice.recordId === invoiceId);
      if (!target) return { error: 'Factura no encontrada.' };

      const { data, error } = await supabase
        .from('invoices')
        .update({ paid: target.total, status: 'pagado' })
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo actualizar la factura.' };
      }
      if (data) {
        const mapped = mapInvoiceRow(data as SupabaseInvoiceRow);
        setInvoices((prev) =>
          prev.map((invoice) => (invoice.recordId === invoiceId ? mapped : invoice)),
        );
        return { data: mapped };
      }
      return { error: 'Respuesta inesperada de Supabase.' };
    },
    [invoices],
  );

  const revertPayment = useCallback(
    async (invoiceId: string): Promise<InvoiceMutationResult> => {
      const target = invoices.find((invoice) => invoice.recordId === invoiceId);
      if (!target) return { error: 'Factura no encontrada.' };

      const { data, error } = await supabase
        .from('invoices')
        .update({ paid: 0, status: 'pendiente' })
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) {
        console.error(error);
        return { error: describeSupabaseError(error) ?? 'No se pudo revertir el pago.' };
      }
      if (data) {
        const mapped = mapInvoiceRow(data as SupabaseInvoiceRow);
        setInvoices((prev) =>
          prev.map((invoice) => (invoice.recordId === invoiceId ? mapped : invoice)),
        );
        return { data: mapped };
      }
      return { error: 'Respuesta inesperada de Supabase.' };
    },
    [invoices],
  );

  return {
    invoices,
    isLoading,
    syncError,
    refresh: loadInvoices,
    createInvoice,
    createInvoiceFromXML,
    applyManualPayment,
    markAsPaid,
    revertPayment,
  };
}
