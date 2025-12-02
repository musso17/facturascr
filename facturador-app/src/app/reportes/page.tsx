'use client';

import { useMemo, ReactNode } from 'react';
import { useInvoices } from '@/hooks/use-invoices';
import { useExpenses } from '@/hooks/use-expenses';
import { usePartners } from '@/hooks/use-partners';
import { asLocalDate, shortenName } from '@/lib/accounting-service';
import type {
  ExpenseCategory,
  ExpenseRecord,
  InvoiceRecord,
  PartnerRecord,
} from '@/lib/accounting-types';
import {
  Archive,
  Briefcase,
  Laptop,
  Megaphone,
  Package,
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
  otros: <Briefcase className="w-4 h-4 text-slate-500" />,
};

export default function ReportesPage() {
  const { invoices } = useInvoices();
  const { expenses } = useExpenses();
  const { partners } = usePartners();

  const monthly = useMemo(() => buildMonthlyOverview(invoices, expenses), [invoices, expenses]);
  const topClients = useMemo(() => buildTopClients(invoices, partners), [invoices, partners]);
  const expensesByCategory = useMemo(() => buildExpensesByCategory(expenses), [expenses]);

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
