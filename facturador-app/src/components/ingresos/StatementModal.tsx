'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FileDown, Mail, X } from 'lucide-react';
import type { InvoiceRecord, PartnerRecord } from '@/lib/accounting-types';
import { asLocalDate } from '@/lib/accounting-service';
import { getCollectionBreakdown, round2 } from '@/lib/collection';
import { clientNameKey, findPartner } from '@/lib/collection-matching';
import { parseSunatDocument, type SunatDocument } from '@/lib/sunat-document';
import { printElement } from '@/lib/print';
import { SunatDocumentView } from '@/components/documents/DocumentViewerModal';
import type { StoredSourceDocument } from '@/hooks/use-source-documents';

type Props = {
  invoices: InvoiceRecord[];
  partners: PartnerRecord[];
  initialClientKey: string | null;
  fetchDocument: (
    recordId: string,
  ) => Promise<{ data?: StoredSourceDocument | null; error?: string }>;
  onClose: () => void;
};

type ClientGroup = {
  key: string;
  name: string;
  partner?: PartnerRecord;
  invoices: InvoiceRecord[];
};

const money = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
});
const fmt = (value: number) => money.format(value || 0);
const dateFmt = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = (value: string) => (value ? dateFmt.format(asLocalDate(value)) : '—');

function daysOverdue(invoice: InvoiceRecord) {
  if (invoice.status !== 'Vencido') return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = asLocalDate(invoice.dueDate);
  return Math.max(0, Math.round((today.getTime() - due.getTime()) / 86_400_000));
}

export const findPartnerFor = findPartner;

/** Clave estable por cliente: el partner si existe, si no el nombre normalizado */
export function clientKeyFor(invoice: InvoiceRecord, partners: PartnerRecord[]) {
  const partner = findPartner(invoice, partners);
  return partner ? `p:${partner.id}` : `n:${clientNameKey(invoice.client)}`;
}

