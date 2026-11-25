'use client';

import Link from 'next/link';
import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  CheckCircle,
  ChevronDown,
  Landmark,
  Link2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { DetractionStatus, ExpenseRecord, InvoiceRecord } from '@/lib/accounting-types';
import { asLocalDate, shortenName } from '@/lib/accounting-service';
import { calcDetraction } from '@/lib/detraction';
import { getCollectionBreakdown, round2 } from '@/lib/collection';
import { findPartner, normalizeText, type MatchSuggestion } from '@/lib/collection-matching';
import {
  classifyBankCharge,
  isBankCostExpense,
  netPayable,
  reviewStatement,
  type BankChargeKind,
  type CreditReview,
  type DebitReview,
} from '@/lib/statement-review';
import type { BankStatementSummary, BankTransaction } from '@/lib/bank-types';
import { useBankTransactions } from '@/hooks/use-bank-transactions';
import { useInvoices } from '@/hooks/use-invoices';
import { useExpenses } from '@/hooks/use-expenses';
import { usePartners } from '@/hooks/use-partners';
import { useManagementIncomes } from '@/hooks/use-management-incomes';
import {
  DEFAULT_ACCOUNT,
  accountOfTransaction,
  bankOf,
  sameAccount,
  suggestAccountName,
} from '@/lib/bank-accounts';

