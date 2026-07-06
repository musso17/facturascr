'use client';

import { useTaxSummary } from '@/hooks/use-tax-summary';
import { useExpenses } from '@/hooks/use-expenses';
import { useInvoices } from '@/hooks/use-invoices';
import { asLocalDate } from '@/lib/accounting-service';
import { calcDetraction } from '@/lib/detraction';
import {
  FileDown,
  Landmark,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Calculator,
  Users,
  CheckCircle,
  AlertCircle,
  Info,
} from 'lucide-react';
import { useMemo, useState } from 'react';

// Límites referenciales 4ta categoría 2026 — confirmar en sunat.gob.pe
const RENTA_4TA_ANNUAL_LIMIT = 36313;
const CURRENT_YEAR = new Date().getFullYear();

export default function ImpuestosPage() {
  const { items, currentMonth, isLoading, refresh } = useTaxSummary();
  const { expenses } = useExpenses();
  const { invoices } = useInvoices();

  // ─── P4: Saldo estimado cuenta detracciones (BN) ─────────────────────────────
  const [bnSunatPaid, setBnSunatPaid] = useState(() => {
    if (typeof window === 'undefined') return '0';
    return localStorage.getItem('bnSunatPayments') ?? '0';
  });

  const detraccionesDepositadas = useMemo(
    () =>
      invoices
        .filter((inv) => inv.detractionDeposited)
        .reduce((sum, inv) => sum + calcDetraction(inv.total).detractionAmount, 0),
    [invoices],
  );

  const pendingDetractions = useMemo(
    () =>
      invoices.filter(
        (inv) => calcDetraction(inv.total).applies && !inv.detractionDeposited,
      ).length,
    [invoices],
  );

  const bnBalance = detraccionesDepositadas - (parseFloat(bnSunatPaid) || 0);

  const handleBnPaidChange = (value: string) => {
    setBnSunatPaid(value);
    localStorage.setItem('bnSunatPayments', value);
  };

  // ─── Simulador ───────────────────────────────────────────────────────────────
  const [simAmount, setSimAmount] = useState('');
  const [simType, setSimType] = useState<'factura' | 'recibo'>('factura');

  const simValue = parseFloat(simAmount) || 0;
  const currentIgvPayable = currentMonth?.igvPayable ?? 0;

  // Factura: monto total incluye IGV → crédito = total × 18/118
  const simIgvCredit = simType === 'factura' ? (simValue * 18) / 118 : 0;
  const simBase = simValue - simIgvCredit;
  const simNewIgvPayable = Math.max(0, currentIgvPayable - simIgvCredit);
  const simIgvSaving = currentIgvPayable - simNewIgvPayable;
  const simCreditCarryover = Math.max(0, simIgvCredit - currentIgvPayable);

  // Recibo: retención IR del 8%
  const simIrRetention = simType === 'recibo' ? simValue * 0.08 : 0;
  const simNetProfessional = simValue - simIrRetention;

  // ─── Crédito fiscal acumulado ─────────────────────────────────────────────────
  const yearItems = useMemo(
    () => items.filter((item) => item.period.startsWith(String(CURRENT_YEAR))),
    [items],
  );

  const yearTotals = useMemo(
    () =>
      yearItems.reduce(
        (acc, item) => {
          acc.igvSales += item.igvSales;
          acc.igvPurchases += item.igvPurchases;
          acc.netPayable += item.igvSales - item.igvPurchases;
          return acc;
        },
        { igvSales: 0, igvPurchases: 0, netPayable: 0 },
      ),
    [yearItems],
  );

  const maxIgvBar = useMemo(
    () => Math.max(...yearItems.map((i) => Math.max(i.igvSales, i.igvPurchases)), 1),
    [yearItems],
  );

  // ─── 4ta categoría ───────────────────────────────────────────────────────────
  const currentYearRecibos = useMemo(
    () =>
      expenses.filter(
        (e) => e.documentType === 'recibo' && e.issueDate.startsWith(String(CURRENT_YEAR)),
      ),
    [expenses],
  );

  const honorariosByProvider = useMemo(() => {
    const map = new Map<
      string,
      { name: string; document: string | null; total: number; retentions: number }
    >();
    for (const e of currentYearRecibos) {
      // Deduplicate by normalized document: RUC personal 10XXXXXXXXY → DNI XXXXXXXX
      const key = normalizeDocKey(e.providerDocument) ?? e.providerName;
      const prev = map.get(key) ?? {
        name: e.providerName,
        document: e.providerDocument ?? null,
        total: 0,
        retentions: 0,
      };
      // Prefer Title Case name over ALL CAPS when merging
      if (prev.name === prev.name.toUpperCase() && e.providerName !== e.providerName.toUpperCase()) {
        prev.name = e.providerName;
      }
      prev.total += e.baseAmount;
      prev.retentions += e.irRetention;
      map.set(key, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [currentYearRecibos]);

  const overLimitCount = honorariosByProvider.filter(
    (p) => p.total >= RENTA_4TA_ANNUAL_LIMIT,
  ).length;
  const nearLimitCount = honorariosByProvider.filter(
    (p) => p.total >= RENTA_4TA_ANNUAL_LIMIT * 0.7 && p.total < RENTA_4TA_ANNUAL_LIMIT,
  ).length;

  // ─── Summary cards ────────────────────────────────────────────────────────────
  const summaryCards = [
    {
      label: 'IGV ventas',
      value: currentMonth?.igvSales ?? 0,
      hint: 'Impuesto generado por ventas',
      Icon: TrendingUp,
      color: 'blue',
    },
    {
      label: 'IGV compras',
      value: currentMonth?.igvPurchases ?? 0,
      hint: 'Crédito fiscal disponible',
      Icon: ShoppingCart,
      color: 'orange',
    },
    {
      label: 'IGV por pagar',
      value: currentMonth?.igvPayable ?? 0,
      hint: 'IGV ventas − IGV compras',
      Icon: Landmark,
      color: 'purple',
    },
    {
      label: 'Retenciones IR',
      value: currentMonth?.irRetentionExpenses ?? 0,
      hint: 'Honorarios retenidos',
      Icon: FileDown,
      color: 'red',
    },
  ];

  const colorMap = {
    blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
    orange: { bg: 'bg-orange-100', text: 'text-orange-600' },
    purple: { bg: 'bg-purple-100', text: 'text-purple-600' },
    red: { bg: 'bg-red-100', text: 'text-red-600' },
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex w-full flex-col gap-8 px-4 pb-16 pt-10 sm:px-6 lg:px-8">

        {/* Header */}
        <header className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-500">Impuestos</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">Obligaciones SUNAT</h1>
            <button
              type="button"
              onClick={refresh}
              disabled={isLoading}
              className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg font-medium"
            >
              {isLoading ? 'Actualizando...' : 'Actualizar'}
            </button>
          </div>
          <p className="max-w-3xl text-base text-slate-600">
            Calculadora mensual de IGV, retenciones de IR y análisis de decisiones de compra.
          </p>
        </header>

        {/* Summary cards */}
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">
                  {card.label}
                </p>
                <div className={`${colorMap[card.color as keyof typeof colorMap].bg} p-3 rounded-lg`}>
                  <card.Icon
                    className={`w-5 h-5 ${colorMap[card.color as keyof typeof colorMap].text}`}
                  />
                </div>
              </div>
              <p className="text-slate-900 text-4xl font-bold">{formatCurrency(card.value)}</p>
              <p className="text-slate-500 text-sm mt-2">{card.hint}</p>
            </div>
          ))}
        </section>

        {/* ── P4: Cuenta de detracciones (BN) ─────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="bg-cyan-100 p-2.5 rounded-lg">
                <Landmark className="w-5 h-5 text-cyan-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Cuenta de detracciones (Banco de la Nación)
                </h2>
                <p className="text-sm text-slate-500">
                  Con este saldo pagas el IGV. Marca “detracción depositada” en cada factura de Ingresos.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Depositado (facturas marcadas)
                </p>
                <p className="text-2xl font-bold text-slate-900">
                  {formatCurrency(detraccionesDepositadas)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Pagos SUNAT desde BN
                </p>
                <div className="relative mt-0.5">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-sm">S/</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={bnSunatPaid}
                    onChange={(e) => handleBnPaidChange(e.target.value)}
                    className="w-32 rounded-lg border border-slate-300 py-1.5 pl-7 pr-2 text-lg font-semibold text-slate-900 outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Saldo estimado BN
                </p>
                <p className={`text-2xl font-bold ${bnBalance >= 0 ? 'text-cyan-700' : 'text-red-600'}`}>
                  {formatCurrency(bnBalance)}
                </p>
              </div>
            </div>
          </div>
          {pendingDetractions > 0 && (
            <p className="mt-4 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5" />
              {pendingDetractions} factura{pendingDetractions > 1 ? 's' : ''} sujeta{pendingDetractions > 1 ? 's' : ''} a detracción aún sin marcar como depositada — el saldo real puede ser mayor.
            </p>
          )}
        </section>

        {/* ── Simulador de compra ─────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-emerald-100 p-2.5 rounded-lg">
              <Calculator className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Simulador de compra</h2>
              <p className="text-sm text-slate-500">
                ¿Cuánto impacta una factura o recibo en tus impuestos de este mes?
              </p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Inputs */}
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-2">
                  Tipo de documento
                </label>
                <div className="flex gap-2">
                  {(['factura', 'recibo'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setSimType(t)}
                      className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold border transition-colors ${
                        simType === t
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {t === 'factura' ? 'Factura' : 'Recibo honorarios'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 block mb-2">
                  {simType === 'factura'
                    ? 'Monto total de la factura (incluye IGV)'
                    : 'Honorarios brutos'}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-medium text-sm">
                    S/
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={simAmount}
                    onChange={(e) => setSimAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-500 flex gap-2 items-start">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                {simType === 'factura'
                  ? 'Solo facturas generan crédito fiscal IGV (18/118 del total). Las boletas tienen límites.'
                  : 'Los recibos por honorarios no generan crédito IGV. La retención del 8% puede ser 0 si el profesional tiene suspensión.'}
              </div>
            </div>

            {/* Resultado */}
            {simValue > 0 ? (
              <div className="space-y-2">
                {simType === 'factura' ? (
                  <>
                    <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                      <span className="text-sm text-slate-600">Base imponible</span>
                      <span className="font-medium text-slate-900">{formatCurrency(simBase)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                      <span className="text-sm text-slate-600">IGV crédito fiscal</span>
                      <span className="font-semibold text-emerald-600">
                        −{formatCurrency(simIgvCredit)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                      <span className="text-sm text-slate-600">IGV por pagar actual</span>
                      <span className="font-medium text-slate-900">
                        {formatCurrency(currentIgvPayable)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                      <span className="text-sm font-semibold text-slate-800">
                        IGV por pagar nuevo
                      </span>
                      <span className="font-bold text-blue-700">
                        {formatCurrency(simNewIgvPayable)}
                      </span>
                    </div>
                    {simCreditCarryover > 0 && (
                      <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                        <span className="text-sm text-slate-600">Crédito para mes siguiente</span>
                        <span className="font-semibold text-emerald-600">
                          +{formatCurrency(simCreditCarryover)}
                        </span>
                      </div>
                    )}
                    <div
                      className={`rounded-lg p-3 text-sm font-semibold flex items-start gap-2 mt-1 ${
                        simIgvSaving > 0
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-50 text-slate-600'
                      }`}
                    >
                      <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>
                        {simIgvSaving > 0
                          ? `Ahorras ${formatCurrency(simIgvSaving)} en IGV este mes.`
                          : 'Esta compra no reduce más el IGV del mes (ya está en cero).'}
                        {simCreditCarryover > 0 &&
                          ` Además generas ${formatCurrency(simCreditCarryover)} de crédito para el próximo mes.`}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                      <span className="text-sm text-slate-600">Honorarios brutos</span>
                      <span className="font-medium text-slate-900">{formatCurrency(simValue)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                      <span className="text-sm text-slate-600">Retención IR (8%)</span>
                      <span className="font-semibold text-amber-600">
                        −{formatCurrency(simIrRetention)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                      <span className="text-sm font-semibold text-slate-800">
                        El profesional recibe
                      </span>
                      <span className="font-bold text-slate-900">
                        {formatCurrency(simNetProfessional)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                      <span className="text-sm text-slate-600">Impacto en tu IGV</span>
                      <span className="text-slate-400 text-sm italic">No aplica</span>
                    </div>
                    <div className="rounded-lg p-3 text-sm bg-amber-50 text-amber-700 flex items-start gap-2 mt-1">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      Si el profesional tiene suspensión de retenciones, la retención es S/ 0.00 y recibe el monto completo.
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-slate-200 text-slate-400 text-sm p-10">
                Ingresa un monto para ver el impacto fiscal
              </div>
            )}
          </div>
        </section>

        {/* ── Crédito acumulado + 4ta categoría ─────────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-2">

          {/* Crédito fiscal acumulado */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="bg-blue-100 p-2.5 rounded-lg">
                <TrendingDown className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Crédito fiscal {CURRENT_YEAR}
                </h2>
                <p className="text-sm text-slate-500">Balance acumulado IGV ventas vs. compras</p>
              </div>
            </div>

            {/* Totales anuales */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">
                  IGV Ventas
                </p>
                <p className="font-bold text-blue-900 text-lg">
                  {formatCurrencyShort(yearTotals.igvSales)}
                </p>
              </div>
              <div className="bg-orange-50 rounded-lg p-3 text-center">
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide mb-1">
                  IGV Compras
                </p>
                <p className="font-bold text-orange-900 text-lg">
                  {formatCurrencyShort(yearTotals.igvPurchases)}
                </p>
              </div>
              <div
                className={`rounded-lg p-3 text-center ${
                  yearTotals.netPayable <= 0 ? 'bg-emerald-50' : 'bg-purple-50'
                }`}
              >
                <p
                  className={`text-xs font-semibold uppercase tracking-wide mb-1 ${
                    yearTotals.netPayable <= 0 ? 'text-emerald-600' : 'text-purple-600'
                  }`}
                >
                  {yearTotals.netPayable <= 0 ? 'Crédito' : 'A pagar'}
                </p>
                <p
                  className={`font-bold text-lg ${
                    yearTotals.netPayable <= 0 ? 'text-emerald-900' : 'text-purple-900'
                  }`}
                >
                  {formatCurrencyShort(Math.abs(yearTotals.netPayable))}
                </p>
              </div>
            </div>

            {/* Barras por mes */}
            {yearItems.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Mes a mes
                </p>
                {[...yearItems].reverse().slice(0, 5).map((item) => {
                  const net = item.igvSales - item.igvPurchases;
                  return (
                    <div key={item.period} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">{formatPeriodShort(item.period)}</span>
                        <span
                          className={
                            net > 0 ? 'text-purple-600 font-medium' : 'text-emerald-600 font-medium'
                          }
                        >
                          {net > 0
                            ? `Paga ${formatCurrencyShort(net)}`
                            : net < 0
                            ? `Crédito ${formatCurrencyShort(-net)}`
                            : 'Neutro'}
                        </span>
                      </div>
                      <div className="flex gap-1 items-center">
                        <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-blue-400 h-2 rounded-full"
                            style={{ width: `${(item.igvSales / maxIgvBar) * 100}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex gap-1 items-center">
                        <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-orange-400 h-2 rounded-full"
                            style={{ width: `${(item.igvPurchases / maxIgvBar) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex gap-4 pt-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <div className="w-2 h-2 rounded-full bg-blue-400" /> IGV ventas
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <div className="w-2 h-2 rounded-full bg-orange-400" /> IGV compras
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-6">
                Sin datos para {CURRENT_YEAR}
              </p>
            )}
          </section>

          {/* 4ta categoría tracker */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="bg-amber-100 p-2.5 rounded-lg">
                <Users className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Honorarios {CURRENT_YEAR}
                </h2>
                <p className="text-sm text-slate-500">Renta 4ta categoría · Límite ref. SUNAT</p>
              </div>
            </div>

            {/* Stats por persona */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Profesionales
                </p>
                <p className="font-bold text-slate-900 text-xl">
                  {honorariosByProvider.length}
                </p>
              </div>
              <div className={`rounded-lg p-3 text-center ${nearLimitCount > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${nearLimitCount > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                  Cerca límite
                </p>
                <p className={`font-bold text-xl ${nearLimitCount > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                  {nearLimitCount}
                </p>
              </div>
              <div className={`rounded-lg p-3 text-center ${overLimitCount > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${overLimitCount > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                  Sobre límite
                </p>
                <p className={`font-bold text-xl ${overLimitCount > 0 ? 'text-red-700' : 'text-slate-400'}`}>
                  {overLimitCount}
                </p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4 flex gap-2 text-xs text-blue-700">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              El límite de S/ {RENTA_4TA_ANNUAL_LIMIT.toLocaleString()} aplica sobre el ingreso total del profesional (todos sus clientes). Las barras muestran solo lo pagado por esta empresa.
            </div>

            {/* Por profesional */}
            {honorariosByProvider.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Por profesional · límite ref. S/ {RENTA_4TA_ANNUAL_LIMIT.toLocaleString()}
                </p>
                {honorariosByProvider.map((p) => (
                  <div key={p.name} className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-amber-700 font-bold text-xs">
                        {getInitials(p.name)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1">
                        <div
                          className={`h-1.5 rounded-full ${
                            (p.total / RENTA_4TA_ANNUAL_LIMIT) >= 0.9
                              ? 'bg-red-400'
                              : (p.total / RENTA_4TA_ANNUAL_LIMIT) >= 0.7
                              ? 'bg-amber-400'
                              : 'bg-emerald-400'
                          }`}
                          style={{
                            width: `${Math.min(100, (p.total / RENTA_4TA_ANNUAL_LIMIT) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {formatCurrencyShort(p.total)}
                      </p>
                      {p.retentions > 0 && (
                        <p className="text-xs text-amber-600">
                          −{formatCurrencyShort(p.retentions)} ret.
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-4">
                Sin recibos por honorarios en {CURRENT_YEAR}
              </p>
            )}
          </section>
        </div>

        {/* ── Histórico mensual ─────────────────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-900">Histórico mensual</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Periodo
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">
                    IGV ventas
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">
                    IGV compras
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">
                    IGV por pagar
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Retenciones IR
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">
                      Sincronizando...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">
                      No hay registros.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => (
                    <tr key={row.period} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-6 py-4 font-semibold text-slate-900">
                        {formatPeriod(row.period)}
                      </td>
                      <td className="px-6 py-4 text-right">{formatCurrency(row.igvSales)}</td>
                      <td className="px-6 py-4 text-right">{formatCurrency(row.igvPurchases)}</td>
                      <td className="px-6 py-4 text-right font-semibold text-blue-600">
                        {formatCurrency(row.igvPayable)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {formatCurrency(row.irRetentionExpenses)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

function formatCurrencyShort(amount: number) {
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function formatPeriod(period: string) {
  const date = asLocalDate(period.slice(0, 10));
  return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(date);
}

function formatPeriodShort(period: string) {
  const date = asLocalDate(period.slice(0, 10));
  return new Intl.DateTimeFormat('es-PE', { month: 'short', year: '2-digit' }).format(date);
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return name.slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// RUC personal peruano: 10 + DNI (8 dígitos) + dígito verificador
// Normaliza ambos formatos al mismo key para deduplicar
function normalizeDocKey(doc: string | null | undefined): string | null {
  if (!doc) return null;
  const digits = doc.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('10')) {
    return digits.slice(2, 10); // extrae los 8 dígitos del DNI
  }
  return digits || null;
}
