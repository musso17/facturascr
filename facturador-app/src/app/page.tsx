'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  Pencil,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useInvoices } from '@/hooks/use-invoices';
import { useExpenses } from '@/hooks/use-expenses';
import { asLocalDate, summarizeInvoices, shortenName } from '@/lib/accounting-service';
import type { InvoiceRecord } from '@/lib/accounting-types';
import { FinancialReportButton } from '@/components/FinancialReportButton';

const currencyFormatter = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export default function DashboardPage() {
  const { invoices, isLoading, syncError, refresh } = useInvoices();
  const { expenses } = useExpenses();
  const [selectedMonth, setSelectedMonth] = useState('todos');
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const monthOptions = useMemo(() => buildMonthOptions(invoices), [invoices]);
  const filteredInvoices = useMemo(
    () => filterByMonth(invoices, selectedMonth),
    [invoices, selectedMonth],
  );
  const filteredExpenses = useMemo(
    () => filterByMonth(expenses, selectedMonth),
    [expenses, selectedMonth],
  );
  const totals = useMemo(() => summarizeInvoices(filteredInvoices), [filteredInvoices]);
  const expenseSummary = useMemo(
    () =>
      filteredExpenses.reduce(
        (acc, expense) => {
          acc.total += expense.totalAmount;
          acc.paid += expense.paidAmount;
          acc.pending += Math.max(expense.totalAmount - expense.paidAmount, 0);
          return acc;
        },
        { total: 0, paid: 0, pending: 0 },
      ),
    [filteredExpenses],
  );
  const overdue = useMemo(
    () => filteredInvoices.filter((invoice) => invoice.status === 'Vencido'),
    [filteredInvoices],
  );
  const dueSoon = useMemo(() => getDueSoon(filteredInvoices), [filteredInvoices]);
  const latest = useMemo(() => filteredInvoices.slice(0, 5), [filteredInvoices]);
  const monthlyStats = useMemo(() => buildMonthlyStats(invoices, expenses), [invoices, expenses]);
  const lastSixStats = useMemo(() => monthlyStats.slice(-6), [monthlyStats]);
  const hasMonthlySelection = selectedMonth !== 'todos';
  const selectedStatsIndex = hasMonthlySelection
    ? monthlyStats.findIndex((stat) => stat.key === selectedMonth)
    : -1;
  const currentStats =
    hasMonthlySelection && selectedStatsIndex >= 0 ? monthlyStats[selectedStatsIndex] : null;
  const previousStats =
    hasMonthlySelection && selectedStatsIndex > 0 ? monthlyStats[selectedStatsIndex - 1] : null;
  const chartData = useMemo(
    () =>
      lastSixStats.map((item) => ({
        name: item.shortLabel,
        ingresos: item.income,
        egresos: item.expense,
        utilidad: item.net,
        flujo: item.cashflow,
      })),
    [lastSixStats],
  );

  const metricCards = [
    {
      label: 'Facturado',
      value: totals.facturado,
      hint: 'Total emitido',
      accent: 'bg-blue-50 text-blue-600',
      delta: hasMonthlySelection ? percentChange(currentStats?.income, previousStats?.income) : null,
    },
    {
      label: 'Cobrado',
      value: totals.pagado,
      hint: 'Ingresos recibidos',
      accent: 'bg-green-50 text-green-600',
      delta: hasMonthlySelection ? percentChange(currentStats?.income, previousStats?.income) : null,
    },
    {
      label: 'Gastos',
      value: expenseSummary.total,
      hint: 'Egresos registrados',
      accent: 'bg-orange-50 text-orange-600',
      delta: hasMonthlySelection ? percentChange(currentStats?.expense, previousStats?.expense) : null,
    },
    {
      label: 'Utilidad neta',
      value: totals.pagado - expenseSummary.total,
      hint: 'Cobrado - Gastos',
      accent: 'bg-purple-50 text-purple-600',
      tooltip: 'Cobrado - Gastos',
      delta: hasMonthlySelection ? percentChange(currentStats?.net ?? 0, previousStats?.net ?? 0) : null,
    },
  ];

  const handleRefresh = async () => {
    setRefreshState('loading');
    try {
      await Promise.resolve(refresh());
      setRefreshState('success');
      setTimeout(() => setRefreshState('idle'), 1500);
    } catch {
      setRefreshState('error');
      setTimeout(() => setRefreshState('idle'), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex w-full flex-col gap-8 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <section className="space-y-8">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.5em] text-gray-400">
                Dashboard
              </p>
              <h1 className="text-3xl font-semibold leading-tight text-gray-900">
                Panorama contable general
              </h1>
              <p className="text-base font-medium leading-relaxed text-gray-600">
                Controla tus ingresos, egresos y obligaciones tributarias en un solo lugar.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
              >
                <option value="todos">Todo el año</option>
                {monthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <FinancialReportButton invoices={invoices} expenses={expenses} />
              <button
                type="button"
                onClick={handleRefresh}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${refreshState === 'error'
                  ? 'border-red-200 text-red-600'
                  : refreshState === 'success'
                    ? 'border-green-200 text-green-600'
                    : 'border-gray-200 text-gray-700 hover:-translate-y-0.5 hover:border-gray-300'
                  }`}
                disabled={refreshState === 'loading'}
              >
                {refreshState === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
                {refreshState === 'success' && <CheckCircle2 className="h-4 w-4" />}
                {refreshState === 'error' && <AlertTriangle className="h-4 w-4" />}
                {refreshState === 'loading'
                  ? 'Sincronizando...'
                  : refreshState === 'success'
                    ? 'Actualizado'
                    : refreshState === 'error'
                      ? 'Reintentar'
                      : 'Actualizar datos'}
              </button>
            </div>
          </header>

          {syncError && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {syncError}
            </p>
          )}

          <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4 animate-fade-in">
            {metricCards.map((card) => (
              <article
                key={card.label}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-md"
                title={card.tooltip}
              >
                <div className="flex items-center gap-3">
                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${card.accent}`}>
                    {card.label.slice(0, 1)}
                  </span>
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                    {card.label}
                  </p>
                </div>
                <p className="mt-3 text-3xl font-bold text-gray-900">{formatCurrencyNoDecimals(card.value)}</p>
                <p className="text-sm text-gray-500">{card.hint}</p>
                {card.delta !== null && (
                  <span
                    className={`mt-3 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${(card.delta ?? 0) >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                      }`}
                  >
                    {(card.delta ?? 0) >= 0 ? '↗' : '↘'} {formatDelta(card.delta ?? 0)}
                  </span>
                )}
                {card.label === 'Utilidad neta' && card.value < 0 && (
                  <span className="mt-3 inline-flex items-center rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                    Utilidad negativa
                  </span>
                )}
              </article>
            ))}
          </section>

          {chartData.length > 0 && (
            <section className="grid gap-6 lg:grid-cols-3 animate-fade-in">
              <ChartCard title="Ingresos vs egresos" subtitle="Últimos 6 meses">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="name" stroke="#9CA3AF" />
                      <YAxis stroke="#9CA3AF" tickFormatter={(value) => `${value / 1000}k`} />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, borderColor: '#E5E7EB' }}
                        formatter={(value) => formatCurrency(value as number)}
                      />
                      <Legend />
                      <Bar dataKey="ingresos" fill="#2563EB" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="egresos" fill="#F97316" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
              <ChartCard title="Utilidad neta" subtitle="Evolución por mes">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="name" stroke="#9CA3AF" />
                      <YAxis stroke="#9CA3AF" tickFormatter={(value) => `${value / 1000}k`} />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, borderColor: '#E5E7EB' }}
                        formatter={(value) => formatCurrency(value as number)}
                      />
                      <Line
                        type="monotone"
                        dataKey="utilidad"
                        stroke="#2563EB"
                        strokeWidth={3}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-xs text-gray-500">
                  Promedio: {formatCurrency(averageNet(lastSixStats))}
                </div>
              </ChartCard>
              <ChartCard title="Flujo de caja" subtitle="Acumulado">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ left: -20 }}>
                      <defs>
                        <linearGradient id="cashArea" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#10B981" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="name" stroke="#9CA3AF" />
                      <YAxis stroke="#9CA3AF" tickFormatter={(value) => `${value / 1000}k`} />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, borderColor: '#E5E7EB' }}
                        formatter={(value) => formatCurrency(value as number)}
                      />
                      <Area
                        type="monotone"
                        dataKey="flujo"
                        stroke="#10B981"
                        strokeWidth={3}
                        fill="url(#cashArea)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-xs text-gray-500">
                  Último saldo: {formatCurrency(lastSixStats.at(-1)?.cashflow ?? 0)}
                </div>
              </ChartCard>
            </section>
          )}

          <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] animate-fade-in">
            <article className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-widest text-gray-400">Actividad reciente</p>
                  <h2 className="text-lg font-semibold text-gray-900">Últimos movimientos</h2>
                </div>
                <Link
                  href="/ingresos"
                  className="text-sm font-medium text-blue-600 underline-offset-4 hover:underline"
                >
                  Ver ingresos
                </Link>
              </div>
              {isLoading ? (
                <p className="mt-6 text-sm text-gray-500">Sincronizando con Supabase...</p>
              ) : latest.length === 0 ? (
                <p className="mt-6 text-sm text-gray-500">No hay facturas registradas.</p>
              ) : (
                <div className="relative mt-8 pl-4">
                  <span className="absolute left-12 top-0 h-full w-px bg-gradient-to-b from-blue-200 via-gray-200 to-transparent" />
                  <ul className="space-y-5">
                    {latest.map((invoice, index) => (
                      <li
                        key={invoice.recordId}
                        className="group relative flex gap-5 rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                      >
                        {index !== latest.length - 1 && (
                          <span className="absolute left-12 top-16 h-[calc(100%-3rem)] w-px bg-gray-200" />
                        )}
                        <div className="absolute left-0 top-5 flex flex-col items-center gap-2">
                          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white text-sm font-semibold text-gray-700 shadow-sm">
                            {getInitials(invoice.client)}
                          </span>
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-blue-600 shadow-sm">
                            <FileText className="h-3.5 w-3.5" />
                          </span>
                        </div>
                        <div className="ml-16 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{invoice.id}</p>
                              <p className="text-xs text-gray-500">
                                {formatDate(invoice.issueDate)} · {shortenName(invoice.client)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xl font-semibold text-gray-900">
                                {formatCurrency(invoice.total)}
                              </p>
                              <StatusBadge status={invoice.status} />
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5">
                              Factura · {invoice.client}
                            </span>
                          </div>
                          <div className="mt-4 flex flex-wrap items-center gap-2 opacity-0 transition-all duration-200 group-hover:opacity-100">
                            <ActionButton icon={<Eye className="h-3.5 w-3.5" />} label="Ver" />
                            <ActionButton icon={<Pencil className="h-3.5 w-3.5" />} label="Editar" />
                            <ActionButton icon={<Bell className="h-3.5 w-3.5" />} label="Recordatorio" />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>

            <div className="space-y-6">
              <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-xs uppercase tracking-widest text-gray-400">Alertas</p>
                <div className="mt-4 space-y-3">
                  <AlertCard
                    title="Facturas vencidas"
                    count={overdue.length}
                    invoices={overdue.slice(0, 3)}
                    palette="red"
                  />
                  <AlertCard
                    title="Próximos vencimientos"
                    count={dueSoon.length}
                    invoices={dueSoon.slice(0, 3)}
                    palette="yellow"
                  />
                </div>
              </article>

              <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-xs uppercase tracking-widest text-gray-400">Pagos por realizar</p>
                <h3 className="mt-3 text-2xl font-bold text-gray-900">
                  {formatCurrency(expenseSummary.pending)}
                </h3>
                <p className="text-sm text-gray-500">Pendiente en egresos</p>
                <div className="mt-4 border-t border-gray-100 pt-4 text-sm text-gray-600">
                  Pagado:{' '}
                  <span className="font-semibold text-gray-900">
                    {formatCurrency(expenseSummary.paid)}
                  </span>
                </div>
                <Link
                  href="/egresos"
                  className="mt-4 inline-flex items-center text-sm font-medium text-blue-600 underline-offset-4 hover:underline"
                >
                  Ir a egresos
                </Link>
              </article>
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}

function AlertCard({
  title,
  count,
  invoices,
  palette,
}: {
  title: string;
  count: number;
  invoices: InvoiceRecord[];
  palette: 'red' | 'yellow';
}) {
  const styles =
    palette === 'red'
      ? 'bg-red-50 border-red-100 text-red-700'
      : 'bg-yellow-50 border-yellow-100 text-yellow-700';

  return (
    <div className={`rounded-xl border ${styles} p-4`}>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-3xl font-semibold">{count}</p>
      {invoices.length === 0 ? (
        <div className="mt-3 flex flex-col items-center rounded-lg bg-white/70 p-4 text-center">
          <CheckCircle2 className="h-7 w-7 text-green-500" />
          <p className="mt-2 text-sm font-semibold text-gray-700">¡Todo en orden! 🎉</p>
          <p className="text-xs text-gray-500">No hay alertas activas en este momento.</p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2 text-sm text-gray-700">
          {invoices.map((invoice) => (
            <li key={invoice.recordId} className="flex justify-between">
              <span>{invoice.id}</span>
              <span className="font-medium">{formatDate(invoice.dueDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionButton({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-900"
    >
      {icon}
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'Pagado') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
        <CheckCircle2 className="h-3 w-3" />
        Pagado
      </span>
    );
  }
  if (status === 'Vencido') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
        <AlertTriangle className="h-3 w-3" />
        Vencido
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
      <span className="relative flex h-2 w-2 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      Pendiente
    </span>
  );
}

function getInitials(value: string) {
  if (!value) return 'C';
  const [first = '', second = ''] = value.trim().split(' ');
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || first.charAt(0).toUpperCase();
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs uppercase tracking-widest text-gray-400">{title}</p>
      <h3 className="text-base font-medium text-gray-600">{subtitle}</h3>
      <div className="mt-4">{children}</div>
    </article>
  );
}

type MonthlyPoint = {
  key: string;
  label: string;
  shortLabel: string;
  income: number;
  expense: number;
  net: number;
  cashflow: number;
};

function averageNet(stats: MonthlyPoint[]) {
  if (!stats.length) return 0;
  return stats.reduce((sum, item) => sum + item.net, 0) / stats.length;
}

function buildMonthlyStats(
  invoices: { issueDate: string; total: number }[],
  expenses: { issueDate: string; totalAmount: number }[],
): MonthlyPoint[] {
  const map = new Map<string, { income: number; expense: number }>();
  invoices.forEach((invoice) => {
    const key = formatMonthKey(invoice.issueDate);
    const stored = map.get(key) ?? { income: 0, expense: 0 };
    stored.income += invoice.total;
    map.set(key, stored);
  });
  expenses.forEach((expense) => {
    const key = formatMonthKey(expense.issueDate);
    const stored = map.get(key) ?? { income: 0, expense: 0 };
    stored.expense += expense.totalAmount;
    map.set(key, stored);
  });
  let cashflow = 0;
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => {
      const net = value.income - value.expense;
      cashflow += net;
      return {
        key,
        label: formatMonthLabel(key),
        shortLabel: formatMonthShortLabel(key),
        income: value.income,
        expense: value.expense,
        net,
        cashflow,
      };
    });
}

function percentChange(current?: number | null, previous?: number | null) {
  if (
    current === undefined ||
    current === null ||
    previous === undefined ||
    previous === null ||
    Math.abs(previous) < 0.001
  ) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

function formatDelta(delta: number) {
  const prefix = delta >= 0 ? '+' : '−';
  return `${prefix}${Math.abs(delta).toFixed(1)}% vs mes anterior`;
}

function formatMonthShortLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, 1);
  return new Intl.DateTimeFormat('es-PE', { month: 'short' }).format(date);
}

function getDueSoon(invoices: InvoiceRecord[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today);
  limit.setDate(limit.getDate() + 7);
  return invoices.filter((invoice) => {
    if (invoice.status === 'Pagado') return false;
    const due = asLocalDate(invoice.dueDate);
    return due >= today && due <= limit;
  });
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value || 0);
}

function formatCurrencyNoDecimals(value: number) {
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value: string) {
  return dateFormatter.format(asLocalDate(value));
}

function buildMonthOptions(list: { issueDate: string }[]) {
  const unique = Array.from(new Set(list.map((item) => formatMonthKey(item.issueDate))));
  return unique
    .sort((a, b) => (a > b ? -1 : 1))
    .map((value) => ({ value, label: formatMonthLabel(value) }));
}

function filterByMonth<T extends { issueDate: string }>(list: T[], month: string) {
  if (month === 'todos') return list;
  return list.filter((item) => formatMonthKey(item.issueDate) === month);
}

function formatMonthKey(value: string) {
  return asLocalDate(value).toISOString().slice(0, 7);
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, 1);
  return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(date);
}