const money = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 });
const fmt = (value: number) => money.format(value || 0);
const dateFmt = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = (value: string | null | undefined) => (value ? dateFmt.format(asLocalDate(value)) : '—');
const monthFmt = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' });
const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  const label = monthFmt.format(new Date(y, (m ?? 1) - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
};

// Destinos de cobro que no tienen extracto importable
const OFF_STATEMENT_ACCOUNTS = ['Banco de la Nación (detracciones)', 'Otra cuenta', 'Efectivo / caja'];
const CUSTOM_ACCOUNTS_KEY = 'facturador.cuentasBancarias';
const NEW_ACCOUNT = '__nueva__';

function loadCustomAccounts(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_ACCOUNTS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function saveCustomAccounts(list: string[]) {
  try {
    localStorage.setItem(CUSTOM_ACCOUNTS_KEY, JSON.stringify(list));
  } catch {
    // sin almacenamiento local: la cuenta igual queda registrada al importar su extracto
  }
}
const CHARGE_LABEL: Record<BankChargeKind, string> = {
  comision: 'Comisión bancaria',
  mantenimiento: 'Mantenimiento de cuenta',
  itf: 'ITF',
  impuesto: 'Pago SUNAT',
};
const CREDIT_NOT_INCOME = ['Transferencia entre cuentas', 'Aporte de socios', 'Préstamo recibido', 'Devolución', 'Otro'];
const DEBIT_NOT_EXPENSE = ['Transferencia entre cuentas', 'Retiro / pago a socios', 'Préstamo', 'Pago de planilla', 'Otro'];
const BULK_MIN_SCORE = 0.85;

type ImportInfo = {
  account: string;
  fileName: string;
  bankName: string | null;
  inserted: number;
  duplicates: number;
  credits: number;
  debits: number;
  statement?: BankStatementSummary;
  warnings: string[];
};

type AliasPrompt = { invoice: InvoiceRecord; clientName: string; partnerId?: string; text: string };

export default function ConciliacionPage() {
  const {
    transactions,
    isLoading,
    syncError,
    importFromFile,
    reconcileCredit,
    reconciledInvoiceIds,
    reconciledExpenseIds,
    links,
    reconciliationsLoaded,
    reconciliationsError,
    categorizeTransaction,
    categorizeMany,
  } = useBankTransactions();
  const {
    invoices,
    registerCollection,
    updateCollectionInfo,
    setPaymentAccount,
    revertPayment,
    collectionColumns,
  } = useInvoices();
  const { expenses, updateExpense, revertExpensePayment } = useExpenses();
  const { partners, updatePartnerCollection, createClientPartner, collectionColumns: partnerColumns } = usePartners();
  const { insertIncome, tableMissing: incomesTableMissing } = useManagementIncomes();

  const [account, setAccount] = useState<string>(DEFAULT_ACCOUNT);
  // Cuentas registradas a mano (antes de importar su primer extracto)
  const [customAccounts, setCustomAccounts] = useState<string[]>([]);
  useEffect(() => {
    const handle = setTimeout(() => setCustomAccounts(loadCustomAccounts()), 0);
    return () => clearTimeout(handle);
  }, []);
  const [month, setMonth] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importInfo, setImportInfo] = useState<ImportInfo | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [aliasPrompt, setAliasPrompt] = useState<AliasPrompt | null>(null);
  const [manualTxId, setManualTxId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  // Abonos para los que ya se creó un "otro ingreso" en esta sesión (evita duplicarlo si falla el paso siguiente)
  const [incomeCreatedFor, setIncomeCreatedFor] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Mientras se guarda algo, ninguna otra acción: evita dobles clics y escrituras cruzadas
  const locked = busy !== null || !reconciliationsLoaded;

  const invoiceById = useMemo(() => new Map(invoices.map((inv) => [inv.recordId, inv])), [invoices]);
  const expenseById = useMemo(() => new Map(expenses.map((exp) => [exp.id, exp])), [expenses]);

  // Una cuenta existe por sus movimientos importados, o porque se registró a mano
  const accounts = useMemo(() => {
    const list = [DEFAULT_ACCOUNT];
    for (const name of [...transactions.map((tx) => accountOfTransaction(tx.accountName)), ...customAccounts]) {
      if (!list.includes(name)) list.push(name);
    }
    return list;
  }, [transactions, customAccounts]);

  const registerAccount = (name: string) => {
    const clean = name.trim();
    if (!clean) return null;
    const existing = accounts.find((item) => sameAccount(item, clean) && item.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    const next = [...customAccounts.filter((item) => item !== clean), clean];
    setCustomAccounts(next);
    saveCustomAccounts(next);
    return clean;
  };

  const handleAccountChange = (value: string) => {
    if (value !== NEW_ACCOUNT) {
      setAccount(value);
      return;
    }
    const name = window.prompt('Nombre de la cuenta (banco, tipo y últimos 4 dígitos):', 'Interbank cuenta corriente ···0000');
    const registered = name ? registerAccount(name) : null;
    if (registered) setAccount(registered);
  };

  const transactionsByAccount = useMemo(() => {
    const map = new Map<string, BankTransaction[]>();
    for (const tx of transactions) {
      const name = accountOfTransaction(tx.accountName);
      map.set(name, [...(map.get(name) ?? []), tx]);
    }
    return map;
  }, [transactions]);
  const accountTxs = useMemo(() => transactionsByAccount.get(account) ?? [], [transactionsByAccount, account]);

  const months = useMemo(
    () => Array.from(new Set(accountTxs.map((tx) => tx.transactionDate.slice(0, 7)))).sort().reverse(),
    [accountTxs],
  );
  const activeMonth = month && months.includes(month) ? month : (months[0] ?? null);

  // La revisión usa todo lo importado de la cuenta (un cobro de octubre puede saldar una factura de setiembre)
  const review = useMemo(
    () =>
      reviewStatement({
        transactions: accountTxs,
        invoices,
        expenses,
        partners,
        reconciledInvoiceIds,
        reconciledExpenseIds,
        linkedTxIds: new Set(links.keys()),
        statementAccount: account,
      }),
    [accountTxs, invoices, expenses, partners, reconciledInvoiceIds, reconciledExpenseIds, links, account],
  );

  // Lo que explica un movimiento de OTRA cuenta no está "sin movimiento" en esta
  const claimedElsewhere = useMemo(() => {
    const invoiceIds = new Set<string>();
    const expenseIds = new Set<string>();
    for (const [name, txs] of transactionsByAccount) {
      if (name === account) continue;
      const other = reviewStatement({
        transactions: txs,
        invoices,
        expenses,
        partners,
        reconciledInvoiceIds,
        reconciledExpenseIds,
        linkedTxIds: new Set(links.keys()),
        statementAccount: name,
      });
      other.claimedInvoiceIds.forEach((id) => invoiceIds.add(id));
      other.claimedExpenseIds.forEach((id) => expenseIds.add(id));
    }
    return { invoiceIds, expenseIds };
  }, [transactionsByAccount, account, invoices, expenses, partners, reconciledInvoiceIds, reconciledExpenseIds, links]);

  const inMonth = (date: string | null | undefined) => !activeMonth || (date ?? '').startsWith(activeMonth);
  const credits = review.credits.filter((c) => inMonth(c.tx.transactionDate));
  const debits = review.debits.filter((d) => inMonth(d.tx.transactionDate));
  const by = <T extends { status: string }>(list: T[], ...statuses: string[]) =>
    list.filter((item) => statuses.includes(item.status));

  const unregisteredCollections = by(credits, 'cobro_no_registrado');
  const unknownCredits = by(credits, 'sin_factura');
  const unregisteredPayments = by(debits, 'pago_no_registrado');
  const unknownDebits = by(debits, 'sin_comprobante');
  const toLink = [...by(credits, 'registrado_sin_vincular'), ...by(debits, 'registrado_sin_vincular')].sort((a, b) =>
    a.tx.transactionDate.localeCompare(b.tx.transactionDate),
  );
  const bankCharges = debits.filter(
    (d) => d.status === 'gasto_bancario' || d.status === 'impuesto' || (d.status === 'clasificado' && classifyBankCharge(d.tx.description, d.tx.amount)),
  );
  const done = [...by(credits, 'conciliado', 'clasificado'), ...by(debits, 'conciliado', 'clasificado')].filter(
    (item) => !bankCharges.includes(item as DebitReview),
  );
  const monthItf = round2(
    accountTxs.filter((tx) => inMonth(tx.transactionDate)).reduce((sum, tx) => sum + (tx.itf || 0), 0),
  );
  // Sin cuenta registrada, solo se puede afirmar "sin movimiento" si TODAS las cuentas tienen
  // extracto importado para esa fecha (+15 días de margen); si no, pudo entrar por otra cuenta
  const monthsByAccount = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [name, txs] of transactionsByAccount) map.set(name, new Set(txs.map((tx) => tx.transactionDate.slice(0, 7))));
    return map;
  }, [transactionsByAccount]);
  const coveredByAllAccounts = (date: string) => {
    const shifted = new Date(new Date(`${date.slice(0, 10)}T00:00:00`).getTime() + 15 * 86_400_000);
    const key = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
    return Array.from(monthsByAccount.values()).every((months) => months.has(key));
  };
  const unbackedInvoices = review.unbackedInvoices.filter(
    (inv) =>
      inMonth(inv.paymentDate ?? inv.dueDate) &&
      !claimedElsewhere.invoiceIds.has(inv.recordId) &&
      (inv.paymentAccount ? true : coveredByAllAccounts(inv.paymentDate ?? inv.dueDate)),
  );
  const unbackedExpenses = review.unbackedExpenses.filter(
    (exp) =>
      inMonth(exp.paymentDate ?? exp.issueDate) &&
      !claimedElsewhere.expenseIds.has(exp.id) &&
      coveredByAllAccounts(exp.paymentDate ?? exp.issueDate),
  );
  // "Entró a otra cuenta…": las demás cuentas registradas y los destinos sin extracto
  const otherDestinations = [...accounts.filter((item) => item !== account), ...OFF_STATEMENT_ACCOUNTS];

  const sum = (list: { tx: BankTransaction }[]) => round2(list.reduce((s, item) => s + Math.abs(item.tx.amount), 0));
  // En bloque solo lo seguro: alta coincidencia y sin sorpresas (pago sin detracción se revisa uno por uno)
  const bulkCandidates = toLink.filter(
    (item) =>
      (item.match?.score ?? 0) >= BULK_MIN_SCORE &&
      !('alreadyPaidIds' in item && (item as CreditReview).match?.allocations.some((a) => a.detractionNotApplied)),
  );
  const bankCostRegistered = (month: string | null) =>
    !!month &&
    expenses.some(
      (exp) => isBankCostExpense(exp) && (exp.paymentDate ?? exp.issueDate).startsWith(month),
    );

  // ── Importar ──
  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIsImporting(true);
    setImportInfo(null);
    setImportErrors([]);
    try {
      // Si el archivo dice de qué banco/cuenta es y no coincide con la elegida, manda el archivo
      const { result, insertedCount, duplicateCount, accountName } = await importFromFile(file, (parsed) => {
        const detected = suggestAccountName(
          parsed.bankName,
          parsed.statement?.accountType,
          parsed.statement?.accountNumber,
        );
        if (!detected || !parsed.bankName) return account;
        const known = accounts.find((item) => sameAccount(item, detected));
        if (known) return known;
        if (bankOf(account) === bankOf(detected) && !/\d{4}/.test(account)) return account;
        return detected;
      });
      setImportErrors(result.errors);
      if (accountName !== account) {
        registerAccount(accountName);
        setAccount(accountName);
      }
      if (result.rows.length > 0) {
        setImportInfo({
          account: accountName,
          fileName: file.name,
          bankName: result.bankName,
          inserted: insertedCount,
          duplicates: duplicateCount,
          credits: result.rows.filter((row) => row.amount > 0).length,
          debits: result.rows.filter((row) => row.amount < 0).length,
          statement: result.statement,
          warnings: result.warnings ?? [],
        });
        const periodMonth = result.statement?.period?.from.slice(0, 7) ?? result.rows[0]?.transactionDate.slice(0, 7);
        if (periodMonth) setMonth(periodMonth);
      }
    } catch (error) {
      console.error(error);
      setImportErrors([error instanceof Error ? error.message : 'No se pudo leer el extracto.']);
    } finally {
      setIsImporting(false);
    }
  };

  const reference = (tx: BankTransaction) => (tx.reference ? `Op. ${tx.reference} · ${tx.description}` : tx.description);

  // ── Acciones: abonos ──
  const linkCredit = async (item: CreditReview, opts: { silent?: boolean; keepAmounts?: boolean } = {}) => {
    const suggestion = item.match;
    if (!suggestion) return false;
    const tx = item.tx;
    const expected = suggestion.allocations.reduce((s, a) => s + a.received, 0);
    // Céntimos de diferencia van a la última factura; en la elección manual se respetan los montos
    const difference = opts.keepAmounts ? 0 : round2(tx.amount - expected);
    const applied: { invoiceId: string; appliedAmount: number }[] = [];

    for (const [index, allocation] of suggestion.allocations.entries()) {
      const invoiceId = allocation.invoice.recordId;
      const real = invoiceById.get(invoiceId);
      if (!real) continue;
      const received = round2(allocation.received + (index === suggestion.allocations.length - 1 ? difference : 0));
      let result: { error?: string };
      if (item.alreadyPaidIds.includes(invoiceId) || real.balance <= 0) {
        // Ya estaba cobrada: solo se completa con los datos del banco
        result = await updateCollectionInfo(invoiceId, {
          paymentDate: tx.transactionDate,
          paymentAccount: account,
          paymentReference: reference(tx),
          igvRetention: allocation.retention > 0 && !(real.igvRetention ?? 0) ? allocation.retention : undefined,
          // Lo que muestra el banco sobre la detracción: el total → no detrajo; el neto → detrajo
          // (queda pendiente de verificar el depósito). Nunca se pisa una "depositada".
          detractionStatus: !calcDetraction(real.total).applies
            ? undefined
            : allocation.detractionNotApplied
              ? 'no_aplicada'
              : !real.detractionStatus || real.detractionStatus === 'no_aplicada'
                ? 'pendiente'
                : undefined,
        });
      } else {
        const applies = calcDetraction(real.total).applies;
        const detractionStatus: DetractionStatus | null = applies
          ? allocation.detractionNotApplied
            ? 'no_aplicada'
            : real.detractionStatus ?? 'pendiente'
          : null;
        result = await registerCollection(invoiceId, {
          paymentDate: tx.transactionDate,
          paymentAccount: account,
          paymentReference: reference(tx),
          receivedAmount: received,
          igvRetention: allocation.retention,
          retentionReceipt: real.retentionReceipt ?? '',
          detractionStatus,
          detractionReceipt: real.detractionReceipt ?? '',
        });
      }
      if (result.error) {
        setActionError(`${real.id}: ${result.error}`);
        return false;
      }
      applied.push({ invoiceId, appliedAmount: received });
    }

    const result = await reconcileCredit(tx.id, applied, {
      matchType: suggestion.allocations.length > 1 ? 'sum' : 'exact',
      confidence: suggestion.score,
      notes: suggestion.reasons.join('; '),
    });
    if (result.error) {
      setActionError(result.error);
      return false;
    }
    if (!opts.silent && !suggestion.payerMatched) {
      const first = invoiceById.get(suggestion.allocations[0].invoice.recordId);
      if (first) {
        setAliasPrompt({
          invoice: first,
          clientName: suggestion.clientName,
          partnerId: suggestion.partner?.id,
          text: cleanGlosa(tx.description),
        });
      }
    }
    return true;
  };

  // ── Acciones: cargos ──
  const linkDebit = async (item: DebitReview) => {
    const match = item.match;
    if (!match) return false;
    const tx = item.tx;
    const applied: { expenseId: string; appliedAmount: number }[] = [];
    let remaining = Math.abs(tx.amount);
    for (const [index, expense] of match.expenses.entries()) {
      const share =
        index === match.expenses.length - 1 ? round2(remaining) : Math.min(remaining, netPayable(expense).amount);
      remaining = round2(remaining - share);
      // Pendiente → se marca pagado; ya pagado → se corrige con la fecha y el N° de operación del banco
      const result =
        expense.status !== 'pagado'
          ? await updateExpense(expense.id, {
              status: 'pagado',
              paidAmount: expense.totalAmount,
              paymentDate: tx.transactionDate,
              operationNumber: tx.reference ?? expense.operationNumber ?? null,
              paymentMethod: 'transferencia',
            })
          : await updateExpense(expense.id, {
              paymentDate: tx.transactionDate,
              ...(tx.reference && !expense.operationNumber ? { operationNumber: tx.reference } : {}),
            });
      if (result.error) {
        setActionError(`${expense.documentNumber}: ${result.error}`);
        return false;
      }
      applied.push({ expenseId: expense.id, appliedAmount: share });
    }
    const linked = await reconcileCredit(tx.id, applied, {
      matchType: match.expenses.length > 1 ? 'sum' : 'exact',
      confidence: match.score,
      notes: match.reasons.join('; '),
    });
    if (linked.error) {
      setActionError(linked.error);
      return false;
    }
    return true;
  };

  const run = async (key: string, action: () => Promise<unknown>) => {
    if (busy !== null) return;
    setBusy(key);
    setActionError(null);
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        setActionError(String(result.error));
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(null);
    }
  };

  const linkAll = () =>
    run('bulk', async () => {
      for (const item of bulkCandidates) {
        const ok = 'alreadyPaidIds' in item
          ? await linkCredit(item as CreditReview, { silent: true })
          : await linkDebit(item as DebitReview);
        if (!ok) break;
      }
    });

  const classifyCharges = () =>
    run('charges', async () => {
      const groups = new Map<string, string[]>();
      for (const item of bankCharges) {
        if (item.status === 'clasificado') continue;
        const kind = item.chargeKind ?? classifyBankCharge(item.tx.description, item.tx.amount);
        if (!kind) continue;
        const label = CHARGE_LABEL[kind];
        groups.set(label, [...(groups.get(label) ?? []), item.tx.id]);
      }
      for (const [label, ids] of groups) {
        const result = await categorizeMany(ids, label);
        if (result.error) {
          setActionError(result.error);
          return;
        }
      }
    });

  const registerOtherIncome = (tx: BankTransaction) =>
    run(tx.id, async () => {
      // Si el ingreso ya se creó y falló solo la clasificación, no se vuelve a crear
      if (!incomeCreatedFor.has(tx.id)) {
        const result = await insertIncome({
          issueDate: tx.transactionDate,
          amount: tx.amount,
          description: `Abono sin factura · ${tx.reference ? `Op. ${tx.reference} · ` : ''}${tx.description}`,
          clientId: null,
          clientName: null,
        });
        if (result.error) return result;
        setIncomeCreatedFor((prev) => new Set(prev).add(tx.id));
      }
      return categorizeTransaction(tx.id, 'Otro ingreso (gestión)');
    });

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

  /** Lo que se espera que entre por una factura (ya cobrada: como si no lo estuviera) */
  const expectedFor = (invoice: InvoiceRecord) =>
    invoice.balance <= 0
      ? getCollectionBreakdown({ ...invoice, igvRetention: invoice.igvRetention ?? 0 }).netToAccount
      : invoice.paid > 0
        ? invoice.balance
        : getCollectionBreakdown(invoice, { isRetentionAgent: findPartner(invoice, partners)?.isRetentionAgent })
            .netToAccount;

  const pickInvoicesManually = (tx: BankTransaction, chosen: InvoiceRecord[]) => {
    if (chosen.length === 0) return;
    const expectedTotal = round2(chosen.reduce((s, inv) => s + expectedFor(inv), 0));
    const excess = round2(tx.amount - expectedTotal);
    if (excess > 1) {
      const ok = window.confirm(
        `El abono de ${fmt(tx.amount)} supera lo esperado de las facturas elegidas (${fmt(expectedTotal)}) por ${fmt(excess)}.\n\n` +
          '¿Falta elegir alguna factura? Si vinculas igual, el exceso queda anotado sin asignar.',
      );
      if (!ok) return;
    }
    return run(tx.id, async () => {
      setManualTxId(null);
      let remaining = tx.amount;
      const allocations = chosen
        .map((invoice, index) => {
          const share =
            index === chosen.length - 1 && excess <= 1 ? round2(remaining) : round2(Math.min(remaining, expectedFor(invoice)));
          remaining = round2(remaining - share);
          return { invoice, received: share, retention: 0, detractionNotApplied: false };
        })
        // Si el abono no alcanza para todas (pago parcial), las que quedan sin monto no se tocan
        .filter((allocation) => allocation.received > 0);
      if (allocations.length === 0) return;
      await linkCredit(
        {
          tx,
          status: chosen.every((inv) => inv.balance <= 0) ? 'registrado_sin_vincular' : 'cobro_no_registrado',
          alreadyPaidIds: chosen.filter((inv) => inv.balance <= 0).map((inv) => inv.recordId),
          match: {
            allocations,
            clientName: chosen[0].client,
            partner: findPartner(chosen[0], partners),
            score: 0,
            difference: 0,
            reasons: ['conciliación manual', ...(excess > 1 ? [`excedente ${fmt(excess)} sin asignar`] : [])],
            payerMatched: true,
            dateDistance: 0,
          },
        },
        { keepAmounts: true },
      );
    });
  };

  const chargeTotals = useMemo(() => {
    const totals: Record<BankChargeKind, number> = { comision: 0, mantenimiento: 0, itf: 0, impuesto: 0 };
    for (const item of bankCharges) {
      const kind = item.chargeKind ?? classifyBankCharge(item.tx.description, item.tx.amount);
      if (kind) totals[kind] = round2(totals[kind] + Math.abs(item.tx.amount));
    }
    totals.itf = round2(totals.itf + monthItf);
    return totals;
  }, [bankCharges, monthItf]);
  const bankCostTotal = round2(chargeTotals.comision + chargeTotals.mantenimiento + chargeTotals.itf);
  const pendingChargeIds = bankCharges.filter((item) => item.status !== 'clasificado');

  const issues = unregisteredCollections.length + unknownCredits.length + unregisteredPayments.length + unknownDebits.length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex w-full flex-col gap-6 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <header className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-500">Cobranza y pagos</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">Conciliación bancaria</h1>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={account}
                onChange={(event) => handleAccountChange(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
                title="Cuenta a la que pertenece el extracto"
              >
                {accounts.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
                <option value={NEW_ACCOUNT}>+ Registrar otra cuenta…</option>
              </select>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={isImporting}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                <Upload className="h-4 w-4" />
                {isImporting ? 'Leyendo extracto…' : 'Importar estado de cuenta'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xls,.xlsx,.csv,.txt,.pdf,.html,.htm"
                className="sr-only"
                onChange={handleImport}
              />
            </div>
          </div>
          <p className="max-w-3xl text-sm text-slate-600">
            Sube el estado de cuenta de BBVA tal como lo descargas (EC_Mes Año.xls). Cada movimiento se cruza con
            tus facturas y egresos para encontrar cobros y pagos que no están registrados.
          </p>
        </header>

        {importInfo && <ImportSummary info={importInfo} onClose={() => setImportInfo(null)} />}

        {(importErrors.length > 0 || syncError || actionError || reconciliationsError) && (
          <div className="space-y-2">
            {[...importErrors, syncError, reconciliationsError, actionError].filter(Boolean).map((message) => (
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
            <code className="rounded bg-amber-100 px-1 font-mono">supabase/migration-cobranza.sql</code> en Supabase.
          </p>
        )}

        {aliasPrompt && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            <span className="text-indigo-900">
              El banco no mostró a <strong>{shortenName(aliasPrompt.clientName, 40)}</strong>. ¿Guardar esta glosa
              como su alias para reconocerlo la próxima vez?
            </span>
            <input
              value={aliasPrompt.text}
              onChange={(event) => setAliasPrompt((prev) => (prev ? { ...prev, text: event.target.value } : prev))}
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

        {months.length > 0 && (
          <nav className="flex flex-wrap gap-2" aria-label="Mes del extracto">
            {months.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setMonth(key)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                  key === activeMonth ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {monthLabel(key)}
              </button>
            ))}
          </nav>
        )}

        {isLoading ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Cargando movimientos…</p>
        ) : accountTxs.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Aún no hay movimientos de esta cuenta. Importa un estado de cuenta para empezar.
          </p>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                tone="amber"
                label="Cobros no registrados"
                value={fmt(sum(unregisteredCollections) + sum(unknownCredits))}
                hint={`${unregisteredCollections.length} con factura pendiente · ${unknownCredits.length} sin factura`}
              />
              <Stat
                tone="rose"
                label="Pagos no registrados"
                value={fmt(sum(unregisteredPayments) + sum(unknownDebits))}
                hint={`${unregisteredPayments.length} egreso pendiente · ${unknownDebits.length} sin comprobante`}
              />
              <Stat
                tone="blue"
                label="Registrados, falta vincular"
                value={String(toLink.length)}
                hint={`${bulkCandidates.length} con alta coincidencia`}
              />
              <Stat
                tone="slate"
                label="Gastos bancarios del mes"
                value={fmt(bankCostTotal)}
                hint={`Comisiones ${fmt(chargeTotals.comision + chargeTotals.mantenimiento)} · ITF ${fmt(chargeTotals.itf)}`}
              />
            </section>

            {issues === 0 && toLink.length === 0 && (
              <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                <CheckCircle className="h-4 w-4" />
                Todo lo de {activeMonth ? monthLabel(activeMonth) : 'este extracto'} está registrado y conciliado.
              </p>
            )}

            {unregisteredCollections.length > 0 && (
              <Section
                tone="amber"
                icon={<ArrowDownLeft className="h-4 w-4" />}
                title="Cobros que llegaron y no están registrados"
                hint="El dinero entró, pero la factura sigue pendiente en la plataforma."
              >
                {unregisteredCollections.map((item) => (
                  <CreditRow key={item.tx.id} item={item} invoiceById={invoiceById}>
                    <ActionButton busy={busy === item.tx.id} disabled={locked} onClick={() => run(item.tx.id, () => linkCredit(item))}>
                      Registrar cobro
                    </ActionButton>
                  </CreditRow>
                ))}
              </Section>
            )}

            {unknownCredits.length > 0 && (
              <Section
                tone="amber"
                icon={<ArrowDownLeft className="h-4 w-4" />}
                title="Abonos sin factura"
                hint="Entró dinero que no coincide con ninguna factura. Puede ser un pago parcial, un adelanto o un ingreso no facturado."
              >
                {unknownCredits.map((item) => (
                  <MovementRow
                    key={item.tx.id}
                    tx={item.tx}
                    footer={
                      manualTxId === item.tx.id ? (
                        <ManualPicker
                          tx={item.tx}
                          // Con saldo, aunque ya tenga un abono vinculado (pagos en partes); cobradas solo si no están vinculadas
                          invoices={invoices.filter((inv) => inv.balance > 0 || !reconciledInvoiceIds.has(inv.recordId))}
                          expectedFor={expectedFor}
                          disabled={locked}
                          onCancel={() => setManualTxId(null)}
                          onPick={(chosen) => void pickInvoicesManually(item.tx, chosen)}
                      />
                      ) : undefined
                    }
                  >
                    {manualTxId !== item.tx.id && (
                      <div className="flex flex-wrap items-center gap-2">
                        <SecondaryButton disabled={locked} onClick={() => setManualTxId(item.tx.id)}>
                          Elegir factura(s)
                        </SecondaryButton>
                        <SecondaryButton
                          disabled={incomesTableMissing || locked}
                          onClick={() => registerOtherIncome(item.tx)}
                          title="Ingreso de gestión: suma a la utilidad, no a lo fiscal"
                        >
                          Otro ingreso (sin factura)
                        </SecondaryButton>
                        <CategorySelect
                          disabled={locked}
                          placeholder="No es un cobro…"
                          options={CREDIT_NOT_INCOME}
                          onPick={(label) => run(item.tx.id, () => categorizeTransaction(item.tx.id, label))}
                        />
                      </div>
                    )}
                  </MovementRow>
                ))}
              </Section>
            )}

            {(unregisteredPayments.length > 0 || unknownDebits.length > 0) && (
              <Section
                tone="rose"
                icon={<ArrowUpRight className="h-4 w-4" />}
                title="Pagos que salieron y no están registrados"
                hint="Salió dinero que no figura como pagado en Egresos, o que no tiene comprobante."
              >
                {unregisteredPayments.map((item) => (
                  <DebitRow key={item.tx.id} item={item}>
                    <ActionButton busy={busy === item.tx.id} disabled={locked} onClick={() => run(item.tx.id, () => linkDebit(item))}>
                      Marcar pagado
                    </ActionButton>
                  </DebitRow>
                ))}
                {unknownDebits.map((item) => (
                  <MovementRow key={item.tx.id} tx={item.tx} badge="Sin comprobante">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={egresosPrefillUrl({
                          fecha: item.tx.transactionDate,
                          monto: Math.abs(item.tx.amount),
                          concepto: item.tx.description,
                          operacion: item.tx.reference ?? '',
                        })}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                      >
                        Registrar en Egresos
                      </Link>
                      <CategorySelect
                        disabled={locked}
                        placeholder="No es un gasto…"
                        options={DEBIT_NOT_EXPENSE}
                        onPick={(label) => run(item.tx.id, () => categorizeTransaction(item.tx.id, label))}
                      />
                    </div>
                  </MovementRow>
                ))}
              </Section>
            )}

            {toLink.length > 0 && (
              <Section
                tone="blue"
                icon={<Link2 className="h-4 w-4" />}
                title="Ya registrados — falta vincular con el banco"
                hint="La factura o el egreso ya figura como pagado; al vincular se guarda la fecha real, la cuenta y el N° de operación."
                action={
                  bulkCandidates.length > 0 ? (
                    <ActionButton busy={busy === 'bulk'} disabled={locked} onClick={linkAll}>
                      Vincular {bulkCandidates.length} con alta coincidencia
                    </ActionButton>
                  ) : undefined
                }
              >
                {toLink.map((item) =>
                  'alreadyPaidIds' in item ? (
                    <CreditRow key={item.tx.id} item={item as CreditReview} invoiceById={invoiceById}>
                      <SecondaryButton disabled={locked} onClick={() => run(item.tx.id, () => linkCredit(item as CreditReview))}>
                        Vincular
                      </SecondaryButton>
                    </CreditRow>
                  ) : (
                    <DebitRow key={item.tx.id} item={item as DebitReview}>
                      <SecondaryButton disabled={locked} onClick={() => run(item.tx.id, () => linkDebit(item as DebitReview))}>
                        Vincular
                      </SecondaryButton>
                    </DebitRow>
                  ),
                )}
              </Section>
            )}

            {bankCharges.length > 0 && (
              <Section
                tone="slate"
                icon={<Landmark className="h-4 w-4" />}
                title="Gastos bancarios e impuestos"
                hint="Comisiones, mantenimiento e ITF son gasto deducible; regístralos en Egresos con el estado de cuenta como sustento. El pago a SUNAT no es gasto."
                action={
                  <div className="flex flex-wrap gap-2">
                    {pendingChargeIds.length > 0 && (
                      <ActionButton busy={busy === 'charges'} disabled={locked} onClick={classifyCharges}>
                        Clasificar {pendingChargeIds.length}
                      </ActionButton>
                    )}
                    {bankCostTotal > 0 && activeMonth && !bankCostRegistered(activeMonth) && (
                      <Link
                        href={egresosPrefillUrl({
                          fecha: lastDayOf(activeMonth, accountTxs),
                          monto: bankCostTotal,
                          concepto: `Comisiones, mantenimiento e ITF ${monthLabel(activeMonth)} (${account})`,
                          proveedor: 'BBVA',
                          categoria: 'administrativos',
                        })}
                        className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Registrar {fmt(bankCostTotal)} en Egresos
                      </Link>
                    )}
                  </div>
                }
              >
                <div className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-4">
                  <Total label="Comisiones" value={chargeTotals.comision} />
                  <Total label="Mantenimiento" value={chargeTotals.mantenimiento} />
                  <Total label="ITF" value={chargeTotals.itf} />
                  <Total label="Pagos a SUNAT" value={chargeTotals.impuesto} />
                </div>
                {bankCharges.map((item) => (
                  <MovementRow
                    key={item.tx.id}
                    tx={item.tx}
                    compact
                    badge={item.status === 'clasificado' ? item.tx.category ?? 'Clasificado' : CHARGE_LABEL[item.chargeKind ?? 'comision']}
                  />
                ))}
              </Section>
            )}

            {(unbackedInvoices.length > 0 || unbackedExpenses.length > 0) && (
              <Section
                tone="orange"
                icon={<AlertCircle className="h-4 w-4" />}
                title="Marcados como pagados, sin movimiento en el extracto"
                hint={`Cubre lo importado hasta el ${fmtDate(review.coverage?.to)}. O pasaron por otra cuenta o tarjeta, o se marcaron como pagados por error.`}
              >
                {unbackedInvoices.map((invoice) => (
                  <li key={invoice.recordId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        <span className="mr-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Cobro</span>
                        {invoice.id} · {shortenName(invoice.client, 40)}
                      </p>
                      <p className="text-xs text-slate-500">
                        Total {fmt(invoice.total)} · debió entrar{' '}
                        {fmt(getCollectionBreakdown(invoice, { isRetentionAgent: findPartner(invoice, partners)?.isRetentionAgent }).netToAccount)} ·{' '}
                        {invoice.paymentDate ? `cobro ${fmtDate(invoice.paymentDate)}` : `vence ${fmtDate(invoice.dueDate)}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CategorySelect
                        placeholder="Entró a otra cuenta…"
                        options={otherDestinations}
                        disabled={!collectionColumns || locked}
                        onPick={(label) => run(invoice.recordId, () => setPaymentAccount(invoice.recordId, label))}
                      />
                      <SecondaryButton
                        disabled={locked}
                        onClick={() => {
                          if (window.confirm(`¿Marcar ${invoice.id} como NO cobrada?`)) {
                            void run(invoice.recordId, () => revertPayment(invoice.recordId));
                          }
                        }}
                      >
                        No estaba cobrada
                      </SecondaryButton>
                    </div>
                  </li>
                ))}
                {unbackedExpenses.map((expense) => (
                  <UnbackedExpenseRow
                    key={expense.id}
                    expense={expense}
                    disabled={locked}
                    onOffBank={(method) => run(expense.id, () => updateExpense(expense.id, { paymentMethod: method }))}
                    onRevert={() => {
                      if (window.confirm(`¿Marcar el egreso ${expense.documentNumber} como NO pagado?`)) {
                        void run(expense.id, () => revertExpensePayment(expense.id));
                      }
                    }}
                  />
                ))}
              </Section>
            )}

            {done.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowDone((value) => !value)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-emerald-700">
                    <CheckCircle className="h-4 w-4" />
                    Conciliados y clasificados ({done.length})
                  </span>
                  <ChevronDown className={`h-4 w-4 text-slate-400 transition ${showDone ? 'rotate-180' : ''}`} />
                </button>
                {showDone && (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100">
                    {done.map((item) => (
                      <MovementRow
                        key={item.tx.id}
                        tx={item.tx}
                        compact
                        badge={
                          item.tx.category ??
                          linkLabel(links.get(item.tx.id), invoiceById, expenseById) ??
                          'Conciliado'
                        }
                      />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── componentes ───────────────────────────

const TONES = {
  amber: 'border-amber-200 text-amber-800',
  rose: 'border-rose-200 text-rose-800',
  blue: 'border-blue-200 text-blue-800',
  slate: 'border-slate-200 text-slate-700',
  orange: 'border-orange-200 text-orange-800',
} as const;

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: keyof typeof TONES }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${TONES[tone]}`}>
      <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function Section({
  title,
  hint,
  icon,
  tone,
  action,
  children,
}: {
  title: string;
  hint: string;
  icon: ReactNode;
  tone: keyof typeof TONES;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-xl border bg-white shadow-sm ${TONES[tone].split(' ')[0]}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wide ${TONES[tone].split(' ')[1]}`}>
            {icon}
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
        </div>
        {action}
      </div>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </section>
  );
}

function MovementRow({
  tx,
  badge,
  compact,
  children,
  footer,
}: {
  tx: BankTransaction;
  badge?: string;
  compact?: boolean;
  children?: ReactNode;
  /** Contenido a todo el ancho bajo la fila (p. ej. el selector de facturas) */
  footer?: ReactNode;
}) {
  const credit = tx.amount > 0;
  return (
    <li className={`flex flex-wrap items-center justify-between gap-3 px-4 ${compact ? 'py-2' : 'py-3'}`}>
      <div className="min-w-[220px] flex-1">
        <p className="text-xs font-semibold text-slate-500">
          {fmtDate(tx.transactionDate)}
          {tx.reference && <> · Op. {tx.reference}</>}
          {badge && (
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">{badge}</span>
          )}
        </p>
        <p className={`break-words text-slate-900 ${compact ? 'text-sm' : 'font-medium'}`}>{tx.description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className={`font-black tabular-nums ${credit ? 'text-emerald-700' : 'text-rose-700'} ${compact ? 'text-sm' : 'text-lg'}`}>
          {credit ? '+' : '−'}
          {fmt(Math.abs(tx.amount))}
        </span>
        {children}
      </div>
      {footer && <div className="min-w-0 basis-full">{footer}</div>}
    </li>
  );
}

function Confidence({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const tone = pct >= 85 ? 'bg-emerald-100 text-emerald-800' : pct >= 65 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-black tabular-nums ${tone}`}>{pct}%</span>;
}

function CreditRow({
  item,
  invoiceById,
  children,
}: {
  item: CreditReview;
  invoiceById: Map<string, InvoiceRecord>;
  children: ReactNode;
}) {
  const match = item.match as MatchSuggestion;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-[240px] flex-1">
        <p className="text-xs font-semibold text-slate-500">
          {fmtDate(item.tx.transactionDate)} · {item.tx.description}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 font-semibold text-slate-900">
          <Confidence score={match.score} />
          {match.allocations.map((a) => a.invoice.id).join(' + ')}
          <span className="font-normal text-slate-500">· {shortenName(match.clientName, 36)}</span>
        </p>
        <p className="text-xs text-slate-500">
          {match.allocations
            .map((a) => {
              const real = invoiceById.get(a.invoice.recordId);
              const state = item.alreadyPaidIds.includes(a.invoice.recordId) ? 'ya cobrada' : 'pendiente';
              return `${a.invoice.id} (${fmt(real?.total ?? a.invoice.total)}, ${state}): ${fmt(a.received)}${
                a.retention > 0 ? ` + ret. ${fmt(a.retention)}` : ''
              }`;
            })
            .join(' · ')}
        </p>
        <p className="text-[11px] text-slate-400">{match.reasons.join(' · ')}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-lg font-black tabular-nums text-emerald-700">+{fmt(item.tx.amount)}</span>
        {children}
      </div>
    </li>
  );
}

function DebitRow({ item, children }: { item: DebitReview; children: ReactNode }) {
  const match = item.match;
  if (!match) return null;
  const expense = match.expense;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-[240px] flex-1">
        <p className="text-xs font-semibold text-slate-500">
          {fmtDate(item.tx.transactionDate)}
          {item.tx.reference && <> · Op. {item.tx.reference}</>} · {item.tx.description}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 font-semibold text-slate-900">
          <Confidence score={match.score} />
          {match.expenses.map((e) => `${e.documentSeries ? `${e.documentSeries}-` : ''}${e.documentNumber}`).join(' + ')}
          <span className="font-normal text-slate-500">
            · {shortenName(expense.providerName, 36)} ·{' '}
            {match.expenses.every((e) => e.status === 'pagado') ? 'ya pagado' : 'pendiente'}
          </span>
        </p>
        <p className="text-xs text-slate-500">
          {match.expenses
            .map((e) => {
              const net = netPayable(e);
              const kind = e.documentType === 'recibo' ? 'Recibo' : e.documentType === 'boleta' ? 'Boleta' : 'Factura';
              return `${kind} ${fmt(e.totalAmount)}${
                net.amount !== e.totalAmount ? ` − retención IR ${fmt(e.irRetention)}` : ''
              }`;
            })
            .join(' + ')}
          {match.variant === 'neto_detraccion' && <> − detracción 12%</>} = {fmt(match.expected)}
        </p>
        <p className="text-[11px] text-slate-400">{match.reasons.join(' · ')}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-lg font-black tabular-nums text-rose-700">−{fmt(Math.abs(item.tx.amount))}</span>
        {children}
      </div>
    </li>
  );
}

function UnbackedExpenseRow({
  expense,
  onOffBank,
  onRevert,
  disabled,
}: {
  expense: ExpenseRecord;
  onOffBank: (method: 'tarjeta' | 'efectivo') => void;
  onRevert: () => void;
  disabled?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">
          <span className="mr-2 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">Pago</span>
          {expense.documentSeries ? `${expense.documentSeries}-` : ''}
          {expense.documentNumber} · {shortenName(expense.providerName, 40)}
        </p>
        <p className="text-xs text-slate-500">
          {fmt(netPayable(expense).amount)} · pagado el {fmtDate(expense.paymentDate ?? expense.issueDate)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SecondaryButton disabled={disabled} onClick={() => onOffBank('tarjeta')}>Fue con tarjeta</SecondaryButton>
        <SecondaryButton disabled={disabled} onClick={() => onOffBank('efectivo')}>Fue en efectivo</SecondaryButton>
        <SecondaryButton disabled={disabled} onClick={onRevert}>No estaba pagado</SecondaryButton>
      </div>
    </li>
  );
}

function ImportSummary({ info, onClose }: { info: ImportInfo; onClose: () => void }) {
  const st = info.statement;
  const balanced = st && st.balanceMismatches === 0;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle className="h-4 w-4" />
            {info.fileName}
            <span className="font-normal">· {info.account}</span>
          </p>
          <p>
            {info.credits} abonos y {info.debits} cargos · {info.inserted} nuevos
            {info.duplicates > 0 && <> · {info.duplicates} ya estaban importados</>}
            {st?.period && (
              <>
                {' '}· del {fmtDate(st.period.from)} al {fmtDate(st.period.to)}
              </>
            )}
          </p>
          {st && st.openingBalance !== null && st.closingBalance !== null && (
            <p className={balanced ? 'text-emerald-800' : 'font-semibold text-amber-700'}>
              Saldo inicial {fmt(st.openingBalance)} → saldo final {fmt(st.closingBalance)} ·{' '}
              {balanced ? 'todos los movimientos cuadran con el saldo' : `${st.balanceMismatches} fila(s) no cuadran: puede faltar algún movimiento`}
            </p>
          )}
          {info.warnings.map((warning) => (
            <p key={warning} className="text-amber-700">{warning}</p>
          ))}
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-emerald-100" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-bold tabular-nums text-slate-900">{fmt(value)}</p>
    </div>
  );
}

function ActionButton({
  busy,
  disabled,
  onClick,
  children,
}: {
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
    >
      <ArrowRightLeft className="h-3.5 w-3.5" />
      {busy ? 'Guardando…' : children}
    </button>
  );
}

function SecondaryButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function CategorySelect({
  placeholder,
  options,
  onPick,
  disabled,
}: {
  placeholder: string;
  options: readonly string[];
  onPick: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value=""
      disabled={disabled}
      onChange={(event) => event.target.value && onPick(event.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 outline-none disabled:opacity-50"
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function ManualPicker({
  tx,
  invoices,
  expectedFor,
  onPick,
  onCancel,
  disabled,
}: {
  tx: BankTransaction;
  invoices: InvoiceRecord[];
  expectedFor: (invoice: InvoiceRecord) => number;
  onPick: (invoices: InvoiceRecord[]) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  // Las de monto más parecido primero; se puede filtrar por cliente o número
  const sorted = useMemo(() => {
    const q = normalizeText(query);
    return [...invoices]
      .filter((inv) => inv.issueDate <= tx.transactionDate)
      .filter((inv) => !q || normalizeText(`${inv.id} ${inv.client}`).includes(q))
      .sort((a, b) => Math.abs(expectedFor(a) - tx.amount) - Math.abs(expectedFor(b) - tx.amount))
      .slice(0, 40);
  }, [invoices, expectedFor, tx.amount, tx.transactionDate, query]);
  const chosen = selected
    .map((id) => invoices.find((inv) => inv.recordId === id))
    .filter((inv): inv is InvoiceRecord => Boolean(inv));
  const chosenTotal = round2(chosen.reduce((s, inv) => s + expectedFor(inv), 0));
  const gap = round2(tx.amount - chosenTotal);
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="w-full space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar por cliente o N° de factura"
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-blue-400"
      />
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {sorted.map((invoice) => (
          <li key={invoice.recordId}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-white">
              <input
                type="checkbox"
                checked={selected.includes(invoice.recordId)}
                onChange={() => toggle(invoice.recordId)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              <span className="font-semibold">{invoice.id}</span>
              <span className="min-w-0 flex-1 truncate text-slate-600">{invoice.client}</span>
              <span className="tabular-nums text-slate-700">{fmt(expectedFor(invoice))}</span>
              {invoice.balance <= 0 && <span className="text-[10px] font-bold uppercase text-emerald-700">cobrada</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={Math.abs(gap) <= 1 ? 'font-semibold text-emerald-700' : 'text-slate-600'}>
          Elegidas {fmt(chosenTotal)} de {fmt(tx.amount)}
          {chosen.length > 0 && Math.abs(gap) > 1 && <> · {gap > 0 ? `faltan ${fmt(gap)}` : `sobran ${fmt(-gap)} (pago parcial)`}</>}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="font-semibold text-slate-500 hover:text-slate-700">
            Cancelar
          </button>
          <button
            type="button"
            disabled={chosen.length === 0 || disabled}
            onClick={() => onPick(chosen)}
            className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            Vincular {chosen.length > 1 ? `${chosen.length} facturas` : 'abono'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── utilidades ───────────────────────────

function linkLabel(
  linked: { invoiceId: string | null; expenseId: string | null }[] | undefined,
  invoiceById: Map<string, InvoiceRecord>,
  expenseById: Map<string, ExpenseRecord>,
) {
  if (!linked || linked.length === 0) return null;
  return linked
    .map((link) =>
      link.invoiceId
        ? invoiceById.get(link.invoiceId)?.id
        : link.expenseId
          ? expenseById.get(link.expenseId)?.documentNumber
          : null,
    )
    .filter(Boolean)
    .join(' + ');
}

/** Lleva a Egresos con el formulario precargado desde el movimiento del banco */
function egresosPrefillUrl(p: {
  fecha: string;
  monto: number;
  concepto: string;
  operacion?: string;
  proveedor?: string;
  categoria?: string;
}) {
  const params = new URLSearchParams({
    nuevo: '1',
    fecha: p.fecha,
    monto: String(round2(p.monto)),
    concepto: p.concepto,
    pagado: '1',
  });
  if (p.operacion) params.set('operacion', p.operacion);
  if (p.proveedor) params.set('proveedor', p.proveedor);
  if (p.categoria) params.set('categoria', p.categoria);
  return `/egresos?${params.toString()}`;
}

function lastDayOf(month: string, txs: BankTransaction[]) {
  const dates = txs.map((tx) => tx.transactionDate).filter((d) => d.startsWith(month)).sort();
  return dates[dates.length - 1] ?? `${month}-28`;
}

/** Quita códigos del banco ("TIN 002 F 000…", "ABONO INMEDIATO 002") para sugerir el alias */
function cleanGlosa(description: string) {
  const cleaned = normalizeText(description)
    .split(' ')
    .filter((token) => !/^\d+$/.test(token) && token.length > 1 && !['TIN', 'ABONO', 'INMEDIATO', 'TRANSF'].includes(token))
    .join(' ')
    .trim();
  return cleaned || description.trim();
}
