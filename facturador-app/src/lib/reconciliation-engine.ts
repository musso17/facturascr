/**
 * Reconciliation Engine
 *
 * Three-pass matching algorithm:
 * 1. Exact Match (1:1) — same amount within ±3 days
 * 2. Sum Match (N:1)  — sum of oldest unpaid invoices for a client
 * 3. Partial Match    — partial coverage
 */

import type { InvoiceRecord, ExpenseRecord } from './accounting-types';
import type { BankTransaction, ReconciliationCandidate, ReconciliationAllocation } from './bank-types';
import { calcDetraction } from './detraction';

const TOLERANCE_AMOUNT = 30; // S/ tolerance for bank fees
const TOLERANCE_DAYS = 5; // days tolerance for date matching

// ─── Main Entry Point ────────────────────────────────────────────────

/**
 * Generate reconciliation suggestions for a single bank transaction.
 */
export function findReconciliationCandidates(
  bankTx: BankTransaction,
  invoices: InvoiceRecord[],
  expenses: ExpenseRecord[],
): ReconciliationCandidate[] {
  const candidates: ReconciliationCandidate[] = [];
  const isIncome = bankTx.amount > 0;
  const absAmount = Math.abs(bankTx.amount);

  if (isIncome) {
    // Match against unpaid invoices
    const unpaid = invoices.filter((inv) => inv.balance > 0);

    // Pass 1: Exact match
    const exactMatches = findExactInvoiceMatch(bankTx, unpaid, absAmount);
    candidates.push(...exactMatches);

    // Pass 2: Sum match (N:1)
    const sumMatches = findSumInvoiceMatch(bankTx, unpaid, absAmount);
    candidates.push(...sumMatches);

    // Pass 3: Partial match
    if (candidates.length === 0) {
      const partialMatches = findPartialInvoiceMatches(bankTx, unpaid, absAmount);
      candidates.push(...partialMatches);
    }
  } else {
    // Match against unpaid expenses
    const unpaidExpenses = expenses.filter(
      (exp) => exp.status !== 'pagado' && exp.totalAmount - exp.paidAmount > 0,
    );

    // Pass 1: Exact match
    const exactMatch = findExactExpenseMatch(bankTx, unpaidExpenses, absAmount);
    if (exactMatch) candidates.push(exactMatch);

    // Pass 2: Sum match for expenses (less common but possible)
    const sumMatches = findSumExpenseMatch(bankTx, unpaidExpenses, absAmount);
    candidates.push(...sumMatches);
  }

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);

  return candidates;
}

// ─── Pass 1: Exact Match ─────────────────────────────────────────────

