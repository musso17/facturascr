'use client';

import { FormEvent, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { DetractionStatus, InvoiceRecord } from '@/lib/accounting-types';
import { shortenName } from '@/lib/accounting-service';
import { calcDetraction } from '@/lib/detraction';
import {
  DETRACTION_STATUS_LABEL,
  IGV_RETENTION_RATE,
  PAYMENT_ACCOUNTS,
  getCollectionBreakdown,
  round2,
} from '@/lib/collection';
import type { CollectionInput } from '@/hooks/use-invoices';

type Props = {
  /** Facturas con saldo, para elegir cuando se abre desde "Registrar cobro" */
  invoices: InvoiceRecord[];
  initialInvoiceId: string | null;
  isRetentionAgent: (invoice: InvoiceRecord) => boolean;
  collectionColumns: boolean;
  onSubmit: (invoiceId: string, input: CollectionInput) => Promise<{ error?: string }>;
  onClose: () => void;
};

type FormState = {
  paymentDate: string;
  paymentAccount: string;
  paymentReference: string;
  receivedAmount: string;
  igvRetention: string;
  retentionReceipt: string;
  detractionStatus: DetractionStatus | null;
  detractionReceipt: string;
};

const money = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
});
const fmt = (value: number) => money.format(value || 0);

function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function defaultsFor(invoice: InvoiceRecord | undefined, agent: boolean): FormState {
  const base: FormState = {
    paymentDate: todayISO(),
    paymentAccount: invoice?.paymentAccount ?? PAYMENT_ACCOUNTS[0],
    paymentReference: '',
    receivedAmount: '',
    igvRetention: '',
    retentionReceipt: invoice?.retentionReceipt ?? '',
    detractionStatus: null,
    detractionReceipt: invoice?.detractionReceipt ?? '',
  };
  if (!invoice) return base;
  const breakdown = getCollectionBreakdown(invoice, { isRetentionAgent: agent });
  const firstCollection = invoice.paid <= 0;
  return {
    ...base,
    receivedAmount: String(firstCollection ? breakdown.netToAccount : invoice.balance),
    igvRetention: breakdown.retentionAmount > 0 ? String(breakdown.retentionAmount) : '',
    detractionStatus: breakdown.detractionStatus,
  };
}

