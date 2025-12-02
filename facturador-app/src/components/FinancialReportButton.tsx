'use client';

import { useState } from 'react';
import { Download, Loader2, FileText } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { InvoiceRecord, ExpenseRecord } from '@/lib/accounting-types';
import { asLocalDate } from '@/lib/accounting-service';

interface FinancialReportButtonProps {
    invoices: InvoiceRecord[];
    expenses: ExpenseRecord[];
}

export function FinancialReportButton({ invoices, expenses }: FinancialReportButtonProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [menuView, setMenuView] = useState<'main' | 'months'>('main');

    // --- Helper Functions ---

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-PE', {
            style: 'currency',
            currency: 'PEN',
            minimumFractionDigits: 2,
        }).format(amount);
    };

    const getMonthName = (date: Date) => {
        return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(date);
    };

    const filterByMonth = <T extends { issueDate: string }>(date: Date, items: T[]): T[] => {
        const monthKey = date.toISOString().slice(0, 7);
        return items.filter((item) => asLocalDate(item.issueDate).toISOString().slice(0, 7) === monthKey);
    };

    const filterByYear = <T extends { issueDate: string }>(year: number, items: T[]): T[] => {
        return items.filter((item) => asLocalDate(item.issueDate).getFullYear() === year);
    };

    // --- Report Generation Logic ---

    const generateMonthlyReport = (targetDate: Date) => {
        setIsGenerating(true);
        setShowMenu(false);
        setMenuView('main');

        try {
            const currentMonthInvoices = filterByMonth(targetDate, invoices);
            const currentMonthExpenses = filterByMonth(targetDate, expenses);

            const doc = new jsPDF();

            // --- Header ---
            doc.setFontSize(20);
            doc.setTextColor(40, 40, 40);
            doc.text('CEREZO - Reporte Financiero Mensual', 14, 20);
            doc.setFontSize(12);
            doc.setTextColor(100, 100, 100);
            doc.text(`El Pulso Operativo - ${getMonthName(targetDate)}`, 14, 28);

            // --- A. Resumen Ejecutivo (Semáforo) ---
            doc.setFontSize(14);
            doc.setTextColor(0, 0, 0);
            doc.text('A. Resumen Ejecutivo (Semáforo)', 14, 40);

            const totalFacturado = currentMonthInvoices.reduce((sum, inv) => sum + inv.total, 0);
            const totalCobrado = currentMonthInvoices.reduce((sum, inv) => sum + inv.paid, 0);
            const totalGastos = currentMonthExpenses.reduce((sum, e) => sum + e.totalAmount, 0);

            const netIncome = totalFacturado - totalGastos; // Utilidad Operativa (Facturado - Gastos)
            const netMargin = totalFacturado > 0 ? (netIncome / totalFacturado) * 100 : 0;

            // Fixed Costs: 'personal', 'servicios', 'administrativos', 'marketing'
            const fixedCategories = ['personal', 'servicios', 'administrativos', 'marketing'];
            const fixedExpenses = currentMonthExpenses.filter(e => fixedCategories.includes(e.category));
            const cashBurn = fixedExpenses.reduce((sum, e) => sum + e.totalAmount, 0);
            const burnRate = cashBurn; // Monthly Burn Rate is just the fixed expenses for this month

            // Runway
            const allTimeIncome = invoices.reduce((sum, inv) => sum + inv.paid, 0);
            const allTimeExpenses = expenses.reduce((sum, e) => sum + (e.status === 'pagado' ? e.totalAmount : e.paidAmount), 0);
            const currentCash = allTimeIncome - allTimeExpenses;
            const runway = burnRate > 0 ? (currentCash / burnRate).toFixed(1) : '∞';

            autoTable(doc, {
                startY: 45,
                head: [['Indicador', 'Valor', 'Estado']],
                body: [
                    ['Facturación vs Cobrado', `${formatCurrency(totalFacturado)} / ${formatCurrency(totalCobrado)}`, totalCobrado < totalFacturado * 0.8 ? 'Alerta: Cobranza lenta' : 'Saludable'],
                    ['Margen Neto Real', `${netMargin.toFixed(1)}%`, netMargin < 15 ? 'RIESGO DE SOSTENIBILIDAD' : 'Saludable (>15%)'],
                    ['Burn Rate (Gasto Fijo)', formatCurrency(burnRate), 'Costo de "abrir la persiana"'],
                    ['Runway (Meses de vida)', `${runway} meses`, Number(runway) < 3 ? 'CRÍTICO (<3 meses)' : 'Estable'],
                ],
                theme: 'grid',
                headStyles: { fillColor: [41, 128, 185] },
                didParseCell: (data) => {
                    if (data.section === 'body' && data.column.index === 2) {
                        const text = data.cell.raw as string;
                        if (text.includes('RIESGO') || text.includes('CRÍTICO') || text.includes('Alerta')) {
                            data.cell.styles.textColor = [200, 0, 0]; // Red
                            data.cell.styles.fontStyle = 'bold';
                        }
                    }
                }
            });

            // --- B. Análisis de Ingresos y Dependencia ---
            let finalY = (doc as any).lastAutoTable.finalY + 15;
            doc.text('B. Análisis de Ingresos y Dependencia', 14, finalY);

            const carbonoInvoices = currentMonthInvoices.filter(inv => inv.client.toLowerCase().includes('carbono'));
            const variableInvoices = currentMonthInvoices.filter(inv => !inv.client.toLowerCase().includes('carbono'));

            const incomeCarbono = carbonoInvoices.reduce((sum, inv) => sum + inv.total, 0);
            const incomeVariable = variableInvoices.reduce((sum, inv) => sum + inv.total, 0);
            const totalIncome = incomeCarbono + incomeVariable;
            const dependencyRatio = totalIncome > 0 ? (incomeCarbono / totalIncome) * 100 : 0;

            autoTable(doc, {
                startY: finalY + 5,
                head: [['Fuente', 'Monto', '% del Total']],
                body: [
                    ['Carbono (Recurrente)', formatCurrency(incomeCarbono), `${((incomeCarbono / totalIncome) * 100 || 0).toFixed(1)}%`],
                    ['Variables (Nuevos)', formatCurrency(incomeVariable), `${((incomeVariable / totalIncome) * 100 || 0).toFixed(1)}%`],
                ],
                theme: 'striped',
            });

            finalY = (doc as any).lastAutoTable.finalY + 10;
            if (dependencyRatio > 60) {
                doc.setTextColor(200, 0, 0);
                doc.setFontSize(10);
                doc.text(`ALERTA: Riesgo Alto por Concentración de Cartera (${dependencyRatio.toFixed(1)}% > 60%).`, 14, finalY);
                doc.setTextColor(0, 0, 0);
                doc.setFontSize(14);
            }

            // --- C. Rentabilidad Variable ---
            finalY += 15;
            doc.text('C. Rentabilidad Variable (Aprox)', 14, finalY);

            // Variable Expenses: 'materiales', 'equipos', 'otros'
            const variableCategories = ['materiales', 'equipos', 'otros'];
            const variableExpenses = currentMonthExpenses.filter(e => variableCategories.includes(e.category));
            const totalVariableExpense = variableExpenses.reduce((sum, e) => sum + e.totalAmount, 0);
            const variableProfit = incomeVariable - totalVariableExpense;

            autoTable(doc, {
                startY: finalY + 5,
                head: [['Concepto', 'Monto']],
                body: [
                    ['Ingresos Variables', formatCurrency(incomeVariable)],
                    ['Costos Directos Variables', `(${formatCurrency(totalVariableExpense)})`],
                    ['Margen Variable', formatCurrency(variableProfit)],
                ],
                theme: 'plain',
            });

            doc.save(`Reporte_Mensual_${targetDate.toISOString().slice(0, 10)}.pdf`);
        } catch (error) {
            console.error('Error generating monthly report:', error);
            alert('Hubo un error al generar el reporte mensual.');
        } finally {
            setIsGenerating(false);
        }
    };

    const generateAnnualReport = () => {
        setIsGenerating(true);
        setShowMenu(false);
        setMenuView('main');

        try {
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentYearInvoices = filterByYear(currentYear, invoices);
            const currentYearExpenses = filterByYear(currentYear, expenses);

            const prevYear = currentYear - 1;
            const prevYearInvoices = filterByYear(prevYear, invoices);
            const prevYearExpenses = filterByYear(prevYear, expenses);

            const doc = new jsPDF();

            // --- Header ---
            doc.setFontSize(20);
            doc.setTextColor(40, 40, 40);
            doc.text('CEREZO - Reporte Financiero Anual', 14, 20);
            doc.setFontSize(12);
            doc.setTextColor(100, 100, 100);
            doc.text(`La Estrategia y Tendencia - ${currentYear}`, 14, 28);

            // --- A. Estado de Resultados Comparativo ---
            doc.setFontSize(14);
            doc.setTextColor(0, 0, 0);
            doc.text('A. Estado de Resultados Comparativo', 14, 40);

            const curIncome = currentYearInvoices.reduce((sum, inv) => sum + inv.total, 0);
            const curExpense = currentYearExpenses.reduce((sum, e) => sum + e.totalAmount, 0);
            const prevIncome = prevYearInvoices.reduce((sum, inv) => sum + inv.total, 0);
            const prevExpense = prevYearExpenses.reduce((sum, e) => sum + e.totalAmount, 0);

            const incomeGrowth = prevIncome > 0 ? ((curIncome - prevIncome) / prevIncome) * 100 : 0;
            const expenseGrowth = prevExpense > 0 ? ((curExpense - prevExpense) / prevExpense) * 100 : 0;

            autoTable(doc, {
                startY: 45,
                head: [['Concepto', `${prevYear}`, `${currentYear}`, 'Crecimiento']],
                body: [
                    ['Ingresos Totales', formatCurrency(prevIncome), formatCurrency(curIncome), `${incomeGrowth.toFixed(1)}%`],
                    ['Gastos Totales', formatCurrency(prevExpense), formatCurrency(curExpense), `${expenseGrowth.toFixed(1)}%`],
                    ['Utilidad Neta', formatCurrency(prevIncome - prevExpense), formatCurrency(curIncome - curExpense), '-'],
                ],
                theme: 'grid',
                headStyles: { fillColor: [41, 128, 185] },
            });

            // --- B. Análisis de Estacionalidad ---
            let finalY = (doc as any).lastAutoTable.finalY + 15;
            doc.text('B. Análisis de Estacionalidad', 14, finalY);

            // Group by month
            const monthlyIncome = new Map<string, number>();
            currentYearInvoices.forEach(inv => {
                const month = inv.issueDate.slice(0, 7); // YYYY-MM
                monthlyIncome.set(month, (monthlyIncome.get(month) || 0) + inv.total);
            });

            const sortedMonths = Array.from(monthlyIncome.entries()).sort((a, b) => b[1] - a[1]);
            const top3 = sortedMonths.slice(0, 3);
            const bottom3 = sortedMonths.slice(-3).reverse(); // Lowest first

            const formatMonth = (key: string) => {
                const [y, m] = key.split('-');
                const d = new Date(Number(y), Number(m) - 1);
                return new Intl.DateTimeFormat('es-PE', { month: 'long' }).format(d);
            };

            autoTable(doc, {
                startY: finalY + 5,
                head: [['Ranking', 'Mes', 'Facturación']],
                body: [
                    ...top3.map((m, i) => [`Top ${i + 1}`, formatMonth(m[0]), formatCurrency(m[1])]),
                    ...bottom3.map((m, i) => [`Bottom ${i + 1}`, formatMonth(m[0]), formatCurrency(m[1])]),
                ],
                theme: 'plain',
            });

            // --- C. Eficiencia del Equipo ---
            finalY = (doc as any).lastAutoTable.finalY + 15;
            doc.text('C. Eficiencia del Equipo (3 personas)', 14, finalY);

            const productivity = curIncome / 3;
            // Benchmark assumption: 5x salary. Let's assume a base salary of 3k PEN/mo -> 36k/yr. 5x = 180k/yr per person.
            // Or simpler: Just show the number and ask "Are we productive?".

            autoTable(doc, {
                startY: finalY + 5,
                head: [['Métrica', 'Valor', 'Benchmark (Ref)']],
                body: [
                    ['Facturación por Empleado', formatCurrency(productivity), '¿> 5x Sueldo Anual?'],
                ],
                theme: 'plain',
            });

            // --- D. Análisis de Costos (Operativo vs Admin) ---
            finalY = (doc as any).lastAutoTable.finalY + 15;
            doc.text('D. Análisis de Costos', 14, finalY);

            const fixedCategories = ['personal', 'servicios', 'administrativos', 'marketing'];
            const variableCategories = ['materiales', 'equipos', 'otros'];

            const operatingCosts = currentYearExpenses.filter(e => variableCategories.includes(e.category)).reduce((sum, e) => sum + e.totalAmount, 0);
            const adminExpenses = currentYearExpenses.filter(e => fixedCategories.includes(e.category)).reduce((sum, e) => sum + e.totalAmount, 0);

            autoTable(doc, {
                startY: finalY + 5,
                head: [['Tipo', 'Monto', '% del Gasto Total']],
                body: [
                    ['Costos Operativos (Producir)', formatCurrency(operatingCosts), `${((operatingCosts / curExpense) * 100 || 0).toFixed(1)}%`],
                    ['Gastos Administrativos (Existir)', formatCurrency(adminExpenses), `${((adminExpenses / curExpense) * 100 || 0).toFixed(1)}%`],
                ],
                theme: 'striped',
            });

            // --- E. Conclusiones y Siguientes Pasos ---
            finalY = (doc as any).lastAutoTable.finalY + 15;
            doc.text('E. Conclusiones y Siguientes Pasos', 14, finalY);

            const actions = [];

            // Rule 1: Dependency
            const carbonIncome = currentYearInvoices.filter(inv => inv.client.toLowerCase().includes('carbono')).reduce((sum, inv) => sum + inv.total, 0);
            const depRatio = curIncome > 0 ? (carbonIncome / curIncome) * 100 : 0;
            if (depRatio > 60) {
                actions.push(`1. DIVERSIFICAR: Carbono representa el ${depRatio.toFixed(0)}% de tus ingresos. Prioridad #1: Conseguir 2 clientes recurrentes nuevos para bajar este riesgo.`);
            } else {
                actions.push(`1. CONSOLIDAR: Tu cartera está equilibrada. Busca aumentar el ticket promedio de los clientes actuales.`);
            }

            // Rule 2: Margin/Efficiency
            const netMargin = curIncome > 0 ? ((curIncome - curExpense) / curIncome) * 100 : 0;
            if (netMargin < 15) {
                actions.push(`2. REVISAR PRECIOS: Tu margen neto (${netMargin.toFixed(1)}%) es bajo (<15%). Estás cobrando poco o tus costos operativos (passthrough) están comiendo la utilidad.`);
            } else {
                actions.push(`2. REINVERTIR: Tienes un margen saludable (${netMargin.toFixed(1)}%). Crea un fondo de reserva para renovación de equipos.`);
            }

            // Rule 3: Seasonality
            if (bottom3.length > 0) {
                const worstMonth = formatMonth(bottom3[0][0]);
                actions.push(`3. PLANIFICAR: ${worstMonth} es tu mes más bajo. Diseña una oferta comercial específica o "paquete de mantenimiento" para vender antes de esa fecha.`);
            } else {
                actions.push(`3. EXPANSIÓN: Mantén el ritmo de ventas y evalúa contratar un asistente para liberar tiempo operativo de los socios.`);
            }

            doc.setFontSize(11);
            doc.setTextColor(50, 50, 50);
            actions.forEach((action, i) => {
                doc.text(action, 14, finalY + 10 + (i * 8), { maxWidth: 180 });
            });

            doc.save(`Reporte_Anual_${currentYear}.pdf`);
        } catch (error) {
            console.error('Error generating annual report:', error);
            alert('Hubo un error al generar el reporte anual.');
        } finally {
            setIsGenerating(false);
        }
    };

    // --- UI Helpers ---
    const getAvailableMonths = () => {
        const months = new Set<string>();
        invoices.forEach(inv => months.add(inv.issueDate.slice(0, 7)));
        return Array.from(months).sort().reverse();
    };

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => { setShowMenu(!showMenu); setMenuView('main'); }}
                className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-sm"
                disabled={isGenerating}
            >
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {isGenerating ? 'Generando...' : 'Descargar Reporte'}
            </button>

            {showMenu && (
                <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-gray-100 bg-white p-2 shadow-lg z-10">
                    {menuView === 'main' ? (
                        <>
                            <button
                                onClick={() => setMenuView('months')}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                            >
                                <FileText className="h-4 w-4 text-blue-500" />
                                <div>
                                    <p className="font-medium">Reporte Mensual</p>
                                    <p className="text-xs text-gray-500">El Pulso Operativo</p>
                                </div>
                            </button>
                            <button
                                onClick={generateAnnualReport}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                            >
                                <FileText className="h-4 w-4 text-purple-500" />
                                <div>
                                    <p className="font-medium">Reporte Anual</p>
                                    <p className="text-xs text-gray-500">Estrategia y Tendencia</p>
                                </div>
                            </button>
                        </>
                    ) : (
                        <div className="max-h-64 overflow-y-auto">
                            <button
                                onClick={() => setMenuView('main')}
                                className="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-50"
                            >
                                ← Volver
                            </button>
                            {getAvailableMonths().map(monthKey => {
                                const [y, m] = monthKey.split('-');
                                const date = new Date(Number(y), Number(m) - 1);
                                const label = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(date);
                                return (
                                    <button
                                        key={monthKey}
                                        onClick={() => generateMonthlyReport(date)}
                                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                                    >
                                        <span>{label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {showMenu && (
                <div
                    className="fixed inset-0 z-0"
                    onClick={() => setShowMenu(false)}
                    style={{ pointerEvents: 'auto', backgroundColor: 'transparent' }}
                />
            )}
        </div>
    );
}
