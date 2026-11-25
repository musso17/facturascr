/**
 * Revisión de un extracto bancario contra lo registrado en la plataforma.
 *
 * Abonos (dinero que entró):
 *  - cobro_no_registrado: coincide con factura(s) que siguen PENDIENTES → falta registrar el cobro
 *  - registrado_sin_vincular: coincide con factura(s) ya marcadas como cobradas → solo vincular
 *  - sin_factura: no coincide con ninguna factura → ingreso no registrado
 * Cargos (dinero que salió):
 *  - pago_no_registrado: coincide con egreso(s) PENDIENTES → falta marcarlos como pagados
 *  - registrado_sin_vincular: coincide con egreso(s) ya pagados → solo vincular
 *  - sin_comprobante: no coincide con ningún egreso → pago no registrado
 *  - gasto_bancario / impuesto: comisiones, mantenimiento, ITF, SUNAT
 * Y al revés: facturas/egresos marcados como pagados sin movimiento en el extracto.
 *
 * Cada factura/egreso se asigna a un solo movimiento (los de mayor puntaje primero).
 */
import type { ExpenseRecord, InvoiceRecord, PartnerRecord } from './accounting-types';
import type { BankTransaction } from './bank-types';
import { DETRACTION_RATE, DETRACTION_THRESHOLD } from './detraction';
import { normalizeText, suggestMatches, type MatchSuggestion } from './collection-matching';
import { sameAccount } from './bank-accounts';

export type CreditStatus = 'conciliado' | 'clasificado' | 'cobro_no_registrado' | 'registrado_sin_vincular' | 'sin_factura';
export type DebitStatus =
  | 'conciliado'
  | 'clasificado'
  | 'pago_no_registrado'
  | 'registrado_sin_vincular'
  | 'sin_comprobante'
  | 'gasto_bancario'
  | 'impuesto';

export type BankChargeKind = 'comision' | 'mantenimiento' | 'itf' | 'impuesto';

export interface ExpenseMatch {
  /** Primer egreso (compatibilidad); `expenses` tiene todos los del pago */
  expense: ExpenseRecord;
  expenses: ExpenseRecord[];
  /** Monto que debió salir del banco */
  expected: number;
  /** reembolso: transferencia a un socio por compras que pagó él (tarjeta/efectivo) */
  variant: 'neto' | 'neto_detraccion' | 'saldo' | 'varios' | 'reembolso';
  difference: number;
  score: number;
  reasons: string[];
  dateDistance: number;
}

export interface CreditReview {
  tx: BankTransaction;
  status: CreditStatus;
  match?: MatchSuggestion;
  /** Facturas del match que ya estaban registradas como cobradas (solo se completan, no se cobran de nuevo) */
  alreadyPaidIds: string[];
}

export interface DebitReview {
  tx: BankTransaction;
  status: DebitStatus;
  match?: ExpenseMatch;
  chargeKind?: BankChargeKind;
  /** La glosa nombra a un socio/persona: si no hay comprobante, es un reembolso sin compra registrada */
  reimbursementTo?: string;
}

export interface StatementReview {
  credits: CreditReview[];
  debits: DebitReview[];
  /** Facturas cobradas (sin vincular) cuya fecha cae en lo cubierto por el extracto y no aparecen */
  unbackedInvoices: InvoiceRecord[];
  unbackedExpenses: ExpenseRecord[];
  coverage: { from: string; to: string } | null;
  /** Facturas y egresos que algún movimiento de esta cuenta explica (para cruzar con otras cuentas) */
  claimedInvoiceIds: Set<string>;
  claimedExpenseIds: Set<string>;
}

const PAYMENT_METHODS_OFF_BANK = new Set(['tarjeta', 'efectivo']);
/** Días de margen: un cobro o pago puede salir días después de lo registrado */
const UNBACKED_GRACE_DAYS = 15;
/** Una factura con fecha de cobro registrada solo explica abonos cercanos a esa fecha */
const PAID_DATE_WINDOW = 10;
/** Un egreso pagado solo explica cargos cercanos a su fecha de pago (el formulario usa la de emisión) */
const EXPENSE_PAID_WINDOW = 20;
/** Comisiones y mantenimiento del banco: montos chicos */
const BANK_CHARGE_MAX = 200;
const EXACT = 0.05;
const ROUNDING = 1.0;

