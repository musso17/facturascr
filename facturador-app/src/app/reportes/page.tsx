'use client';

import { useMemo, useState, ReactNode } from 'react';
import { useInvoices } from '@/hooks/use-invoices';
import { useExpenses } from '@/hooks/use-expenses';
import { useManagementIncomes } from '@/hooks/use-management-incomes';
import { usePartners } from '@/hooks/use-partners';
import { asLocalDate, filterByMonth, shortenName } from '@/lib/accounting-service';
import type {
  ExpenseCategory,
  ExpenseRecord,
  InvoiceRecord,
  PartnerRecord,
} from '@/lib/accounting-types';
import {
  Archive,
  Briefcase,
  Landmark,
  Laptop,
  Megaphone,
  Package,
  Scale,
  Users,
} from 'lucide-react';

const getInitials = (name: string) => {
  if (!name) return '??';
  const parts = name.trim().split(' ');
  if (parts.length > 1) {
    return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
  }
  return (name.substring(0, 2) || '??').toUpperCase();
};

const CATEGORY_ICONS: Record<ExpenseCategory, ReactNode> = {
  servicios: <Briefcase className="w-4 h-4 text-slate-500" />,
  materiales: <Package className="w-4 h-4 text-slate-500" />,
  personal: <Users className="w-4 h-4 text-slate-500" />,
  marketing: <Megaphone className="w-4 h-4 text-slate-500" />,
  administrativos: <Archive className="w-4 h-4 text-slate-500" />,
  equipos: <Laptop className="w-4 h-4 text-slate-500" />,
  financieros: <Landmark className="w-4 h-4 text-slate-500" />,
  otros: <Briefcase className="w-4 h-4 text-slate-500" />,
};

