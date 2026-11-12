'use client';

import { ChangeEvent, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRightLeft, CheckCircle, Sparkles, Upload, X } from 'lucide-react';
import type { DetractionStatus, InvoiceRecord } from '@/lib/accounting-types';
import { asLocalDate, shortenName } from '@/lib/accounting-service';
import { calcDetraction } from '@/lib/detraction';
import { PAYMENT_ACCOUNTS, getCollectionBreakdown, round2 } from '@/lib/collection';
import {
  MatchSuggestion,
  findPartner,
  normalizeText,
  suggestMatches,
} from '@/lib/collection-matching';
import { BANK_QUICK_LABELS, type BankTransaction } from '@/lib/bank-types';
import { useBankTransactions } from '@/hooks/use-bank-transactions';
import { useInvoices } from '@/hooks/use-invoices';
import { usePartners } from '@/hooks/use-partners';

const money = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
});
const fmt = (value: number) => money.format(value || 0);
const dateFmt = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = (value: string | null | undefined) => (value ? dateFmt.format(asLocalDate(value)) : '—');

// Cuentas que no pasan por el extracto del banco importado
const OFF_STATEMENT_ACCOUNTS = new Set<string>([
  'Banco de la Nación (detracciones)',
  'Otra cuenta',
  'Efectivo / caja',
]);

type AliasPrompt = { invoice: InvoiceRecord; clientName: string; partnerId?: string; text: string };