/** Comisiones, mantenimiento, ITF y SUNAT con el formato que emite el banco */
export function classifyBankCharge(description: string, amount?: number): BankChargeKind | null {
  const text = normalizeText(description);
  const small = amount === undefined || Math.abs(amount) <= BANK_CHARGE_MAX;
  // BBVA "*1663-SUNAT NPS", Interbank "PAG SNT NPS"
  if (/\bSUNAT\b|\bSNT NPS\b/.test(text)) return 'impuesto';
  if (/^ITF\b|^IMPUESTO A LAS TRANSACCIONES/.test(text)) return 'itf';
  if (small && /^(MANTENIMIENTO \d|COMISION DE MANTENIMIENTO|MANT CTA)/.test(text)) return 'mantenimiento';
  if (small && /^(COMIS|COMISION|PORTES|MEMBRESIA)\b/.test(text)) return 'comision';
  return null;
}

/**
 * Lo que realmente sale del banco por un egreso. Hay dos convenciones guardadas:
 * recibos escaneados (base = neto, total = bruto: base + igv + otros = total − IR) y
 * los ingresados a mano (total = base + igv + otros − IR, ya neto).
 */
export function netPayable(expense: ExpenseRecord) {
  const gross = expense.baseAmount + expense.igvAmount + expense.otherTaxes;
  const totalIsGross =
    expense.irRetention > 0 && Math.abs(expense.totalAmount - expense.irRetention - gross) <= 0.02;
  return {
    amount: round2(totalIsGross ? expense.totalAmount - expense.irRetention : expense.totalAmount),
    netOfRetention: expense.irRetention > 0,
  };
}