function findExactInvoiceMatch(
  bankTx: BankTransaction,
  unpaid: InvoiceRecord[],
  absAmount: number,
): ReconciliationCandidate[] {
  const matches: ReconciliationCandidate[] = [];
  const txDesc = bankTx.description.toLowerCase();

  for (const inv of unpaid) {
    const det = calcDetraction(inv.balance);
    const dateClose = isDateClose(bankTx.transactionDate, inv.dueDate) ||
                      isDateClose(bankTx.transactionDate, inv.issueDate);
    
    // Fuzzy matching
    const nameMatch = inv.client.toLowerCase().split(' ').some(w => w.length > 3 && txDesc.includes(w));
    const baseConfidence = (dateClose ? 0.85 : 0.75) + (nameMatch ? 0.1 : 0);

    // --- Check 1: exact full balance match ---
    const diffFull = Math.abs(inv.balance - absAmount);
    if (diffFull === 0) {
      matches.push({
        matchType: 'exact',
        confidence: Math.min(baseConfidence + 0.1, 0.99),
        allocations: [{ invoiceId: inv.recordId, appliedAmount: inv.balance, label: `${inv.id} · ${inv.client}` }],
        residual: 0,
        explanation: `Coincidencia exacta: ${inv.id} por ${formatMoney(inv.balance)}` + (nameMatch ? ' (cliente coincide)' : ''),
      });
      continue;
    }

    // --- Check 2: net-of-detraction match (88% of invoice) ---
    if (det.applies) {
      const diffNet = Math.abs(det.netAmount - absAmount);
      if (diffNet === 0) {
        matches.push({
          matchType: 'exact',
          confidence: Math.min(baseConfidence + 0.07, 0.98),
          allocations: [{ invoiceId: inv.recordId, appliedAmount: det.netAmount, label: `${inv.id} · ${inv.client}` }],
          residual: 0,
          explanation: `${inv.id} por ${formatMoney(inv.balance)} con detracción: depósito neto ${formatMoney(det.netAmount)} (88%) · BN ${formatMoney(det.detractionAmount)} (12%)` + (nameMatch ? ' (cliente coincide)' : ''),
        });
        continue;
      }
      // Within tolerance of net amount
      if (diffNet <= TOLERANCE_AMOUNT && diffNet > 0) {
        matches.push({
          matchType: 'exact',
          confidence: Math.min(baseConfidence - 0.07, 0.90),
          allocations: [{ invoiceId: inv.recordId, appliedAmount: det.netAmount, label: `${inv.id} · ${inv.client}` }],
          residual: absAmount - det.netAmount,
          explanation: `${inv.id} con detracción (≈88%): ${formatMoney(det.netAmount)} neto, diferencia ${formatMoney(diffNet)} posible comisión` + (nameMatch ? ' (cliente coincide)' : ''),
        });
        continue;
      }
    }

    // --- Check 3: within tolerance of full balance ---
    if (diffFull <= TOLERANCE_AMOUNT && diffFull > 0) {
      const residual = absAmount - inv.balance;
      matches.push({
        matchType: 'exact',
        confidence: Math.min(baseConfidence - 0.05, 0.90),
        allocations: [{ invoiceId: inv.recordId, appliedAmount: inv.balance, label: `${inv.id} · ${inv.client}` }],
        residual,
        explanation: `Coincidencia aproximada: ${inv.id} por ${formatMoney(inv.balance)} (diferencia: ${formatMoney(Math.abs(residual))}, posible comisión)` + (nameMatch ? ' (cliente coincide)' : ''),
      });
      continue;
    }
  }
  return matches;
}


function findExactExpenseMatch(
  bankTx: BankTransaction,
  unpaidExpenses: ExpenseRecord[],
  absAmount: number,
): ReconciliationCandidate | null {
  for (const exp of unpaidExpenses) {
    const pending = exp.totalAmount - exp.paidAmount;
    const diff = Math.abs(pending - absAmount);

    if (diff === 0) {
      return {
        matchType: 'exact',
        confidence: 0.90,
        allocations: [{
          expenseId: exp.id,
          appliedAmount: pending,
          label: `${exp.documentNumber} · ${exp.providerName}`,
        }],
        residual: 0,
        explanation: `Egreso exacto: ${exp.documentNumber} por ${formatMoney(pending)}`,
      };
    }

    if (diff <= TOLERANCE_AMOUNT && diff > 0) {
      return {
        matchType: 'exact',
        confidence: 0.75,
        allocations: [{
          expenseId: exp.id,
          appliedAmount: pending,
          label: `${exp.documentNumber} · ${exp.providerName}`,
        }],
        residual: absAmount - pending,
        explanation: `Egreso aproximado: ${exp.documentNumber} (diferencia: ${formatMoney(diff)})`,
      };
    }
  }
  return null;
}

// ─── Pass 2: Sum Match (N:1) ─────────────────────────────────────────

