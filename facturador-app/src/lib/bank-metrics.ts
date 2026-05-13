/**
 * Cerezo-specific financial metrics.
 * These go beyond generic dashboards to expose the real health of a young company.
 */

import type { InvoiceRecord, ExpenseRecord } from './accounting-types';
import type { BankTransaction, ReconciliationSummary } from './bank-types';
import { round } from './accounting-service';

// ─── Burn Rate Real ──────────────────────────────────────────────────

/**
 * Monthly burn rate based on actual bank withdrawals (not just tracked expenses).
 * Includes bank fees, ITF, commissions — the "hormiga" costs that erode margins.
 */
export function calculateRealBurnRate(
  bankTransactions: BankTransaction[],
  monthsToConsider = 6,
): {
  monthlyBurnRate: number;
  byMonth: { month: string; burn: number }[];
  hiddenCosts: number; // Untracked small expenses (< S/ 50)
} {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setMonth(now.getMonth() - monthsToConsider);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const recent = bankTransactions.filter(
    (tx) => tx.transactionDate >= cutoffStr && tx.amount < 0,
  );

  // Group by month
  const monthlyMap = new Map<string, number>();
  let hiddenCosts = 0;

  for (const tx of recent) {
    const monthKey = tx.transactionDate.slice(0, 7);
    const current = monthlyMap.get(monthKey) ?? 0;
    monthlyMap.set(monthKey, current + Math.abs(tx.amount));

    if (Math.abs(tx.amount) < 50) {
      hiddenCosts += Math.abs(tx.amount);
    }
  }

  const byMonth = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, burn]) => ({ month, burn: round(burn) }));

  const totalBurn = byMonth.reduce((sum, m) => sum + m.burn, 0);
  const monthCount = byMonth.length || 1;

  return {
    monthlyBurnRate: round(totalBurn / monthCount),
    byMonth,
    hiddenCosts: round(hiddenCosts),
  };
}

// ─── EBITDA Papel vs Caja ────────────────────────────────────────────

export interface EbitdaComparison {
  /** EBITDA "de papel": facturado - gastos registrados */
  ebitdaPapel: number;
  /** EBITDA "de caja": dinero que realmente entró - dinero que realmente salió */
  ebitdaCaja: number;
  /** The gap between paper and cash */
  gap: number;
  /** Percentage difference */
  gapPercent: number;
  /** What's causing the gap */
  gapExplanation: string;
}

export function calculateEbitdaComparison(
  invoices: InvoiceRecord[],
  expenses: ExpenseRecord[],
  bankTransactions: BankTransaction[],
): EbitdaComparison {
  // Paper EBITDA: accrual basis
  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalExpenses = expenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
  const ebitdaPapel = round(totalInvoiced - totalExpenses);

  // Cash EBITDA: what the bank actually shows
  const totalDeposits = bankTransactions
    .filter((tx) => tx.amount > 0)
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalWithdrawals = bankTransactions
    .filter((tx) => tx.amount < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const ebitdaCaja = round(totalDeposits - totalWithdrawals);

  const gap = round(ebitdaPapel - ebitdaCaja);
  const gapPercent = ebitdaPapel !== 0 ? round((gap / Math.abs(ebitdaPapel)) * 100) : 0;

  // Explain the gap
  const uncollected = invoices
    .filter((inv) => inv.balance > 0)
    .reduce((sum, inv) => sum + inv.balance, 0);
  const untrackedBankExpenses = totalWithdrawals - expenses
    .filter((exp) => exp.status === 'pagado')
    .reduce((sum, exp) => sum + exp.paidAmount, 0);

  let explanation = '';
  if (gap > 0) {
    explanation = `La empresa "gana" ${formatMoney(gap)} más en papel que en caja.`;
    if (uncollected > 0) {
      explanation += ` Hay ${formatMoney(uncollected)} en facturas pendientes de cobro.`;
    }
    if (untrackedBankExpenses > 0) {
      explanation += ` Hay ${formatMoney(round(untrackedBankExpenses))} en salidas bancarias sin factura.`;
    }
  } else if (gap < 0) {
    explanation = `La caja tiene ${formatMoney(Math.abs(gap))} más que lo esperado por papel (posibles ingresos no facturados).`;
  } else {
    explanation = 'Papel y caja coinciden. Excelente control.';
  }

  return { ebitdaPapel, ebitdaCaja, gap, gapPercent, gapExplanation: explanation };
}

// ─── Client Variable Margin ──────────────────────────────────────────

export interface ClientMargin {
  client: string;
  totalInvoiced: number;
  totalCollected: number;
  /** Bank fees/commissions allocated to this client */
  bankCosts: number;
  /** Real margin after bank costs */
  netMargin: number;
  marginPercent: number;
}

export function calculateClientMargins(
  invoices: InvoiceRecord[],
): ClientMargin[] {
  const clientMap = new Map<string, { invoiced: number; collected: number }>();

  for (const inv of invoices) {
    const key = inv.client;
    const current = clientMap.get(key) ?? { invoiced: 0, collected: 0 };
    current.invoiced += inv.total;
    current.collected += inv.paid;
    clientMap.set(key, current);
  }

  return Array.from(clientMap.entries())
    .map(([client, data]) => {
      // Estimate bank costs at ~0.3% per transfer (ITF + commissions)
      const estimatedBankCosts = round(data.collected * 0.003);
      const netMargin = round(data.collected - estimatedBankCosts);
      const marginPercent = data.invoiced > 0
        ? round((netMargin / data.invoiced) * 100)
        : 0;

      return {
        client,
        totalInvoiced: round(data.invoiced),
        totalCollected: round(data.collected),
        bankCosts: estimatedBankCosts,
        netMargin,
        marginPercent,
      };
    })
    .sort((a, b) => b.totalInvoiced - a.totalInvoiced);
}

// ─── Reconciliation Summary ──────────────────────────────────────────

export function buildReconciliationSummary(
  bankTransactions: BankTransaction[],
): ReconciliationSummary {
  let reconciledCount = 0;
  let pendingCount = 0;
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let unreconciledIncome = 0;
  let unreconciledExpenses = 0;

  for (const tx of bankTransactions) {
    if (tx.isReconciled) {
      reconciledCount++;
    } else {
      pendingCount++;
      if (tx.amount > 0) unreconciledIncome += tx.amount;
      else unreconciledExpenses += Math.abs(tx.amount);
    }

    if (tx.amount > 0) totalDeposits += tx.amount;
    else totalWithdrawals += Math.abs(tx.amount);
  }

  // Last known balance (most recent transaction)
  const sorted = [...bankTransactions].sort(
    (a, b) => b.transactionDate.localeCompare(a.transactionDate),
  );
  const lastBankBalance = sorted[0]?.balance ?? null;

  return {
    totalTransactions: bankTransactions.length,
    reconciledCount,
    pendingCount,
    totalDeposits: round(totalDeposits),
    totalWithdrawals: round(totalWithdrawals),
    lastBankBalance: lastBankBalance != null ? round(lastBankBalance) : null,
    unreconciledIncome: round(unreconciledIncome),
    unreconciledExpenses: round(unreconciledExpenses),
  };
}

// ─── Utility ─────────────────────────────────────────────────────────

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2,
  }).format(amount);
}