export function reviewStatement(input: {
  transactions: BankTransaction[];
  invoices: InvoiceRecord[];
  expenses: ExpenseRecord[];
  partners: PartnerRecord[];
  reconciledInvoiceIds: Set<string>;
  reconciledExpenseIds: Set<string>;
  /** Movimientos que ya tienen vínculos guardados (aunque is_reconciled no se haya actualizado) */
  linkedTxIds?: Set<string>;
  /** Cuenta del extracto: un cobro registrado en otra cuenta no se espera aquí */
  statementAccount: string;
}): StatementReview {
  const { transactions, invoices, expenses, partners, reconciledInvoiceIds, reconciledExpenseIds } = input;
  const linkedTxIds = input.linkedTxIds ?? new Set<string>();
  const isDone = (tx: BankTransaction) => tx.isReconciled || linkedTxIds.has(tx.id);

  // Sin cuenta registrada puede haber entrado a cualquiera; "INTERBANK" en la factura = la cuenta de Interbank
  const inThisAccount = (account: string | null | undefined) =>
    !account || sameAccount(account, input.statementAccount);

  const dates = transactions.map((tx) => tx.transactionDate).sort();
  const coverage = dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null;
  const coverageFrom = coverage ? toTime(coverage.from) : 0;

  // ── Abonos ──
  // Con saldo pendiente siempre es candidata, aunque ya tenga un abono vinculado (pagos en partes)
  const pendingInvoices = invoices.filter((inv) => inv.balance > 0);
  const paidUnlinked = invoices.filter(
    (inv) =>
      inv.status === 'Pagado' &&
      !reconciledInvoiceIds.has(inv.recordId) &&
      inThisAccount(inv.paymentAccount),
  );
  const paidIds = new Set(paidUnlinked.map((inv) => inv.recordId));
  // Una factura ya cobrada se evalúa como si estuviera pendiente (¿este abono es ese cobro?)
  const asUnpaid = (inv: InvoiceRecord): InvoiceRecord => ({ ...inv, paid: 0, balance: inv.total });

  const credits = transactions.filter((tx) => tx.amount > 0);
  const creditReviews = new Map<string, CreditReview>();
  const openCredits: BankTransaction[] = [];
  for (const tx of credits) {
    if (isDone(tx)) creditReviews.set(tx.id, { tx, status: 'conciliado', alreadyPaidIds: [] });
    else if (tx.category) creditReviews.set(tx.id, { tx, status: 'clasificado', alreadyPaidIds: [] });
    else openCredits.push(tx);
  }

  const claimedInvoices = new Set<string>();
  /**
   * wide = false: una factura ya cobrada solo compite por el abono si su fecha de cobro está
   * cerca, o (sin fecha) si vence dentro de lo importado. Evita que una factura vieja, cobrada en
   * un mes no importado, se quede con el abono de una pendiente del mismo monto.
   * wide = true (segunda vuelta): cualquier cobrada de los últimos 6 meses.
   */
  const poolFor = (tx: BankTransaction, wide: boolean) => {
    const txTime = toTime(tx.transactionDate);
    const paidWindow = paidUnlinked.filter((inv) => {
      const issued = toTime(inv.issueDate);
      if (issued > txTime + 3 * DAY || issued < txTime - 180 * DAY) return false;
      if (wide) return true;
      if (inv.paymentDate) return Math.abs(toTime(inv.paymentDate) - txTime) <= PAID_DATE_WINDOW * DAY;
      return toTime(inv.dueDate) >= coverageFrom - UNBACKED_GRACE_DAYS * DAY;
    });
    return [...pendingInvoices, ...paidWindow.map(asUnpaid)].filter(
      (inv) => !claimedInvoices.has(inv.recordId),
    );
  };

  const invoiceById = new Map(invoices.map((inv) => [inv.recordId, inv]));
  /** ¿Esta parte del abono ya estaba registrada? (factura cobrada, o cobro parcial ya anotado en esa fecha) */
  const isRegistered = (recordId: string, tx: BankTransaction) => {
    if (paidIds.has(recordId)) return true;
    const real = invoiceById.get(recordId);
    if (!real || real.paid <= 0 || !real.paymentDate) return false;
    // Un abono anterior o del mismo día que el cobro parcial registrado es ese mismo cobro
    return toTime(tx.transactionDate) <= toTime(real.paymentDate) + 3 * DAY;
  };

  const assignCredits = (pending: BankTransaction[], wide: boolean) => {
    const pairs: { tx: BankTransaction; suggestion: MatchSuggestion }[] = [];
    for (const tx of pending) {
      for (const suggestion of suggestMatches(tx, poolFor(tx, wide), partners, 5)) {
        // Segunda vuelta con facturas cobradas lejos del abono: se muestra, pero nunca entra
        // en "Vincular todos" (queda bajo el umbral de alta coincidencia)
        const capped =
          wide && suggestion.allocations.some((a) => paidIds.has(a.invoice.recordId))
            ? { ...suggestion, score: Math.min(suggestion.score, 0.8), reasons: [...suggestion.reasons, 'revisar: cobro registrado lejos de esta fecha'] }
            : suggestion;
        pairs.push({ tx, suggestion: capped });
      }
    }
    // En empate gana lo ya registrado como cobrado (y que cae en el período): esas facturas
    // necesitan un abono que las respalde; las pendientes no.
    const registeredShare = (suggestion: MatchSuggestion) =>
      suggestion.allocations.filter((a) => paidIds.has(a.invoice.recordId)).length /
      suggestion.allocations.length;
    // Pero si una explicación está mucho más cerca en fecha (> 14 días de diferencia), gana la cercana:
    // una iguala mensual cobrada hace un mes no debe quedarse con el abono de la de este mes.
    pairs.sort((a, b) => {
      const byScore = b.suggestion.score - a.suggestion.score;
      if (Math.abs(byScore) > 0.001) return byScore;
      const byDate = a.suggestion.dateDistance - b.suggestion.dateDistance;
      if (Math.abs(byDate) > 14) return byDate;
      return (
        registeredShare(b.suggestion) - registeredShare(a.suggestion) ||
        Math.abs(a.suggestion.difference) - Math.abs(b.suggestion.difference) ||
        byDate
      );
    });
    for (const { tx, suggestion } of pairs) {
      if (creditReviews.has(tx.id)) continue;
      const ids = suggestion.allocations.map((a) => a.invoice.recordId);
      if (ids.some((id) => claimedInvoices.has(id))) continue;
      ids.forEach((id) => claimedInvoices.add(id));
      const alreadyPaidIds = ids.filter((id) => isRegistered(id, tx));
      creditReviews.set(tx.id, {
        tx,
        status: alreadyPaidIds.length === ids.length ? 'registrado_sin_vincular' : 'cobro_no_registrado',
        match: suggestion,
        alreadyPaidIds,
      });
    }
  };
  assignCredits(openCredits, false);
  // Segunda vuelta: los que no encontraron candidato (o lo perdieron frente a otro abono)
  assignCredits(openCredits.filter((tx) => !creditReviews.has(tx.id)), true);
  for (const tx of openCredits) {
    if (!creditReviews.has(tx.id)) creditReviews.set(tx.id, { tx, status: 'sin_factura', alreadyPaidIds: [] });
  }

  // ── Cargos ──
  const debits = transactions.filter((tx) => tx.amount < 0);
  const debitReviews = new Map<string, DebitReview>();
  const openDebits: BankTransaction[] = [];
  for (const tx of debits) {
    if (isDone(tx)) {
      debitReviews.set(tx.id, { tx, status: 'conciliado' });
      continue;
    }
    if (tx.category) {
      debitReviews.set(tx.id, { tx, status: 'clasificado' });
      continue;
    }
    const kind = classifyBankCharge(tx.description, tx.amount);
    if (kind) {
      debitReviews.set(tx.id, { tx, status: kind === 'impuesto' ? 'impuesto' : 'gasto_bancario', chargeKind: kind });
      continue;
    }
    openDebits.push(tx);
  }

  const candidateExpenses = expenses.filter((exp) => !reconciledExpenseIds.has(exp.id));
  const providerNames = Array.from(new Set(expenses.map((exp) => exp.providerName)));
  // Personas (emiten recibos por honorarios): una transferencia a su nombre puede ser un reembolso
  const people = Array.from(new Set(expenses.filter((exp) => exp.documentType === 'recibo').map((exp) => exp.providerName)));
  const payeeOf = (tx: BankTransaction) => {
    const glosa = ` ${normalizeText(`${tx.description} ${tx.reference ?? ''}`)} `;
    return people.find((person) => namesProvider(glosa, person)) ?? null;
  };
  const claimedExpenses = new Set<string>();
  const assignDebits = (pending: BankTransaction[], combos: boolean) => {
    const pairs: { tx: BankTransaction; match: ExpenseMatch }[] = [];
    const pool = candidateExpenses.filter((exp) => !claimedExpenses.has(exp.id));
    for (const tx of pending) {
      for (const match of matchExpenses(tx, pool, 3, combos, providerNames)) pairs.push({ tx, match });
      const payee = combos ? null : payeeOf(tx);
      if (payee) for (const match of matchReimbursements(tx, pool, payee)) pairs.push({ tx, match });
    }
    pairs.sort(
      (a, b) =>
        b.match.score - a.match.score ||
        Math.abs(a.match.difference) - Math.abs(b.match.difference) ||
        a.match.expenses.length - b.match.expenses.length ||
        a.match.dateDistance - b.match.dateDistance,
    );
    for (const { tx, match } of pairs) {
      if (debitReviews.has(tx.id)) continue;
      if (match.expenses.some((exp) => claimedExpenses.has(exp.id))) continue;
      match.expenses.forEach((exp) => claimedExpenses.add(exp.id));
      debitReviews.set(tx.id, {
        tx,
        status: match.expenses.every((exp) => exp.status === 'pagado') ? 'registrado_sin_vincular' : 'pago_no_registrado',
        match,
      });
    }
  };
  assignDebits(openDebits, false);
  // Segunda vuelta: dos comprobantes del mismo proveedor pagados en una transferencia
  assignDebits(openDebits.filter((tx) => !debitReviews.has(tx.id)), true);
  for (const tx of openDebits) {
    if (!debitReviews.has(tx.id)) {
      debitReviews.set(tx.id, { tx, status: 'sin_comprobante', reimbursementTo: payeeOf(tx) ?? undefined });
    }
  }

  // ── Registrado como pagado pero sin movimiento en el extracto ──
  let unbackedInvoices: InvoiceRecord[] = [];
  let unbackedExpenses: ExpenseRecord[] = [];
  if (coverage) {
    const to = toTime(coverage.to);
    const lastExpected = to - UNBACKED_GRACE_DAYS * DAY;
    unbackedInvoices = paidUnlinked.filter((inv) => {
      if (claimedInvoices.has(inv.recordId)) return false;
      // Sin fecha de cobro registrada se usa el vencimiento, con margen
      const when = toTime(inv.paymentDate ?? inv.dueDate);
      const limit = inv.paymentDate ? to : lastExpected;
      return when >= coverageFrom && when <= limit;
    });
    unbackedExpenses = candidateExpenses.filter((exp) => {
      if (exp.status !== 'pagado' || claimedExpenses.has(exp.id)) return false;
      if (exp.paymentMethod && PAYMENT_METHODS_OFF_BANK.has(exp.paymentMethod)) return false;
      if (isBankCostExpense(exp)) return false;
      const when = toTime(exp.paymentDate ?? exp.issueDate);
      // Si la fecha de pago es la de emisión (así la guarda el formulario), dar margen
      const exactDate = exp.paymentDate && exp.paymentDate !== exp.issueDate;
      return when >= coverageFrom && when <= (exactDate ? to : lastExpected);
    });
  }

  const byDate = <T extends { tx: BankTransaction }>(a: T, b: T) =>
    a.tx.transactionDate.localeCompare(b.tx.transactionDate);

  return {
    credits: Array.from(creditReviews.values()).sort(byDate),
    debits: Array.from(debitReviews.values()).sort(byDate),
    unbackedInvoices,
    unbackedExpenses,
    coverage,
    claimedInvoiceIds: claimedInvoices,
    claimedExpenseIds: claimedExpenses,
  };
}

