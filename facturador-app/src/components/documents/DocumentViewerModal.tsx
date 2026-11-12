'use client';

import { ChangeEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, FileText, Printer, Upload, X } from 'lucide-react';
import {
  CURRENCY_LABELS,
  SunatDocument,
  parseSunatDocument,
  readXmlFile,
  toDownloadableXml,
} from '@/lib/sunat-document';
import type { StoredSourceDocument } from '@/hooks/use-source-documents';
import { printElement } from '@/lib/print';

type Field = { label: string; value: string };

type Props = {
  recordId: string;
  /** Número registrado (p. ej. E001-360), para validar el XML que se adjunta */
  expectedNumber: string;
  /** Datos registrados en la app, se muestran si no hay XML */
  fallbackFields: Field[];
  /** Estado interno (cobro/pago). Se ve en pantalla, no se imprime */
  statusSlot?: ReactNode;
  tableMissing: boolean;
  fetchDocument: (
    recordId: string,
  ) => Promise<{ data?: StoredSourceDocument | null; error?: string }>;
  saveDocument: (recordId: string, xml: string, fileName: string) => Promise<{ error?: string }>;
  onClose: () => void;
};

type LoadState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; xml: string; fileName: string | null; doc: SunatDocument };

export function DocumentViewerModal({
  recordId,
  expectedNumber,
  fallbackFields,
  statusSlot,
  tableMissing,
  fetchDocument,
  saveDocument,
  onClose,
}: Props) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const printRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchDocument(recordId);
      if (cancelled) return;
      if (result.error) {
        setState({ status: 'error', message: result.error });
        return;
      }
      if (!result.data) {
        setState({ status: 'empty' });
        return;
      }
      try {
        setState({
          status: 'ready',
          xml: result.data.xml,
          fileName: result.data.fileName,
          doc: parseSunatDocument(result.data.xml),
        });
      } catch (error) {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'No se pudo leer el XML guardado.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordId, fetchDocument]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleAttach = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAttachError(null);
    setIsAttaching(true);
    try {
      const xml = await readXmlFile(file);
      const doc = parseSunatDocument(xml);
      if (!sameDocumentNumber(doc.id, expectedNumber)) {
        setAttachError(
          `Este XML corresponde al comprobante ${doc.id}, no a ${expectedNumber}. Revisa el archivo.`,
        );
        return;
      }
      const result = await saveDocument(recordId, xml, file.name);
      if (result.error) {
        setAttachError(result.error);
        return;
      }
      setState({ status: 'ready', xml, fileName: file.name, doc });
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : 'No se pudo leer el XML.');
    } finally {
      setIsAttaching(false);
    }
  };

  const handleDownload = () => {
    if (state.status !== 'ready') return;
    const blob = new Blob([toDownloadableXml(state.xml)], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = state.fileName || `${state.doc.id}.xml`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handlePrint = () => {
    if (state.status !== 'ready' || !printRef.current) return;
    printElement(printRef.current, `${state.doc.id} ${state.doc.supplier.name}`.trim());
  };

  const canAttach = !tableMissing && !isAttaching;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[95vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-5 w-5 flex-shrink-0 text-slate-500" />
            <h3 className="truncate text-lg font-semibold text-slate-900">{expectedNumber}</h3>
            {state.status === 'ready' && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold uppercase text-emerald-700">
                XML SUNAT
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {state.status === 'ready' && (
              <>
                <ToolbarButton onClick={handlePrint} icon={<Printer className="h-4 w-4" />}>
                  Imprimir / PDF
                </ToolbarButton>
                <ToolbarButton onClick={handleDownload} icon={<Download className="h-4 w-4" />}>
                  XML
                </ToolbarButton>
                <ToolbarButton
                  onClick={() => fileInputRef.current?.click()}
                  icon={<Upload className="h-4 w-4" />}
                  disabled={!canAttach}
                  title="Reemplazar el XML guardado"
                >
                  Reemplazar
                </ToolbarButton>
              </>
            )}
            <button
              onClick={onClose}
              className="rounded-full p-1.5 hover:bg-slate-100"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5 text-slate-500" />
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xml,text/xml,application/xml"
          className="sr-only"
          onChange={handleAttach}
        />

        <div className="overflow-y-auto p-4 sm:p-6">
          {statusSlot && <div className="mb-4">{statusSlot}</div>}

          {attachError && (
            <p className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {attachError}
            </p>
          )}

          {state.status === 'loading' && (
            <p className="py-16 text-center text-sm text-slate-500">Cargando comprobante…</p>
          )}

          {state.status === 'error' && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {state.message}
            </p>
          )}

          {state.status === 'empty' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-200">
                <p className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Datos registrados en la app
                </p>
                <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
                  {fallbackFields.map((field) => (
                    <div key={field.label} className="min-w-0">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {field.label}
                      </dt>
                      <dd className="whitespace-pre-line break-words text-sm text-slate-900">
                        {field.value || '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center">
                <Upload className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-2 text-sm font-semibold text-slate-800">
                  Este registro no tiene el XML original
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                  Adjunta el XML de SUNAT de {expectedNumber} para ver la factura completa: todas las
                  líneas, cuotas, detracción, orden de compra y monto en letras.
                </p>
                {tableMissing ? (
                  <p className="mx-auto mt-4 max-w-md rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Falta crear la tabla de comprobantes: ejecuta{' '}
                    <code className="rounded bg-amber-100 px-1 font-mono">
                      supabase/migration-documentos.sql
                    </code>{' '}
                    en el SQL Editor de Supabase y recarga.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!canAttach}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    <Upload className="h-4 w-4" />
                    {isAttaching ? 'Adjuntando…' : 'Adjuntar XML'}
                  </button>
                )}
              </div>
            </div>
          )}

          {state.status === 'ready' && (
            <div ref={printRef}>
              <SunatDocumentView doc={state.doc} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  icon,
  children,
  disabled,
  title,
}: {
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </button>
  );
}

/** Representación del comprobante, al estilo de la representación impresa SUNAT */
export function SunatDocumentView({ doc }: { doc: SunatDocument }) {
  const money = (value: number) => formatMoney(value, doc.currency);
  const showUnitPrice = doc.lines.some((line) => line.unitPrice !== null);
  // Sin repetir lo que ya se muestra en su propio bloque (detracción, orden de compra)
  const notes = doc.notes.filter(
    (note) =>
      !(doc.detraction && /sujeta a detracci/i.test(note)) &&
      !(doc.orderReference && /orden de compra/i.test(note) && note.includes(doc.orderReference)),
  );
  const totalRows = buildTotalRows(doc);

  return (
    <article className="space-y-6 text-slate-900">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-lg font-bold leading-tight">{doc.supplier.name || 'Emisor'}</p>
          {doc.supplier.tradeName && (
            <p className="text-sm text-slate-600">{doc.supplier.tradeName}</p>
          )}
          {doc.supplier.address && (
            <p className="text-xs text-slate-500">{doc.supplier.address}</p>
          )}
        </div>
        <div className="flex-shrink-0 rounded-lg border-2 border-slate-800 px-5 py-3 text-center sm:min-w-[220px]">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            {doc.docTypeLabel}
          </p>
          {doc.supplier.documentNumber && (
            <p className="mt-1 text-sm font-semibold">
              {doc.supplier.documentType ?? 'RUC'} {doc.supplier.documentNumber}
            </p>
          )}
          <p className="mt-1 text-xl font-black tracking-wide">{doc.id}</p>
        </div>
      </header>

      <section className="grid gap-x-8 gap-y-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
        <Info label="Cliente" value={doc.customer.name} strong />
        <Info label="Fecha de emisión" value={formatLongDate(doc.issueDate, doc.issueTime)} />
        <Info
          label={doc.customer.documentType ?? 'Documento'}
          value={doc.customer.documentNumber}
        />
        <Info label="Fecha de vencimiento" value={doc.dueDate ? formatLongDate(doc.dueDate) : ''} />
        <Info label="Dirección" value={doc.customer.address ?? ''} />
        <Info
          label="Moneda"
          value={`${CURRENCY_LABELS[doc.currency] ?? doc.currency} (${doc.currency})`}
        />
        {doc.orderReference && <Info label="Orden de compra" value={doc.orderReference} />}
        {doc.paymentForm && <Info label="Forma de pago" value={doc.paymentForm} />}
        {doc.reference && (
          <Info
            label="Documento que modifica"
            value={[doc.reference.id, doc.reference.reason].filter(Boolean).join(' · ')}
          />
        )}
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-800 text-[11px] uppercase tracking-wide text-white">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">#</th>
              <th className="px-3 py-2 text-right font-semibold">Cant.</th>
              <th className="px-3 py-2 text-left font-semibold">Unid.</th>
              <th className="px-3 py-2 text-left font-semibold">Descripción</th>
              <th className="px-3 py-2 text-right font-semibold">V. unitario</th>
              {showUnitPrice && <th className="px-3 py-2 text-right font-semibold">P. unitario</th>}
              <th className="px-3 py-2 text-right font-semibold">Valor venta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {doc.lines.length === 0 ? (
              <tr>
                <td colSpan={showUnitPrice ? 7 : 6} className="px-3 py-4 text-center text-slate-500">
                  El XML no trae líneas de detalle.
                </td>
              </tr>
            ) : (
              doc.lines.map((line) => (
                <tr key={line.id} className="align-top">
                  <td className="px-3 py-2 text-slate-500">{line.id}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(line.quantity)}</td>
                  <td className="px-3 py-2 text-slate-600">{line.unitLabel}</td>
                  <td className="px-3 py-2">
                    <p className="whitespace-pre-line font-medium">{line.description || '—'}</p>
                    {(line.code || line.freeOfCharge) && (
                      <p className="text-xs text-slate-500">
                        {line.code && <>Código {line.code}</>}
                        {line.code && line.freeOfCharge && ' · '}
                        {line.freeOfCharge && 'Transferencia gratuita'}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(line.unitValue)}</td>
                  {showUnitPrice && (
                    <td className="px-3 py-2 text-right tabular-nums">
                      {line.unitPrice !== null ? formatNumber(line.unitPrice) : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatNumber(line.lineTotal)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-3 text-sm">
          {doc.amountInWords && (
            <p className="font-semibold uppercase text-slate-800">{doc.amountInWords}</p>
          )}
          {notes.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Observaciones</p>
              <ul className="mt-1 space-y-0.5 text-slate-700">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <dl className="w-full flex-shrink-0 space-y-1.5 rounded-lg border border-slate-200 p-4 text-sm sm:w-72">
          {totalRows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt className="text-slate-600">{row.label}</dt>
              <dd className="tabular-nums">{money(row.value)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 text-base font-bold">
            <dt>Importe total</dt>
            <dd className="tabular-nums">{money(doc.totals.payable)}</dd>
          </div>
        </dl>
      </section>

      {(doc.detraction || doc.installments.length > 0 || doc.paymentForm === 'Crédito') && (
        <section className="grid gap-4 sm:grid-cols-2">
          {doc.detraction && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
                Operación sujeta a detracción (SPOT)
              </p>
              <dl className="mt-2 space-y-1">
                {doc.detraction.percent !== null && (
                  <Row label="Porcentaje" value={`${formatNumber(doc.detraction.percent)}%`} />
                )}
                {doc.detraction.amount !== null && (
                  <Row label="Monto detracción" value={money(doc.detraction.amount)} />
                )}
                {doc.detraction.account && (
                  <Row label="Cta. Banco de la Nación" value={doc.detraction.account} />
                )}
                {doc.detraction.serviceCode && (
                  <Row label="Código bien/servicio" value={doc.detraction.serviceCode} />
                )}
              </dl>
            </div>
          )}
          {(doc.installments.length > 0 || doc.creditAmount !== undefined) && (
            <div className="rounded-lg border border-slate-200 p-4 text-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Información del crédito
              </p>
              {doc.creditAmount !== undefined && (
                <dl className="mt-2">
                  <Row label="Monto neto pendiente de pago" value={money(doc.creditAmount)} strong />
                </dl>
              )}
              {doc.installments.length > 0 && (
                <table className="mt-2 w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1 font-semibold">Cuota</th>
                      <th className="py-1 font-semibold">Vence</th>
                      <th className="py-1 text-right font-semibold">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {doc.installments.map((installment, index) => (
                      <tr key={installment.id}>
                        <td className="py-1">{index + 1}</td>
                        <td className="py-1">
                          {installment.dueDate ? formatShortDate(installment.dueDate) : '—'}
                        </td>
                        <td className="py-1 text-right tabular-nums">{money(installment.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </section>
      )}
    </article>
  );
}

function Info({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`break-words ${strong ? 'font-semibold' : ''}`}>{value || '—'}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-600">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-bold' : 'font-medium'}`}>{value}</dd>
    </div>
  );
}

function buildTotalRows(doc: SunatDocument) {
  const rows: { label: string; value: number }[] = [];
  const byCode = (code: string) => doc.taxSubtotals.filter((sub) => sub.code === code);
  const sum = (list: { taxable: number }[]) => list.reduce((acc, sub) => acc + sub.taxable, 0);

  const gravadas = byCode('1000');
  if (gravadas.length > 0) rows.push({ label: 'Op. gravadas', value: sum(gravadas) });
  for (const [code, label] of [
    ['9997', 'Op. exoneradas'],
    ['9998', 'Op. inafectas'],
    ['9995', 'Exportación'],
    ['9996', 'Op. gratuitas'],
  ] as const) {
    const list = byCode(code);
    if (list.length > 0 && sum(list) > 0) rows.push({ label, value: sum(list) });
  }
  if (rows.length === 0) rows.push({ label: 'Valor de venta', value: doc.totals.lineExtension });
  if (doc.totals.allowance > 0) rows.push({ label: 'Descuentos', value: -doc.totals.allowance });

  const taxes = doc.taxSubtotals.filter((sub) => ['1000', '1016', '2000', '7152'].includes(sub.code));
  if (taxes.length > 0) {
    for (const tax of taxes) {
      const label = tax.percent ? `${tax.name} (${formatNumber(tax.percent, 0)}%)` : tax.name;
      rows.push({ label, value: tax.amount });
    }
  } else if (doc.totals.taxTotal > 0) {
    rows.push({ label: 'Impuestos', value: doc.totals.taxTotal });
  }
  if (doc.totals.charge > 0) rows.push({ label: 'Otros cargos', value: doc.totals.charge });
  if (doc.totals.prepaid > 0) rows.push({ label: 'Anticipos', value: -doc.totals.prepaid });
  return rows;
}

/** Compara E001-360 con E001-00000360, etc. Si uno no trae serie, compara solo el número. */
export function sameDocumentNumber(a: string, b: string) {
  const split = (value: string) => {
    const clean = value.trim().toUpperCase();
    const dash = clean.lastIndexOf('-');
    const series = dash >= 0 ? clean.slice(0, dash) : '';
    const number = (dash >= 0 ? clean.slice(dash + 1) : clean).replace(/^0+(?=\d)/, '');
    return { series, number };
  };
  const left = split(a);
  const right = split(b);
  if (left.number !== right.number) return false;
  return !left.series || !right.series || left.series === right.series;
}

const numberFormatter = new Intl.NumberFormat('es-PE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatNumber(value: number, decimals = 2) {
  if (decimals === 2) return numberFormatter.format(value || 0);
  return new Intl.NumberFormat('es-PE', { maximumFractionDigits: decimals }).format(value || 0);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('es-PE', { maximumFractionDigits: 3 }).format(value || 0);
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(value || 0);
  } catch {
    return `${currency} ${formatNumber(value)}`;
  }
}

function toLocalDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

function formatLongDate(value: string, time?: string) {
  if (!value) return '';
  const date = toLocalDate(value);
  if (Number.isNaN(date.getTime())) return value;
  const label = new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  return time ? `${label}, ${time.slice(0, 5)}` : label;
}

function formatShortDate(value: string) {
  const date = toLocalDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    date,
  );
}
