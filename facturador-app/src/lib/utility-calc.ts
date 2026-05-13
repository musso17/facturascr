
import { InvoiceRecord, ExpenseRecord } from './accounting-types';

export type CalculationResult = {
    totalInvoiced: number;
    totalCollected: number;
    totalExpenses: number; // Only paid expenses
    operationalCashFlow: number;
    taxProvision: number;
    runwayProvision: number;
    capexProvision: number;
    trainingCredit: number; // Beneficio MYPE
    netDistributable: number;
};

export type DistributionResult = {
    toPartners: number;
    toCompany: number;
};

/**
 * Calculates the operational cash flow based on *actual* money in (collected) and *actual* money out (paid expenses).
 */
export function calculateOperationalCashFlow(
    invoices: InvoiceRecord[],
    expenses: ExpenseRecord[]
): {
    totalInvoiced: number;
    totalCollected: number;
    totalExpenses: number;
    operationalCashFlow: number;
} {
    // 1. Total Facturado (just for reference, not used in cash flow)
    const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.total, 0);

    // 2. Total Cobrado (Real Money In)
    // We use the 'paid' field from invoices (assuming partial payments are tracked there, 
    // or simple paid status if only full payments. The prompt implies 'Cobrado').
    const totalCollected = invoices.reduce((sum, inv) => sum + (inv.paid || 0), 0);

    // 3. Total Egresos Ejecutados (Real Money Out)
    const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.paidAmount || 0), 0);

    // 4. Operational Cash Flow
    const operationalCashFlow = totalCollected - totalExpenses;

    return {
        totalInvoiced,
        totalCollected,
        totalExpenses,
        operationalCashFlow,
    };
}


/**
 * Calculates the deductions (filters) to find the Net Distributable Utility.
 */
export function calculateWaterfall(
    cashFlow: number,
    params: {
        taxRate: number; // Percentage (0-100)
        monthlyBurnRate: number; // Amount
        monthsOfRunway: number; // Integer
        capexRate: number; // Percentage (0-100) of something? Usually % of CashFlow or Profit. Prompt says "Define un % (ej. 10%)". Let's assume % of Operational Cash Flow for now, or Revenue? 
        // Prompt: "(+) Total Facturado... (-) Total Egresos ... (=) Flujo de Caja Operativo ... (-) Provisión Impuesto ... (-) Fondo Maniobra ... (-) CAPEX ... (=) Utilidad Neta Distribuible"
        // Usually Tax is on Profit (Invoiced - Expenses), not Cash Flow. 
        // However, for "safety based cash distribution", we often estimate tax on Invoiced or similar.
        // Prompt says: "La app debe estimar el impuesto anual... y bloquear ese dinero".
        // Let's assume Tax is calculated on (Total Invoiced - Total Taxable Expenses) approx, but for simplicity/safety we might take it from Cash Flow or Net Profit. 
        // Let's stick to the Prompt's "Waterfall" structure strictly on the Cash Flow numbers for the 'blocking' logic, 
        // BUT Tax estimation is tricky. 
        // Let's apply Tax Rate on (Cash Flow) as a safe heuristic if simple, or better: (Total Invoiced - Total Expenses) * Tax Rate. 
        // The prompt says "estimar el impuesto anual". 
        // Let's take: estimatedTaxableIncome = totalInvoiced - totalExpenses (accrued or cash? usually accrued for tax, but let's stick to cash for 'safety' or accrued for accuracy).
        // Let's use Cash Basis for simplicity if not specified, but usually tax is accrued. 
        // Use Case: "Jamás repartas el dinero de la SUNAT". 
        // Safe bet: Apply tax rate to (Total collected - Total paid expenses) * taxRate.
    }
): CalculationResult & { deductions: { tax: number; runway: number; capex: number } } {

    // We need the raw numbers first, but here we assume 'cashFlow' is passed. 
    // Actually, to calculate Tax accurately we'd need Invoiced/Expenses. 
    // But this function signature just takes cashFlow. 
    // Let's Refactor: this function should take the full context or just be simple.
    // Let's make it simple: The calling code calculates the base numbers.
    // But wait, the Prompt says "Define un %".

    // Let's strictly follow the subtraction order from the Cash Flow.

    // 1. Tax Provision
    // Warning: Calculating tax on Cash Flow is inexact but safe if Cash Flow ~= Profit. 
    // Let's assume params.taxProvisionAmount is passed in or calculated outside? 
    // No, let's calculate it here. 
    // Issue: We don't have Invoiced/Expense here. 
    // Let's change the signature to take the 'Base' object.
    return {} as any; // Placeholder to restart thought in code
}