export default function ConciliacionPage() {
  const {
    transactions,
    isLoading,
    syncError,
    importFromFile,
    reconcileCredit,
    reconciledInvoiceIds,
    categorizeTransaction,
  } = useBankTransactions();
  const { invoices, registerCollection, setPaymentAccount, revertPayment, collectionColumns } =
    useInvoices();
  const {
    partners,
    updatePartnerCollection,
    createClientPartner,
    collectionColumns: partnerColumns,
  } = usePartners();

  const [account, setAccount] = useState<string>(PAYMENT_ACCOUNTS[0]);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [busyTxId, setBusyTxId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [aliasPrompt, setAliasPrompt] = useState<AliasPrompt | null>(null);
  const [manualTxId, setManualTxId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pendingInvoices = useMemo(() => invoices.filter((inv) => inv.balance > 0), [invoices]);

  const credits = useMemo(
    () =>
      transactions
        .filter((tx) => tx.amount > 0 && !tx.isReconciled && !tx.category)
        .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)),
    [transactions],
  );

  const suggestions = useMemo(() => {
    const map = new Map<string, MatchSuggestion[]>();
    for (const tx of credits) map.set(tx.id, suggestMatches(tx, pendingInvoices, partners, 3));
    return map;
  }, [credits, pendingInvoices, partners]);

  const statementRange = useMemo(() => {
    const dates = transactions.map((tx) => tx.transactionDate).sort();
    return dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null;
  }, [transactions]);

  // P6: facturas marcadas como cobradas que no aparecen en el extracto importado
  const unbackedPaid = useMemo(() => {
    if (!statementRange) return [];
    return invoices
      .filter((inv) => inv.status === 'Pagado' && !reconciledInvoiceIds.has(inv.recordId))
      .filter((inv) => !inv.paymentAccount || !OFF_STATEMENT_ACCOUNTS.has(inv.paymentAccount))
      .filter((inv) => {
        const date = inv.paymentDate ?? inv.dueDate;
        return date >= statementRange.from && date <= statementRange.to;
      })
      .sort((a, b) => (a.paymentDate ?? a.dueDate).localeCompare(b.paymentDate ?? b.dueDate));
  }, [invoices, reconciledInvoiceIds, statementRange]);

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIsImporting(true);
    setImportMessage(null);
    setImportErrors([]);
    try {
      const { result, insertedCount, duplicateCount } = await importFromFile(file, account);
      const credited = result.rows.filter((row) => row.amount > 0).length;
      setImportMessage(
        `${insertedCount} movimientos nuevos importados (${credited} abonos en el archivo)` +
          (duplicateCount > 0 ? ` · ${duplicateCount} ya estaban cargados` : '') +
          (result.bankName ? ` · ${result.bankName}` : ''),
      );
      setImportErrors(result.errors);
    } catch (error) {
      console.error(error);
      setImportErrors([error instanceof Error ? error.message : 'No se pudo leer el extracto.']);
    } finally {
      setIsImporting(false);
    }
  };

  const accountFor = (tx: BankTransaction) =>
    tx.accountName && tx.accountName !== 'Principal' ? tx.accountName : PAYMENT_ACCOUNTS[0];

  const referenceFor = (tx: BankTransaction) =>
    tx.reference && !/^\d{2}-\d{2}-\d{4}$/.test(tx.reference)
      ? `${tx.reference} · ${tx.description}`
      : tx.description;

  const applySuggestion = async (tx: BankTransaction, suggestion: MatchSuggestion) => {
    setBusyTxId(tx.id);
    setActionError(null);
    // Lo que entró debe sumar exactamente el abono: la diferencia de céntimos va a la última
    const expected = suggestion.allocations.reduce((sum, a) => sum + a.received, 0);
    const difference = round2(tx.amount - expected);
    const applied: { invoiceId: string; appliedAmount: number }[] = [];

    for (const [index, allocation] of suggestion.allocations.entries()) {
      const { invoice } = allocation;
      const received = round2(
        allocation.received + (index === suggestion.allocations.length - 1 ? difference : 0),
      );
      const detractionApplies = calcDetraction(invoice.total).applies;
      const detractionStatus: DetractionStatus | null = detractionApplies
        ? allocation.detractionNotApplied
          ? 'no_aplicada'
          : invoice.detractionStatus ?? 'pendiente'
        : null;
      const result = await registerCollection(invoice.recordId, {
        paymentDate: tx.transactionDate,
        paymentAccount: accountFor(tx),
        paymentReference: referenceFor(tx),
        receivedAmount: received,
        igvRetention: allocation.retention,
        retentionReceipt: invoice.retentionReceipt ?? '',
        detractionStatus,
        detractionReceipt: invoice.detractionReceipt ?? '',
      });
      if (result.error) {
        setActionError(`${invoice.id}: ${result.error}`);
        setBusyTxId(null);
        return;
      }
      applied.push({ invoiceId: invoice.recordId, appliedAmount: received });
    }

    const result = await reconcileCredit(tx.id, applied, {
      matchType: suggestion.allocations.length > 1 ? 'sum' : 'exact',
      confidence: suggestion.score,
      notes: suggestion.reasons.join('; '),
    });
    if (result.error) setActionError(result.error);
    setBusyTxId(null);

    // Si el banco no mostró al cliente, ofrecer guardarlo como alias
    if (!suggestion.payerMatched) {
      setAliasPrompt({
        invoice: suggestion.allocations[0].invoice,
        clientName: suggestion.clientName,
        partnerId: suggestion.partner?.id,
        text: cleanGlosa(tx.description),
      });
    }
  };

  const saveAlias = async () => {
    if (!aliasPrompt) return;
    const alias = aliasPrompt.text.trim();
    if (!alias) return;
    setActionError(null);
    let result: { error?: string };
    if (aliasPrompt.partnerId) {
      const partner = partners.find((p) => p.id === aliasPrompt.partnerId);
      result = await updatePartnerCollection(aliasPrompt.partnerId, {
        bankAliases: [...(partner?.bankAliases ?? []), alias],
      });
    } else {
      result = await createClientPartner({
        name: aliasPrompt.invoice.client,
        documentNumber: aliasPrompt.invoice.ruc,
        bankAliases: [alias],
      });
    }
    if (result.error) {
      setActionError(result.error);
      return;
    }
    setAliasPrompt(null);
  };

  const markNotCollection = async (tx: BankTransaction, label: string) => {
    setBusyTxId(tx.id);
    const result = await categorizeTransaction(tx.id, label);
    if (result.error) setActionError(result.error);
    setBusyTxId(null);
  };

  const pendingCreditsTotal = credits.reduce((sum, tx) => sum + tx.amount, 0);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex w-full flex-col gap-6 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <header className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-500">Cobranza</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">Conciliación bancaria</h1>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
                title="Cuenta a la que pertenece el extracto"
              >
                {PAYMENT_ACCOUNTS.filter((item) => item === 'BBVA cuenta corriente' || item === 'Otra cuenta').map(
                  (item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ),
                )}
              </select>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={isImporting}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                <Upload className="h-4 w-4" />
                {isImporting ? 'Importando…' : 'Importar extracto'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xls,.xlsx,.csv,.txt,.pdf"
                className="sr-only"
                onChange={handleImport}
              />
            </div>
          </div>
          <p className="max-w-3xl text-sm text-slate-600">
            Sube el Excel de BBVA (o CSV/PDF). Para cada abono se proponen las facturas que lo
            explican —por monto neto de detracción o retención, fecha y pagador—, incluidas
            combinaciones de varias facturas del mismo cliente.
          </p>
        </header>

        {(importMessage || importErrors.length > 0 || syncError || actionError) && (
          <div className="space-y-2">
            {importMessage && (
              <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                <CheckCircle className="h-4 w-4" />
                {importMessage}
              </p>
            )}
            {[...importErrors, syncError, actionError].filter(Boolean).map((message) => (
              <p
                key={message}
                className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
              >
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {message}
              </p>
            ))}
          </div>
        )}

        {(!collectionColumns || !partnerColumns) && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Para guardar la cuenta destino, las retenciones y los alias bancarios, ejecuta{' '}
            <code className="rounded bg-amber-100 px-1 font-mono">supabase/migration-cobranza.sql</code> en
            el SQL Editor de Supabase.
          </p>
        )}

        {aliasPrompt && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            <span className="text-indigo-900">
              El banco no mostró a <strong>{shortenName(aliasPrompt.clientName, 40)}</strong>. ¿Guardar
              esta glosa como su alias para reconocerlo la próxima vez?
            </span>
            <input
              value={aliasPrompt.text}
              onChange={(event) =>
                setAliasPrompt((prev) => (prev ? { ...prev, text: event.target.value } : prev))
              }
              className="min-w-[220px] flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            />
            <button
              type="button"
              onClick={saveAlias}
              disabled={!partnerColumns}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Guardar alias
            </button>
            <button
              type="button"
              onClick={() => setAliasPrompt(null)}
              className="rounded-full p-1 text-indigo-500 hover:bg-indigo-100"
              aria-label="Descartar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-3">
          <Stat label="Abonos por conciliar" value={String(credits.length)} hint={fmt(pendingCreditsTotal)} />
          <Stat
            label="Facturas con saldo"
            value={String(pendingInvoices.length)}
            hint={fmt(pendingInvoices.reduce((sum, inv) => sum + inv.balance, 0))}
          />
          <Stat
            label="Extracto cargado"
            value={statementRange ? `${fmtDate(statementRange.from)} – ${fmtDate(statementRange.to)}` : '—'}
            hint={`${transactions.length} movimientos`}
            small
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600">Abonos por conciliar</h2>
          {isLoading ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              Cargando movimientos…
            </p>
          ) : credits.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              No hay abonos pendientes. Importa un extracto para empezar.
            </p>
          ) : (
            credits.map((tx) => {
              const list = suggestions.get(tx.id) ?? [];
              const busy = busyTxId === tx.id;
              return (
                <article key={tx.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {fmtDate(tx.transactionDate)} · {accountFor(tx)}
                      </p>
                      <p className="break-words font-medium text-slate-900">{tx.description}</p>
                      {tx.reference && <p className="text-xs text-slate-500">{tx.reference}</p>}
                    </div>
                    <p className="text-xl font-black tabular-nums text-emerald-700">{fmt(tx.amount)}</p>
                  </div>
                  <div className="space-y-2 px-4 py-3">
                    {list.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        Sin coincidencias automáticas: puede ser un pago parcial, un adelanto o un
                        cliente que pagó un monto distinto.
                      </p>
                    ) : (
                      list.map((suggestion) => (
                        <SuggestionRow
                          key={suggestion.allocations.map((a) => a.invoice.recordId).join('+')}
                          suggestion={suggestion}
                          disabled={busy}
                          onApply={() => applySuggestion(tx, suggestion)}
                        />
                      ))
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {manualTxId === tx.id ? (
                        <ManualPicker
                          tx={tx}
                          invoices={pendingInvoices}
                          isRetentionAgent={(invoice) => findPartner(invoice, partners)?.isRetentionAgent ?? false}
                          onCancel={() => setManualTxId(null)}
                          onPick={(invoice) => {
                            setManualTxId(null);
                            void applySuggestion(tx, {
                              allocations: [
                                { invoice, received: tx.amount, retention: 0, detractionNotApplied: false },
                              ],
                              clientName: invoice.client,
                              partner: findPartner(invoice, partners),
                              score: 0,
                              difference: 0,
                              reasons: ['conciliación manual'],
                              payerMatched: true,
                            });
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setManualTxId(tx.id)}
                          disabled={busy}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Elegir factura a mano
                        </button>
                      )}
                      <select
                        value=""
                        disabled={busy}
                        onChange={(event) => event.target.value && void markNotCollection(tx, event.target.value)}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-600 outline-none"
                      >
                        <option value="">No es cobro de factura…</option>
                        {BANK_QUICK_LABELS.map((label) => (
                          <option key={label.value} value={label.value}>
                            {label.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>

        {statementRange && (
          <section className="rounded-xl border border-orange-200 bg-white shadow-sm">
            <div className="border-b border-orange-100 px-4 py-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-orange-800">
                Cobradas sin movimiento en el extracto ({fmtDate(statementRange.from)} – {fmtDate(statementRange.to)})
              </h2>
              <p className="text-xs text-slate-500">
                Facturas marcadas como pagadas en este período que no se ligaron a ningún abono. O entraron a
                otra cuenta, o se marcaron como pagadas por error.
              </p>
            </div>
            {unbackedPaid.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-500">Todo cuadra: no hay cobros sin respaldo.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {unbackedPaid.map((invoice) => {
                  const breakdown = getCollectionBreakdown(invoice, {
                    isRetentionAgent: findPartner(invoice, partners)?.isRetentionAgent,
                  });
                  return (
                    <li key={invoice.recordId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">
                          {invoice.id} · {shortenName(invoice.client, 40)}
                        </p>
                        <p className="text-xs text-slate-500">
                          Total {fmt(invoice.total)} · debió entrar {fmt(breakdown.netToAccount)} ·{' '}
                          {invoice.paymentDate ? `cobro ${fmtDate(invoice.paymentDate)}` : `vence ${fmtDate(invoice.dueDate)}`}
                          {invoice.paymentAccount ? ` · ${invoice.paymentAccount}` : ' · cuenta sin registrar'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value=""
                          disabled={!collectionColumns}
                          onChange={(event) =>
                            event.target.value && void setPaymentAccount(invoice.recordId, event.target.value)
                          }
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none disabled:opacity-50"
                        >
                          <option value="">Entró a otra cuenta…</option>
                          {Array.from(OFF_STATEMENT_ACCOUNTS).map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`¿Marcar ${invoice.id} como NO pagada?`)) void revertPayment(invoice.recordId);
                          }}
                          className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-300"
                        >
                          No estaba pagada
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint, small }: { label: string; value: string; hint: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 font-bold text-slate-900 ${small ? 'text-base' : 'text-3xl'}`}>{value}</p>
      <p className="text-sm text-slate-500">{hint}</p>
    </div>
  );
}

function SuggestionRow({
  suggestion,
  disabled,
  onApply,
}: {
  suggestion: MatchSuggestion;
  disabled: boolean;
  onApply: () => void;
}) {
  const pct = Math.round(suggestion.score * 100);
  const tone =
    pct >= 85
      ? 'bg-emerald-100 text-emerald-800'
      : pct >= 65
        ? 'bg-amber-100 text-amber-800'
        : 'bg-slate-100 text-slate-600';
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
      <span className={`rounded-md px-2 py-0.5 text-xs font-black tabular-nums ${tone}`}>{pct}%</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">
          {suggestion.allocations.map((a) => a.invoice.id).join(' + ')}
          <span className="font-normal text-slate-500"> · {shortenName(suggestion.clientName, 36)}</span>
        </p>
        <p className="text-xs text-slate-500">
          {suggestion.allocations
            .map(
              (a) =>
                `${a.invoice.id}: ${fmt(a.received)}${a.retention > 0 ? ` (+ret. ${fmt(a.retention)})` : ''}`,
            )
            .join(' · ')}
        </p>
        <p className="text-[11px] text-slate-400">{suggestion.reasons.join(' · ')}</p>
      </div>
      <button
        type="button"
        onClick={onApply}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        <ArrowRightLeft className="h-3.5 w-3.5" />
        Conciliar
      </button>
    </div>
  );
}

function ManualPicker({
  tx,
  invoices,
  isRetentionAgent,
  onPick,
  onCancel,
}: {
  tx: BankTransaction;
  invoices: InvoiceRecord[];
  isRetentionAgent: (invoice: InvoiceRecord) => boolean;
  onPick: (invoice: InvoiceRecord) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState('');
  // Las de monto más parecido primero
  const sorted = useMemo(
    () =>
      [...invoices].sort((a, b) => {
        const netA = getCollectionBreakdown(a, { isRetentionAgent: isRetentionAgent(a) }).netToAccount;
        const netB = getCollectionBreakdown(b, { isRetentionAgent: isRetentionAgent(b) }).netToAccount;
        return Math.abs(netA - tx.amount) - Math.abs(netB - tx.amount);
      }),
    [invoices, isRetentionAgent, tx.amount],
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        className="max-w-[420px] rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none"
      >
        <option value="">Factura con saldo…</option>
        {sorted.slice(0, 60).map((invoice) => (
          <option key={invoice.recordId} value={invoice.recordId}>
            {invoice.id} · {shortenName(invoice.client, 28)} · saldo {fmt(invoice.balance)}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!selected}
        onClick={() => {
          const invoice = invoices.find((item) => item.recordId === selected);
          if (invoice) onPick(invoice);
        }}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        Conciliar con el abono completo
      </button>
      <button type="button" onClick={onCancel} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
        Cancelar
      </button>
    </div>
  );
}

/** Quita códigos del banco ("TIN002F000…", "ABONO INMEDIATO 002") para sugerir el alias */
function cleanGlosa(description: string) {
  const cleaned = normalizeText(description)
    .replace(/\bTIN\d+[A-Z0-9]*\b/g, '')
    .replace(/\bABONO INMEDIATO\b/g, '')
    .replace(/\b\d{3,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || description.trim();
}