export default function ReportesPage() {
  const { invoices } = useInvoices();
  const { expenses } = useExpenses();
  const { incomes: otherIncomes } = useManagementIncomes();
  const { partners } = usePartners();
  const [marginPeriod, setMarginPeriod] = useState('todos');

  const monthly = useMemo(() => buildMonthlyOverview(invoices, expenses), [invoices, expenses]);
  const topClients = useMemo(() => buildTopClients(invoices, partners), [invoices, partners]);
  const expensesByCategory = useMemo(() => buildExpensesByCategory(expenses), [expenses]);

  const marginMonthOptions = useMemo(() => {
    const unique = Array.from(
      new Set([
        ...invoices.map((i) => i.issueDate.slice(0, 7)),
        ...expenses.map((e) => e.issueDate.slice(0, 7)),
      ]),
    );
    return unique.sort((a, b) => (a > b ? -1 : 1)).map((value) => ({ value, label: formatMonthLabel(value) }));
  }, [invoices, expenses]);

  const clientMargins = useMemo(
    () =>
      buildClientMargins(
        filterByMonth(invoices, marginPeriod),
        filterByMonth(expenses, marginPeriod),
        filterByMonth(otherIncomes, marginPeriod),
        partners,
      ),
    [invoices, expenses, otherIncomes, partners, marginPeriod],
  );

  const unassignedExpenses = useMemo(() => {
    const scoped = filterByMonth(expenses, marginPeriod);
    return scoped.filter((e) => !e.clientId && !e.clientName).reduce((s, e) => s + e.totalAmount, 0);
  }, [expenses, marginPeriod]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex w-full flex-col gap-8 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <header className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-500">
            Reportes
          </p>
          <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">
            Análisis financiero
          </h1>
          <p className="max-w-3xl text-base text-slate-600">
            Resumen mensual de ingresos, egresos y utilidades, además de los clientes y categorías
            que más aportan al negocio.
          </p>
        </header>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Scale className="h-5 w-5 text-indigo-500" />
                Margen por cliente
              </h2>
              <p className="text-sm text-slate-500">
                Ingresos facturados − egresos atribuidos. Asigna cliente a tus egresos para afinar este reporte.
              </p>
            </div>
            <select
              value={marginPeriod}
              onChange={(e) => setMarginPeriod(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 focus:ring-2 focus:ring-blue-500"
            >
              <option value="todos">Todo el año</option>
              <option value="historico">Todo el histórico</option>
              {marginMonthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Cliente</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Facturado</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Egresos atribuidos</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Margen</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">% Margen</th>
                </tr>
              </thead>
              <tbody>
                {clientMargins.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">
                      No hay datos para el período seleccionado.
                    </td>
                  </tr>
                ) : (
                  clientMargins.map((row) => (
                    <tr key={row.key} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-6 py-4 font-semibold text-slate-900">{shortenName(row.name, 40)}</td>
                      <td className="px-6 py-4 text-right text-green-600 font-semibold">{formatCurrency(row.income)}</td>
                      <td className="px-6 py-4 text-right text-red-600 font-semibold">{formatCurrency(row.expense)}</td>
                      <td className={`px-6 py-4 text-right font-bold ${row.margin >= 0 ? 'text-slate-900' : 'text-red-700'}`}>
                        {formatCurrency(row.margin)}
                      </td>
                      <td className={`px-6 py-4 text-right font-semibold ${row.marginPct === null ? 'text-slate-400' : row.marginPct >= 0 ? 'text-slate-700' : 'text-red-600'}`}>
                        {row.marginPct === null ? '—' : `${row.marginPct.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {unassignedExpenses > 0 && (
            <p className="border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
              {formatCurrency(unassignedExpenses)} en egresos del período sin cliente asignado — no se
              reflejan en ningún margen. Asígnalos editando cada egreso.
            </p>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-900">Resumen mensual</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Mes</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Ingresos</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Egresos</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Utilidad</th>
                </tr>
              </thead>
              <tbody>
                {monthly.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-slate-500">
                      Aún no hay datos suficientes.
                    </td>
                  </tr>
                ) : (
                  monthly.map((row) => (
                    <tr key={row.key} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-6 py-4 font-semibold text-slate-900">{row.label}</td>
                      <td className="px-6 py-4 text-right font-semibold text-green-600">{formatCurrency(row.income)}</td>
                      <td className="px-6 py-4 text-right font-semibold text-red-600">
                        {formatCurrency(row.expense)}
                      </td>
                      <td
                        className={`px-6 py-4 text-right font-bold ${
                          row.profit >= 0 ? 'text-slate-800' : 'text-red-700'
                        }`}
                      >
                        {formatCurrency(row.profit)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <article className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-900">Clientes clave</h2>
              <p className="text-sm text-slate-500">Top 5 clientes por facturación.</p>
            </div>
            <ul className="text-sm">
              {topClients.length === 0 ? (
                <li className="px-6 py-4 text-center text-slate-500">Registra más facturas para ver datos.</li>
              ) : (
                topClients.map((client, index) => (
                  <li key={client.name} className={`flex items-center justify-between px-6 py-3 ${index < topClients.length -1 ? 'border-b border-slate-100' : ''}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <span className="text-blue-700 font-semibold text-sm">{getInitials(client.name)}</span>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{shortenName(client.name)}</p>
                        <p className="text-xs text-slate-500">{client.count} facturas</p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold">{formatCurrency(client.total)}</p>
                  </li>
                ))
              )}
            </ul>
          </article>
          <article className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-900">Gasto por categoría</h2>
              <p className="text-sm text-slate-500">Distribución de egresos.</p>
            </div>
            <ul className="text-sm">
              {expensesByCategory.length === 0 ? (
                <li className="px-6 py-4 text-center text-slate-500">Registra gastos para ver datos.</li>
              ) : (
                expensesByCategory.map((item, index) => (
                  <li key={item.category} className={`flex items-center justify-between px-6 py-3 ${index < expensesByCategory.length -1 ? 'border-b border-slate-100' : ''}`}>
                    <div className="flex items-center gap-3">
                      {CATEGORY_ICONS[item.category as ExpenseCategory]}
                      <span className="capitalize font-medium text-slate-800">{item.category}</span>
                    </div>
                    <span className="font-semibold">{formatCurrency(item.total)}</span>
                  </li>
                ))
              )}
            </ul>
          </article>
        </div>
      </div>
    </div>
  );
}

function buildMonthlyOverview(
  invoices: InvoiceRecord[],
  expenses: ExpenseRecord[],
) {
  const map = new Map<string, { income: number; expense: number }>();
  invoices.forEach((invoice) => {
    const key = formatMonthKey(invoice.issueDate);
    const entry = map.get(key) ?? { income: 0, expense: 0 };
    entry.income += invoice.total;
    map.set(key, entry);
  });
  expenses.forEach((expense) => {
    const key = formatMonthKey(expense.issueDate);
    const entry = map.get(key) ?? { income: 0, expense: 0 };
    entry.expense += expense.totalAmount;
    map.set(key, entry);
  });
  return Array.from(map.entries())
    .map(([key, values]) => ({
      key,
      label: formatMonthLabel(key),
      income: values.income,
      expense: values.expense,
      profit: values.income - values.expense,
    }))
    .sort((a, b) => (a.key > b.key ? -1 : 1));
}

function buildClientMargins(
  invoices: InvoiceRecord[],
  expenses: ExpenseRecord[],
  otherIncomes: { amount: number; clientId?: string | null; clientName?: string | null }[],
  partners: PartnerRecord[],
) {
  const map = new Map<string, { key: string; name: string; income: number; expense: number }>();

  const resolveInvoiceKey = (invoice: InvoiceRecord) => {
    const partner = invoice.clientId
      ? partners.find((p) => p.id === invoice.clientId)
      : partners.find((p) => p.name === invoice.client || p.tradeName === invoice.client);
    return { key: partner?.id ?? invoice.client, name: partner?.name ?? invoice.client };
  };

  invoices.forEach((invoice) => {
    const { key, name } = resolveInvoiceKey(invoice);
    const entry = map.get(key) ?? { key, name, income: 0, expense: 0 };
    entry.income += invoice.total;
    map.set(key, entry);
  });

  expenses.forEach((expense) => {
    if (!expense.clientId && !expense.clientName) return;
    const partner = expense.clientId
      ? partners.find((p) => p.id === expense.clientId)
      : partners.find((p) => p.name === expense.clientName || p.tradeName === expense.clientName);
    const key = partner?.id ?? expense.clientName ?? 'sin-cliente';
    const name = partner?.name ?? expense.clientName ?? 'Sin cliente';
    const entry = map.get(key) ?? { key, name, income: 0, expense: 0 };
    entry.expense += expense.totalAmount;
    map.set(key, entry);
  });

  // Otros ingresos (gestión) con cliente asignado suman al ingreso de ese cliente
  otherIncomes.forEach((income) => {
    if (!income.clientId && !income.clientName) return;
    const partner = income.clientId
      ? partners.find((p) => p.id === income.clientId)
      : partners.find((p) => p.name === income.clientName || p.tradeName === income.clientName);
    const key = partner?.id ?? income.clientName ?? 'sin-cliente';
    const name = partner?.name ?? income.clientName ?? 'Sin cliente';
    const entry = map.get(key) ?? { key, name, income: 0, expense: 0 };
    entry.income += income.amount;
    map.set(key, entry);
  });

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      margin: row.income - row.expense,
      marginPct: row.income > 0 ? ((row.income - row.expense) / row.income) * 100 : null,
    }))
    .sort((a, b) => b.margin - a.margin);
}