export function CollectionModal({
  invoices,
  initialInvoiceId,
  isRetentionAgent,
  collectionColumns,
  onSubmit,
  onClose,
}: Props) {
  const [invoiceId, setInvoiceId] = useState(initialInvoiceId ?? '');
  const invoice = invoices.find((item) => item.recordId === invoiceId);
  const [form, setForm] = useState<FormState>(() =>
    defaultsFor(invoice, invoice ? isRetentionAgent(invoice) : false),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectInvoice = (id: string) => {
    setInvoiceId(id);
    const next = invoices.find((item) => item.recordId === id);
    setForm(defaultsFor(next, next ? isRetentionAgent(next) : false));
    setError(null);
  };

  const preview = useMemo(() => {
    if (!invoice) return null;
    const detraction = calcDetraction(invoice.total);
    const detractionCovers =
      detraction.applies && form.detractionStatus !== 'no_aplicada' ? detraction.detractionAmount : 0;
    const received = Number(form.receivedAmount) || 0;
    const retention = Number(form.igvRetention) || 0;
    const settled = round2(received + retention + detractionCovers);
    const remaining = round2(Math.max(invoice.balance - settled, 0));
    const expectedNet = round2(invoice.total - detractionCovers - retention);
    return { detraction, detractionCovers, settled, remaining, expectedNet };
  }, [invoice, form.detractionStatus, form.receivedAmount, form.igvRetention]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!invoice) {
      setError('Selecciona una factura.');
      return;
    }
    if (!form.paymentDate) {
      setError('Indica la fecha del cobro.');
      return;
    }
    setIsSaving(true);
    const result = await onSubmit(invoice.recordId, {
      paymentDate: form.paymentDate,
      paymentAccount: form.paymentAccount,
      paymentReference: form.paymentReference,
      receivedAmount: Number(form.receivedAmount) || 0,
      igvRetention: Number(form.igvRetention) || 0,
      retentionReceipt: form.retentionReceipt,
      detractionStatus: form.detractionStatus,
      detractionReceipt: form.detractionReceipt,
    });
    setIsSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onClose();
  };

  const agent = invoice ? isRetentionAgent(invoice) : false;
  const fieldClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 disabled:bg-slate-50';
  const inputClass = `mt-1 ${fieldClass}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[95vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="text-lg font-semibold">Registrar cobro</h3>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-slate-100" aria-label="Cerrar">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>
        <form className="space-y-4 overflow-y-auto p-5" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-slate-600">
            Factura
            <select
              value={invoiceId}
              onChange={(event) => selectInvoice(event.target.value)}
              className={`${inputClass} font-semibold`}
            >
              <option value="">Selecciona una factura con saldo</option>
              {invoices.map((item) => (
                <option key={item.recordId} value={item.recordId}>
                  {item.id} · {shortenName(item.client, 30)} ({fmt(item.balance)})
                </option>
              ))}
            </select>
          </label>

          {invoice && preview && (
            <>
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center text-xs">
                <div>
                  <p className="font-semibold uppercase tracking-wide text-slate-500">Total</p>
                  <p className="mt-0.5 text-sm font-bold text-slate-900">{fmt(invoice.total)}</p>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wide text-slate-500">Neto a cuenta</p>
                  <p className="mt-0.5 text-sm font-bold text-blue-700">{fmt(preview.expectedNet)}</p>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wide text-slate-500">Saldo actual</p>
                  <p className="mt-0.5 text-sm font-bold text-slate-900">{fmt(invoice.balance)}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-600">
                  Fecha del cobro
                  <input
                    type="date"
                    value={form.paymentDate}
                    onChange={(event) => setForm((prev) => ({ ...prev, paymentDate: event.target.value }))}
                    className={inputClass}
                    required
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Cuenta destino
                  <input
                    list="payment-account-options"
                    value={form.paymentAccount}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, paymentAccount: event.target.value }))
                    }
                    className={inputClass}
                    placeholder="BBVA cuenta corriente"
                  />
                  <datalist id="payment-account-options">
                    {PAYMENT_ACCOUNTS.map((account) => (
                      <option key={account} value={account} />
                    ))}
                  </datalist>
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Monto recibido en la cuenta
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.receivedAmount}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, receivedAmount: event.target.value }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  N° de operación (opcional)
                  <input
                    value={form.paymentReference}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, paymentReference: event.target.value }))
                    }
                    className={inputClass}
                    placeholder="Del extracto bancario"
                  />
                </label>
              </div>

              {preview.detraction.applies && (
                <fieldset className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                  <legend className="px-1 text-xs font-bold uppercase tracking-wide text-amber-800">
                    Detracción 12% · {fmt(preview.detraction.detractionAmount)}
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-600">
                      Estado
                      <select
                        value={form.detractionStatus ?? 'pendiente'}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            detractionStatus: event.target.value as DetractionStatus,
                          }))
                        }
                        className={inputClass}
                      >
                        {(Object.keys(DETRACTION_STATUS_LABEL) as DetractionStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {DETRACTION_STATUS_LABEL[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm font-medium text-slate-600">
                      N° constancia BN
                      <input
                        value={form.detractionReceipt}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, detractionReceipt: event.target.value }))
                        }
                        className={inputClass}
                        disabled={!collectionColumns || form.detractionStatus === 'no_aplicada'}
                        placeholder="Constancia de depósito"
                      />
                    </label>
                  </div>
                  {form.detractionStatus === 'no_aplicada' && (
                    <p className="mt-2 text-xs text-amber-800">
                      El cliente pagó el total sin detraer: en ese caso normalmente te toca a ti
                      depositar la detracción en el Banco de la Nación (plazo de 5 días hábiles).
                      Confírmalo con tu contador.
                    </p>
                  )}
                </fieldset>
              )}

              {/* La retención no aplica a operaciones sujetas a detracción */}
              {!preview.detraction.applies && (
              <fieldset className="rounded-xl border border-slate-200 p-3">
                <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-600">
                  Retención IGV 3%{agent ? ' · cliente agente de retención' : ''}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-600">
                    Monto retenido
                    <div className="mt-1 flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.igvRetention}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, igvRetention: event.target.value }))
                        }
                        className={fieldClass}
                        disabled={!collectionColumns}
                        placeholder="0.00"
                      />
                      <button
                        type="button"
                        disabled={!collectionColumns}
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            igvRetention: String(round2(invoice.total * IGV_RETENTION_RATE)),
                          }))
                        }
                        className="whitespace-nowrap rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        3%
                      </button>
                    </div>
                  </label>
                  <label className="block text-sm font-medium text-slate-600">
                    N° comprobante de retención
                    <input
                      value={form.retentionReceipt}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, retentionReceipt: event.target.value }))
                      }
                      className={inputClass}
                      disabled={!collectionColumns}
                      placeholder="R001-000123"
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Lo retenido se descuenta del IGV por pagar del mes. Guarda el comprobante que te
                  entrega el cliente.
                </p>
              </fieldset>
              )}

              <div className="rounded-xl bg-slate-900 px-4 py-3 text-sm text-slate-100">
                <p>
                  Este cobro salda <strong>{fmt(Math.min(preview.settled, invoice.balance))}</strong>{' '}
                  <span className="text-slate-400">
                    (cuenta {fmt(Number(form.receivedAmount) || 0)}
                    {Number(form.igvRetention) > 0 && <> + retención {fmt(Number(form.igvRetention))}</>}
                    {preview.detractionCovers > 0 && <> + detracción {fmt(preview.detractionCovers)}</>})
                  </span>
                </p>
                <p className="mt-0.5">
                  {preview.remaining <= 1 ? (
                    <span className="font-semibold text-emerald-300">La factura queda pagada.</span>
                  ) : (
                    <>
                      Queda pendiente <strong className="text-amber-300">{fmt(preview.remaining)}</strong>
                    </>
                  )}
                </p>
              </div>
            </>
          )}

          {!collectionColumns && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Para guardar la cuenta destino, la retención y las constancias, ejecuta{' '}
              <code className="rounded bg-amber-100 px-1 font-mono">supabase/migration-cobranza.sql</code>{' '}
              en Supabase. Mientras tanto se guardan el monto, la fecha y el N° de operación.
            </p>
          )}
          {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={isSaving || !invoice}
            className="w-full rounded-lg bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {isSaving ? 'Guardando…' : 'Registrar cobro'}
          </button>
        </form>
      </div>
    </div>
  );
}