/** ¿La glosa nombra a este proveedor? (al menos 2 palabras de 4+ letras, o todas si tiene menos) */
function namesProvider(glosa: string, provider: string) {
  const words = normalizeText(provider)
    .split(' ')
    .filter((word) => word.length >= 4);
  return words.length > 0 && words.filter((word) => glosa.includes(` ${word} `)).length >= Math.min(2, words.length);
}

/** Proveedores del exterior: se cobran en dólares, el monto en soles varía con el tipo de cambio */
function isForeignProvider(expense: ExpenseRecord) {
  return !expense.providerDocument && /\b(LLC|PBC|INC|LTD|AB|GMBH|CORP|BV)\b/.test(normalizeText(expense.providerName));
}

/**
 * Reembolso a un socio: la transferencia paga compras de otros proveedores que el socio pagó
 * con su tarjeta o en efectivo (1 a 4 compras de los 90 días anteriores).
 */
export function matchReimbursements(tx: BankTransaction, expenses: ExpenseRecord[], payee: string, limit = 3): ExpenseMatch[] {
  const paidOut = Math.abs(tx.amount);
  const txTime = toTime(tx.transactionDate);
  const candidates = expenses
    .filter(
      (exp) =>
        exp.providerName !== payee &&
        exp.status === 'pagado' &&
        exp.documentType !== 'recibo' &&
        !isBankCostExpense(exp) &&
        toTime(exp.issueDate) <= txTime + 3 * DAY &&
        toTime(exp.issueDate) >= txTime - 90 * DAY,
    )
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    .slice(0, 14);

  const results: ExpenseMatch[] = [];
  const visit = (start: number, group: ExpenseRecord[]) => {
    if (group.length > 0) {
      const expected = round2(group.reduce((sum, exp) => sum + netPayable(exp).amount, 0));
      const difference = round2(paidOut - expected);
      // Compras en dólares: hasta 4% (mín. S/ 1) de diferencia por tipo de cambio
      const fxTolerance = group
        .filter(isForeignProvider)
        .reduce((sum, exp) => sum + Math.max(1, netPayable(exp).amount * 0.04), 0);
      const abs = Math.abs(difference);
      if (abs <= EXACT || (fxTolerance > 0 && abs <= fxTolerance)) {
        const exact = abs <= EXACT;
        const newest = group.reduce((max, exp) => (exp.issueDate > max ? exp.issueDate : max), group[0].issueDate);
        results.push({
          expense: group[0],
          expenses: [...group],
          expected,
          variant: 'reembolso',
          difference,
          // Marcada como pagada por transferencia: pudo ser la transferencia al socio, pero vale algo menos
          score: round2(
            (exact ? 0.85 : 0.65) -
              0.05 * (group.length - 1) -
              (group.some((exp) => exp.paymentMethod && !PAYMENT_METHODS_OFF_BANK.has(exp.paymentMethod)) ? 0.1 : 0),
          ),
          reasons: [
            `reembolso a ${payee}`,
            exact ? 'monto exacto' : `difiere ${difference > 0 ? '+' : ''}${difference.toFixed(2)} (tipo de cambio)`,
            ...(group.length > 1 ? [`${group.length} compras`] : []),
          ],
          dateDistance: Math.round(Math.abs(txTime - toTime(newest)) / DAY),
        });
      }
    }
    if (group.length >= 4) return;
    for (let i = start; i < candidates.length; i += 1) visit(i + 1, [...group, candidates[i]]);
  };
  visit(0, []);
  return results
    .sort((a, b) => b.score - a.score || Math.abs(a.difference) - Math.abs(b.difference) || a.dateDistance - b.dateDistance)
    .slice(0, limit);
}