function buildTopClients(invoices: InvoiceRecord[], partners: PartnerRecord[]) {
  const map = new Map<string, { total: number; count: number; name: string }>();

  invoices.forEach((invoice) => {
    let partner = null;
    if (invoice.clientId) {
      partner = partners.find((p) => p.id === invoice.clientId);
    } else {
      partner = partners.find(
        (p) => p.name === invoice.client || p.tradeName === invoice.client,
      );
    }

    const key = partner?.id ?? invoice.client;
    const displayName = partner?.name ?? invoice.client;

    const entry = map.get(key) ?? { total: 0, count: 0, name: displayName };
    entry.total += invoice.total;
    entry.count += 1;

    map.set(key, entry);
  });

  return Array.from(map.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

function buildExpensesByCategory(
  expenses: ExpenseRecord[],
): { category: ExpenseCategory; total: number }[] {
  const map = new Map<string, number>();
  expenses.forEach((expense) => {
    const key = expense.category ?? 'otros';
    map.set(key, (map.get(key) ?? 0) + expense.totalAmount);
  });
  return Array.from(map.entries())
    .map(([category, total]) => ({ category: category as ExpenseCategory, total }))
    .sort((a, b) => b.total - a.total);
}

function formatMonthKey(value: string) {
  return asLocalDate(value).toISOString().slice(0, 7);
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, 1);
  return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(date);
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}