function findSumInvoiceMatch(
  bankTx: BankTransaction,
  unpaid: InvoiceRecord[],
  absAmount: number,
): ReconciliationCandidate[] {
  const candidates: ReconciliationCandidate[] = [];

  // Group invoices by client
  const byClient = new Map<string, InvoiceRecord[]>();
  for (const inv of unpaid) {
    const key = inv.clientId || inv.client;
    const list = byClient.get(key) ?? [];
    list.push(inv);
    byClient.set(key, list);
  }

  for (const [clientKey, clientInvoices] of byClient) {
    if (clientInvoices.length < 2) continue;

    // Sort oldest first
    const sorted = [...clientInvoices].sort(
      (a, b) => a.issueDate.localeCompare(b.issueDate),
    );

    // Try cumulative sum
    let runningSum = 0;
    const allocations: ReconciliationAllocation[] = [];

    for (const inv of sorted) {
      runningSum += inv.balance;
      allocations.push({
        invoiceId: inv.recordId,
        appliedAmount: inv.balance,
        label: `${inv.id} · ${inv.client}`,
      });

      const diff = Math.abs(runningSum - absAmount);

      if (diff === 0) {
        candidates.push({
          matchType: 'sum',
          confidence: 0.85,
          allocations: [...allocations],
          residual: 0,
          explanation: `Pago agrupado de ${allocations.length} facturas de ${clientInvoices[0]?.client ?? clientKey}: ${allocations.map((a) => a.label.split(' · ')[0]).join(' + ')} = ${formatMoney(runningSum)}`,
        });
        break;
      }

      if (diff <= TOLERANCE_AMOUNT) {
        candidates.push({
          matchType: 'sum',
          confidence: 0.75,
          allocations: [...allocations],
          residual: absAmount - runningSum,
          explanation: `Pago agrupado aproximado de ${allocations.length} facturas de ${clientInvoices[0]?.client ?? clientKey} (diferencia: ${formatMoney(diff)}, posible comisión)`,
        });
        break;
      }

      // If we've gone past the target, stop
      if (runningSum > absAmount + TOLERANCE_AMOUNT) break;
    }
  }

  return candidates;
}

function findSumExpenseMatch(
  _bankTx: BankTransaction,
  unpaidExpenses: ExpenseRecord[],
  absAmount: number,
): ReconciliationCandidate[] {
  const candidates: ReconciliationCandidate[] = [];

  // Group expenses by provider
  const byProvider = new Map<string, ExpenseRecord[]>();
  for (const exp of unpaidExpenses) {
    const key = exp.providerName;
    const list = byProvider.get(key) ?? [];
    list.push(exp);
    byProvider.set(key, list);
  }

  for (const [providerName, providerExpenses] of byProvider) {
    if (providerExpenses.length < 2) continue;

    const sorted = [...providerExpenses].sort(
      (a, b) => a.issueDate.localeCompare(b.issueDate),
    );

    let runningSum = 0;
    const allocations: ReconciliationAllocation[] = [];

    for (const exp of sorted) {
      const pending = exp.totalAmount - exp.paidAmount;
      runningSum += pending;
      allocations.push({
        expenseId: exp.id,
        appliedAmount: pending,
        label: `${exp.documentNumber} · ${exp.providerName}`,
      });

      const diff = Math.abs(runningSum - absAmount);

      if (diff <= TOLERANCE_AMOUNT) {
        candidates.push({
          matchType: 'sum',
          confidence: diff === 0 ? 0.80 : 0.70,
          allocations: [...allocations],
          residual: absAmount - runningSum,
          explanation: `Pago agrupado de ${allocations.length} egresos de ${providerName}`,
        });
        break;
      }

      if (runningSum > absAmount + TOLERANCE_AMOUNT) break;
    }
  }

  return candidates;
}

// ─── Pass 3: Partial Match ───────────────────────────────────────────

function findPartialInvoiceMatches(
  bankTx: BankTransaction,
  unpaid: InvoiceRecord[],
  absAmount: number,
): ReconciliationCandidate[] {
  const candidates: ReconciliationCandidate[] = [];

  // Find invoices where the deposit is less than the balance (partial payment)
  for (const inv of unpaid) {
    if (absAmount < inv.balance && absAmount >= inv.balance * 0.1) {
      // At least 10% of the invoice
      const dateClose = isDateClose(bankTx.transactionDate, inv.dueDate);
      candidates.push({
        matchType: 'partial',
        confidence: dateClose ? 0.60 : 0.45,
        allocations: [{
          invoiceId: inv.recordId,
          appliedAmount: absAmount,
          label: `${inv.id} · ${inv.client} (pago parcial)`,
        }],
        residual: 0,
        explanation: `Pago parcial de ${inv.id}: ${formatMoney(absAmount)} de ${formatMoney(inv.balance)}`,
      });
    }
  }

  return candidates.slice(0, 3); // Limit to top 3
}

// ─── Utilities ───────────────────────────────────────────────────────

function isDateClose(dateA: string, dateB: string): boolean {
  try {
    const a = new Date(dateA + 'T00:00:00');
    const b = new Date(dateB + 'T00:00:00');
    const diffMs = Math.abs(a.getTime() - b.getTime());
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= TOLERANCE_DAYS;
  } catch {
    return false;
  }
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2,
  }).format(amount);
}