/**
 * Egreso creado desde "Registrar gastos bancarios": no corresponde a un solo cargo.
 * Se reconoce por el concepto que genera la conciliación (no por el proveedor: un pago real
 * a BBVA, como una cuota de préstamo, sí debe tener su movimiento).
 */
export function isBankCostExpense(expense: ExpenseRecord) {
  return /^COMISIONES MANTENIMIENTO E ITF/.test(normalizeText(expense.concept ?? ''));
}

/** Egresos que explican un cargo: lo neto pagado, neto de detracción (facturas), saldo o dos del mismo proveedor */
export function matchExpenses(
  tx: BankTransaction,
  expenses: ExpenseRecord[],
  limit = 3,
  combos = false,
  /** Todos los proveedores conocidos: si la glosa nombra a otro, la coincidencia por monto vale menos */
  providerNames: string[] = [],
): ExpenseMatch[] {
  const paidOut = Math.abs(tx.amount);
  const txTime = toTime(tx.transactionDate);
  const glosa = ` ${normalizeText(`${tx.description} ${tx.reference ?? ''}`)} `;
  const results: ExpenseMatch[] = [];

  const eligible = expenses.filter((expense) => {
    if (expense.paymentMethod && PAYMENT_METHODS_OFF_BANK.has(expense.paymentMethod)) return false;
    if (isBankCostExpense(expense)) return false;
    const issued = toTime(expense.issueDate);
    // El recibo puede emitirse hasta 20 días después del pago
    if (issued > txTime + 20 * DAY) return false;
    if (expense.status === 'pagado') {
      // Ya pagado: solo si su fecha de pago está cerca de este cargo
      const paidOn = toTime(expense.paymentDate ?? expense.issueDate);
      return Math.abs(paidOn - txTime) <= EXPENSE_PAID_WINDOW * DAY;
    }
    return issued >= txTime - 180 * DAY;
  });

  const scoreOf = (group: ExpenseRecord[], expected: number, variant: ExpenseMatch['variant'], label?: string) => {
    const difference = round2(paidOut - expected);
    const abs = Math.abs(difference);
    if (abs > ROUNDING) return;
    let score = abs <= EXACT ? 0.65 : 0.45;
    const reasons = [abs <= EXACT ? 'monto exacto' : `difiere ${difference > 0 ? '+' : ''}${difference.toFixed(2)}`];
    if (label) reasons.push(label);
    const first = group[0];
    const reference = first.paymentDate ? toTime(first.paymentDate) : toTime(first.issueDate);
    const distance = Math.round(Math.abs(txTime - reference) / DAY);
    if (distance <= 3) score += 0.25;
    else if (distance <= 15) score += 0.15;
    else if (distance <= 45) score += 0.05;
    if (first.paymentDate && first.status === 'pagado' && distance <= 3) reasons.push('misma fecha de pago');
    const named = (provider: string) => {
      const words = normalizeText(provider)
        .split(' ')
        .filter((word) => word.length >= 4);
      return words.length > 0 && words.filter((word) => glosa.includes(` ${word} `)).length >= Math.min(2, words.length);
    };
    if (named(first.providerName)) {
      score += 0.15;
      reasons.push('proveedor en la glosa');
    } else if (providerNames.some((provider) => provider !== first.providerName && named(provider))) {
      // Interbank pone el beneficiario en la glosa: si es otra persona, probablemente no es este egreso
      score -= 0.3;
      reasons.push('la glosa nombra a otro beneficiario');
    }
    if (group.some((exp) => exp.operationNumber && tx.reference && exp.operationNumber.trim() === tx.reference.trim())) {
      score += 0.2;
      reasons.push('mismo N° de operación');
    }
    if (group.length > 1) {
      score -= 0.1;
      reasons.push(`${group.length} comprobantes juntos`);
    }
    results.push({
      expense: first,
      expenses: group,
      expected,
      variant,
      difference,
      score: Math.min(1, round2(score)),
      reasons,
      dateDistance: distance,
    });
  };

  const optionsFor = (expense: ExpenseRecord) => {
    const options: { variant: ExpenseMatch['variant']; expected: number; label?: string }[] = [];
    const net = netPayable(expense);
    if (expense.status !== 'pagado' && expense.paidAmount > 0) {
      options.push({ variant: 'saldo', expected: round2(net.amount - expense.paidAmount), label: 'saldo pendiente' });
    }
    options.push({ variant: 'neto', expected: net.amount, label: net.netOfRetention ? 'neto de retención IR' : undefined });
    // Facturas de proveedor sujetas a detracción: el 12% va a su cuenta del Banco de la Nación
    if (expense.documentType === 'factura' && expense.totalAmount > DETRACTION_THRESHOLD) {
      const detraction = round2(expense.totalAmount * DETRACTION_RATE);
      options.push({ variant: 'neto_detraccion', expected: round2(net.amount - detraction), label: 'neto de detracción' });
      const integer = Math.round(expense.totalAmount * DETRACTION_RATE);
      if (Math.abs(integer - detraction) >= 0.01) {
        options.push({ variant: 'neto_detraccion', expected: round2(net.amount - integer), label: 'neto de detracción' });
      }
    }
    return options;
  };

  if (!combos) {
    for (const expense of eligible) {
      for (const option of optionsFor(expense)) scoreOf([expense], option.expected, option.variant, option.label);
    }
  } else {
    // Dos comprobantes del mismo proveedor pagados en una sola transferencia
    const byProvider = new Map<string, ExpenseRecord[]>();
    for (const expense of eligible) {
      const key = normalizeText(expense.providerDocument || expense.providerName);
      byProvider.set(key, [...(byProvider.get(key) ?? []), expense]);
    }
    for (const group of byProvider.values()) {
      const list = group.slice(0, 12);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const expected = round2(netPayable(list[i]).amount + netPayable(list[j]).amount);
          scoreOf([list[i], list[j]], expected, 'varios');
        }
      }
    }
  }

  return results
    .sort((a, b) => b.score - a.score || a.dateDistance - b.dateDistance)
    .filter(
      (match, index, all) =>
        all.findIndex((m) => m.expenses.map((e) => e.id).join('+') === match.expenses.map((e) => e.id).join('+')) === index,
    )
    .slice(0, limit);
}

const DAY = 86_400_000;

function toTime(date: string) {
  return new Date(`${date.slice(0, 10)}T00:00:00`).getTime();
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
