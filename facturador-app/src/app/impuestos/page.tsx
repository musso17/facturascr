'use client';

import { useTaxSummary } from '@/hooks/use-tax-summary';
import { asLocalDate } from '@/lib/accounting-service';
import {
  FileDown,
  Landmark,
  ShoppingCart,
  TrendingUp,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';

export default function ImpuestosPage() {
  const { items, currentMonth, isLoading, refresh } = useTaxSummary();

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
      hint: 'IGV ventas - IGV compras',
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
    green: { bg: 'bg-green-100', text: 'text-green-600' },
    orange: { bg: 'bg-orange-100', text: 'text-orange-600' },
    purple: { bg: 'bg-purple-100', text: 'text-purple-600' },
    red: { bg: 'bg-red-100', text: 'text-red-600' },
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex w-full flex-col gap-8 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <header className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-500">
            Impuestos
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">
              Obligaciones SUNAT
            </h1>
            <button
              type="button"
              onClick={refresh}
              className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg font-medium"
              disabled={isLoading}
            >
              {isLoading ? 'Actualizando...' : 'Actualizar'}
            </button>
          </div>
          <p className="max-w-3xl text-base text-slate-600">
            Calculadora mensual de IGV, retenciones de IR y pagos informativos (ITF).
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">{card.label}</p>
                </div>
                <div className={`${colorMap[card.color as keyof typeof colorMap].bg} p-3 rounded-lg`}>
                  <card.Icon className={`w-5 h-5 ${colorMap[card.color as keyof typeof colorMap].text}`} />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-slate-900 text-4xl font-bold">{formatCurrency(card.value)}</p>
                <p className="text-slate-500 text-sm">{card.hint}</p>
              </div>
            </div>
          ))}
        </section>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-900">Histórico mensual</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Periodo</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">IGV ventas</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">IGV compras</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">IGV por pagar</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Retenciones IR</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">
                      Sincronizando con Supabase...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">
                      No hay registros en la vista mensual.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => (
                    <tr key={row.period} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-6 py-4 font-semibold text-slate-900">{formatPeriod(row.period)}</td>
                      <td className="px-6 py-4 text-right">{formatCurrency(row.igvSales)}</td>
                      <td className="px-6 py-4 text-right">{formatCurrency(row.igvPurchases)}</td>
                      <td className="px-6 py-4 text-right font-semibold text-blue-600">
                        {formatCurrency(row.igvPayable)}
                      </td>
                      <td className="px-6 py-4 text-right">{formatCurrency(row.irRetentionExpenses)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-slate-900">Checklist de Obligaciones</h2>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div className="flex items-start gap-4">
              <CheckCircle className="w-5 h-5 text-green-500 mt-1 flex-shrink-0" />
              <div>
                <p className="font-semibold text-slate-800">Declaración mensual de IGV</p>
                <p className="text-sm text-slate-600">
                  Usa el resumen para preparar tu PDT 621 o enviar a tu contador.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <AlertCircle className="w-5 h-5 text-amber-500 mt-1 flex-shrink-0" />
              <div>
                <p className="font-semibold text-slate-800">Retenciones IR (Renta)</p>
                <p className="text-sm text-slate-600">
                  Registra las retenciones de tus recibos por honorarios y aplícalas al pago a cuenta mensual.
                </p>
              </div>
            </div>
          </div>
        </section>
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

function formatPeriod(period: string) {
  const normalized = period.slice(0, 10);
  const date = asLocalDate(normalized);
  return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(date);
}