export function StatementModal({ invoices, partners, initialClientKey, fetchDocument, onClose }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, ClientGroup>();
    for (const invoice of invoices) {
      if (invoice.balance <= 0) continue;
      const key = clientKeyFor(invoice, partners);
      const partner = findPartnerFor(invoice, partners);
      const group = map.get(key) ?? { key, name: partner?.name ?? invoice.client, partner, invoices: [] };
      group.invoices.push(invoice);
      map.set(key, group);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [invoices, partners]);

  const [clientKey, setClientKey] = useState(
    () => (initialClientKey && groups.some((g) => g.key === initialClientKey) ? initialClientKey : groups[0]?.key) ?? '',
  );
  const group = groups.find((g) => g.key === clientKey);
  const hasOverdue = (group?.invoices ?? []).some((inv) => inv.status === 'Vencido');
  const [onlyOverdue, setOnlyOverdue] = useState(hasOverdue);
  const [copied, setCopied] = useState(false);
  const [printDocs, setPrintDocs] = useState<Map<string, SunatDocument> | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => {
    const list = (group?.invoices ?? [])
      .filter((inv) => !onlyOverdue || inv.status === 'Vencido')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return list.map((invoice) => {
      const breakdown = getCollectionBreakdown(invoice, {
        isRetentionAgent: group?.partner?.isRetentionAgent,
      });
      // Si ya hubo un cobro parcial, el neto es el saldo
      const net = invoice.paid > 0 ? invoice.balance : breakdown.netToAccount;
      return { invoice, breakdown, net, days: daysOverdue(invoice) };
    });
  }, [group, onlyOverdue]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          balance: round2(acc.balance + row.invoice.balance),
          net: round2(acc.net + row.net),
          detraction: round2(acc.detraction + (row.invoice.paid > 0 ? 0 : row.breakdown.detractionAmount)),
          retention: round2(acc.retention + (row.invoice.paid > 0 ? 0 : row.breakdown.retentionAmount)),
        }),
        { balance: 0, net: 0, detraction: 0, retention: 0 },
      ),
    [rows],
  );

  const today = dateFmt.format(new Date());
  const subject = `Estado de cuenta al ${today} — ${group?.name ?? ''}`;
  const body = useMemo(() => {
    if (!group) return '';
    const lines = rows.map(({ invoice, breakdown, net, days }) => {
      const due = invoice.status === 'Vencido' ? `venció el ${fmtDate(invoice.dueDate)} (${days} días)` : `vence el ${fmtDate(invoice.dueDate)}`;
      const split =
        invoice.paid <= 0 && (breakdown.detractionAmount > 0 || breakdown.retentionAmount > 0)
          ? ` — transferencia ${fmt(net)}${breakdown.detractionAmount > 0 ? ` + detracción BN ${fmt(breakdown.detractionAmount)}` : ''}${breakdown.retentionAmount > 0 ? ` + retención ${fmt(breakdown.retentionAmount)}` : ''}`
          : '';
      return `• ${invoice.id} · emitida ${fmtDate(invoice.issueDate)} · ${due} · saldo ${fmt(invoice.balance)}${split}`;
    });
    return [
      'Estimados,',
      '',
      `Les compartimos el estado de cuenta de ${group.name} al ${today}. ${onlyOverdue ? 'Tienen las siguientes facturas vencidas:' : 'Tienen las siguientes facturas pendientes de pago:'}`,
      '',
      ...lines,
      '',
      `Total pendiente: ${fmt(totals.balance)}`,
      totals.detraction > 0 || totals.retention > 0
        ? `(A transferir a nuestra cuenta: ${fmt(totals.net)}${totals.detraction > 0 ? ` · Detracciones al Banco de la Nación: ${fmt(totals.detraction)}` : ''}${totals.retention > 0 ? ` · Retenciones IGV: ${fmt(totals.retention)}` : ''})`
        : '',
      '',
      'Adjuntamos el estado de cuenta y las facturas en PDF. Agradecemos programar el pago a la brevedad.',
      '',
      'Saludos,',
      'Cerezo',
    ]
      .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
      .join('\n');
  }, [group, rows, totals, onlyOverdue, today]);

  // Cuando terminan de cargar los XML se arma el PDF
  useEffect(() => {
    if (!printDocs || !printRef.current) return;
    printElement(printRef.current, `Estado de cuenta ${group?.name ?? ''} ${today}`.trim());
    const handle = setTimeout(() => setPrintDocs(null), 500);
    return () => clearTimeout(handle);
  }, [printDocs, group, today]);

  const handlePdf = async () => {
    setIsPreparing(true);
    const docs = new Map<string, SunatDocument>();
    for (const { invoice } of rows) {
      const result = await fetchDocument(invoice.recordId);
      if (result.data) {
        try {
          docs.set(invoice.recordId, parseSunatDocument(result.data.xml));
        } catch {
          // Sin XML legible: se incluye la ficha con los datos registrados
        }
      }
    }
    setIsPreparing(false);
    setPrintDocs(docs);
  };

  const handleEmail = () => {
    const to = group?.partner?.email ?? '';
    window.open(
      `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      '_blank',
    );
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(`${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const supplierName = printDocs ? Array.from(printDocs.values())[0]?.supplier.name : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[95vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="text-lg font-semibold">Estado de cuenta por cliente</h3>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-slate-100" aria-label="Cerrar">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
          {groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">No hay facturas con saldo pendiente.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[240px] flex-1 text-sm font-medium text-slate-600">
                  Cliente
                  <select
                    value={clientKey}
                    onChange={(event) => {
                      const next = groups.find((g) => g.key === event.target.value);
                      setClientKey(event.target.value);
                      setOnlyOverdue((next?.invoices ?? []).some((inv) => inv.status === 'Vencido'));
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500"
                  >
                    {groups.map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.name} ({g.invoices.length})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={onlyOverdue}
                    onChange={(event) => setOnlyOverdue(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Solo vencidas
                </label>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Factura</th>
                      <th className="px-3 py-2 text-left">Emisión</th>
                      <th className="px-3 py-2 text-left">Vence</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">Neto a cuenta</th>
                      <th className="px-3 py-2 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                          Este cliente no tiene facturas {onlyOverdue ? 'vencidas' : 'pendientes'}.
                        </td>
                      </tr>
                    ) : (
                      rows.map(({ invoice, net, days }) => (
                        <tr key={invoice.recordId}>
                          <td className="px-3 py-2 font-semibold">{invoice.id}</td>
                          <td className="px-3 py-2">{fmtDate(invoice.issueDate)}</td>
                          <td className="px-3 py-2">
                            {fmtDate(invoice.dueDate)}
                            {days > 0 && (
                              <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">
                                {days}d
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(invoice.total)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-blue-700">{fmt(net)}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(invoice.balance)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {rows.length > 0 && (
                    <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                        <td className="px-3 py-2 text-right tabular-nums text-blue-700">{fmt(totals.net)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.balance)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              <div className="rounded-lg border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Correo {group?.partner?.email ? `para ${group.partner.email}` : '(el cliente no tiene email registrado)'}
                  </p>
                </div>
                <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap px-3 py-2 font-sans text-sm text-slate-700">
                  <strong>{subject}</strong>
                  {'\n\n'}
                  {body}
                </pre>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handlePdf}
                  disabled={rows.length === 0 || isPreparing}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <FileDown className="h-4 w-4" />
                  {isPreparing ? 'Preparando…' : 'PDF con estado y facturas'}
                </button>
                <button
                  type="button"
                  onClick={handleEmail}
                  disabled={rows.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Mail className="h-4 w-4" />
                  Abrir correo
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={rows.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Copy className="h-4 w-4" />
                  {copied ? 'Copiado' : 'Copiar texto'}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                El correo se abre en tu programa de email; el PDF (en el diálogo elige “Guardar como PDF”)
                hay que adjuntarlo a mano, porque un enlace de correo no puede adjuntar archivos.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Contenido del PDF: estado de cuenta + una página por factura */}
      {printDocs && group && (
        <div className="pointer-events-none fixed left-[-10000px] top-0 w-[794px]" aria-hidden="true">
          <div ref={printRef} className="space-y-6 bg-white p-2 text-slate-900">
            <section>
              {supplierName && <p className="text-sm font-semibold text-slate-600">{supplierName}</p>}
              <h1 className="text-2xl font-bold">Estado de cuenta</h1>
              <p className="text-sm text-slate-600">
                {group.name}
                {group.partner?.documentNumber ? ` · RUC ${group.partner.documentNumber}` : ''} · al {today}
              </p>
              <table className="mt-4 w-full text-sm">
                <thead className="bg-slate-800 text-[11px] uppercase tracking-wide text-white">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Factura</th>
                    <th className="px-2 py-1.5 text-left">Emisión</th>
                    <th className="px-2 py-1.5 text-left">Vencimiento</th>
                    <th className="px-2 py-1.5 text-right">Días</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                    <th className="px-2 py-1.5 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rows.map(({ invoice, days }) => (
                    <tr key={invoice.recordId}>
                      <td className="px-2 py-1.5 font-semibold">{invoice.id}</td>
                      <td className="px-2 py-1.5">{fmtDate(invoice.issueDate)}</td>
                      <td className="px-2 py-1.5">{fmtDate(invoice.dueDate)}</td>
                      <td className="px-2 py-1.5 text-right">{days || '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(invoice.total)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmt(invoice.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-800 font-bold">
                  <tr>
                    <td colSpan={5} className="px-2 py-1.5 text-right">Total pendiente</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(totals.balance)}</td>
                  </tr>
                </tfoot>
              </table>
              {(totals.detraction > 0 || totals.retention > 0) && (
                <p className="mt-3 text-sm text-slate-700">
                  A transferir a nuestra cuenta: <strong>{fmt(totals.net)}</strong>
                  {totals.detraction > 0 && <> · Detracciones al Banco de la Nación: <strong>{fmt(totals.detraction)}</strong></>}
                  {totals.retention > 0 && <> · Retenciones IGV: <strong>{fmt(totals.retention)}</strong></>}
                </p>
              )}
            </section>
            {rows.map(({ invoice }) => {
              const doc = printDocs.get(invoice.recordId);
              return (
                <section key={invoice.recordId} className="break-before-page">
                  {doc ? (
                    <SunatDocumentView doc={doc} />
                  ) : (
                    <div className="rounded-lg border border-slate-300 p-4 text-sm">
                      <p className="text-lg font-bold">Factura {invoice.id}</p>
                      <p className="text-slate-600">{invoice.client} · RUC {invoice.ruc}</p>
                      <p className="mt-2">{invoice.description}</p>
                      <p className="mt-2">
                        Emisión {fmtDate(invoice.issueDate)} · Vencimiento {fmtDate(invoice.dueDate)}
                      </p>
                      <p className="mt-2 font-semibold">Importe total {fmt(invoice.total)}</p>
                      <p className="mt-3 text-xs text-slate-500">
                        (Sin XML adjunto en el Facturador: se muestran los datos registrados.)
                      </p>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