// Redefining for better utility
export function calculateSmartDistribution(
    invoices: InvoiceRecord[],
    expenses: ExpenseRecord[],
    params: {
        taxRatePercent: number; // e.g., 10 or 29.5
        monthsOfRunway: number; // e.g., 2
        capexPercent: number; // e.g., 10 (of what? let's assume of Operational Cash Flow to be safe)
        manualMonthlyBurnRate?: number; // Override
        trainingExpense?: number; // Gastos en capacitación
        annualPayroll?: number; // Planilla anual (para calcular límite del 3%)
    }
): CalculationResult {
    const { totalInvoiced, totalCollected, totalExpenses, operationalCashFlow } = calculateOperationalCashFlow(invoices, expenses);

    // Filter Logic

    // 1. Tax Provision
    // Estimate: (Total Invoiced - Total Expenses (Net)) * Tax Rate
    // Note: If Net is negative, Tax is 0.
    // We use Accrued (Invoiced) for Tax base roughly, as SUNAT taxes accrued income usually. 
    // But "Cash Flow" approach might imply we only care about money we have. 
    // Let's use: Taxable Base ~ (Total Invoiced - Total Expenses (accrued)). 
    // But we only have 'TotalCollected' and 'TotalExpenses(Paid)' easily here? 
    // Actually we have full records. 
    // Let's use (Total Invoiced - Total Expenses (Total Amount)) for Tax Base.
    const totalAccruedExpenses = expenses.reduce((sum, e) => sum + e.totalAmount, 0);
    const estimatedTaxableIncome = Math.max(0, totalInvoiced - totalAccruedExpenses);
    
    // Cálculo de crédito por capacitación (Límite MYPE: 3% de planilla)
    const trainingExpense = params.trainingExpense || 0;
    const payroll = params.annualPayroll || 0;
    const maxTrainingCredit = payroll * 0.03;
    const trainingCredit = Math.min(trainingExpense, maxTrainingCredit);

    // Calcular impuesto inicial y deducir crédito (el crédito no puede hacer el impuesto negativo)
    const baseTaxProvision = estimatedTaxableIncome * (params.taxRatePercent / 100);
    const taxProvision = Math.max(0, baseTaxProvision - trainingCredit);

    // 2. Runway (Fondo de Maniobra)
    // "Costo de Vida Mensual". 
    // Algorithm: Average of last 6 months of expenses? 
    // Or if manual override is provided.
    let monthlyBurn = 0;
    if (params.manualMonthlyBurnRate !== undefined) {
        monthlyBurn = params.manualMonthlyBurnRate;
    } else {
        // Calculate average expenses of last 6 months
        // This is complex to do inside this pure function without date filtering context. 
        // We will assume the caller might pass a calculated burn rate, OR we do a simple avg of all available data if < 6 months, or just total / 12?
        // Let's use a helper for burn rate if not provided? 
        // For now, let's default to: Total Expenses / 12 (if full year) or Total Expenses / distinct months.
        // Let's fallback to: Total Paid Expenses / (number of months with activity).
        const monthsWithExpenses = new Set(expenses.map(e => e.issueDate.substring(0, 7))).size || 1;
        monthlyBurn = totalExpenses / monthsWithExpenses;
    }

    const runwayProvision = monthlyBurn * params.monthsOfRunway;

    // 3. CAPEX
    // "Define un % (ej. 10%) para renovación". 
    // Usually % of Cash Flow or Revenue. 
    // Let's use % of Operational Cash Flow (Positive only).
    const capexProvision = Math.max(0, operationalCashFlow) * (params.capexPercent / 100);

    // Result
    // Distributable = Cash Flow - Tax - Runway - Capex
    // "Jamás repartas dinero que no tienes" -> min 0? 
    // The prompt implies we want to know "Safe to withdraw". If negative, it's 0.
    const deductions = taxProvision + runwayProvision + capexProvision;
    const netDistributable = Math.max(0, operationalCashFlow - deductions);

    return {
        totalInvoiced,
        totalCollected,
        totalExpenses,
        operationalCashFlow,
        taxProvision,
        runwayProvision,
        capexProvision,
        trainingCredit,
        netDistributable
    };
}

export function distribute(
    netDistributable: number,
    reinvestmentPercent: number // 0 to 100
): DistributionResult {
    const toCompany = netDistributable * (reinvestmentPercent / 100);
    const toPartners = netDistributable - toCompany;
    return {
        toPartners,
        toCompany
    };
}

export function calculateMonthlyBurnRate(expenses: ExpenseRecord[], monthsToLookBack = 6): number {
    if (expenses.length === 0) return 0;

    // Sort desc
    const sorted = [...expenses].sort((a, b) => b.issueDate.localeCompare(a.issueDate));

    // Get last N months
    // Naive approach: Just take all expenses if we assume dataset is current year.
    // Better: Filter by date.
    const now = new Date();
    const cutoff = new Date();
    cutoff.setMonth(now.getMonth() - monthsToLookBack);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const recentExpenses = sorted.filter(e => e.issueDate >= cutoffStr);

    if (recentExpenses.length === 0) return 0;

    const distinctMonths = new Set(recentExpenses.map(e => e.issueDate.substring(0, 7))).size || 1;
    const total = recentExpenses.reduce((sum, e) => sum + (e.totalAmount || 0), 0); // Use accrued or paid? Usually accrued for "Burn Rate" obligation.

    return total / distinctMonths;
}
