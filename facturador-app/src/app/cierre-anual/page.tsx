
'use client';

import { useState, useMemo } from 'react';
import { useInvoices } from '@/hooks/use-invoices';
import { useExpenses } from '@/hooks/use-expenses';
import { calculateSmartDistribution, calculateMonthlyBurnRate, distribute } from '@/lib/utility-calc';
import { WaterfallCard } from '@/components/annual-closing/WaterfallCard';
import { DeductionSection } from '@/components/annual-closing/DeductionSection';
import { RiskSlider } from '@/components/annual-closing/RiskSlider';
import { DistributionCard } from '@/components/annual-closing/DistributionCard';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import Link from 'next/link';

export default function AnnualClosingPage() {
    const { invoices, isLoading: loadingInvoices } = useInvoices();
    const { expenses, isLoading: loadingExpenses } = useExpenses();

    // --- State Configuration ---
    const [taxRate, setTaxRate] = useState(10); // Default 10% (MYPE)
    const [monthsOfRunway, setMonthsOfRunway] = useState(2); // Default 2 months
    const [manualBurnRate, setManualBurnRate] = useState<number | undefined>(undefined);
    const [capexRate, setCapexRate] = useState(10); // Default 10%
    const [reinvestmentRate, setReinvestmentRate] = useState(50); // Default 50% (Balanced)
    const [partnerCount, setPartnerCount] = useState(2); // Default 2 partners

    // --- Calculations ---

    // 1. Auto-calc Burn Rate (if not manually overridden, but we pass undefined to logic if not set)
    // Actually, for UI display purposes, we might want to know the calculated one to show as placeholder or default?
    // The logic `calculateSmartDistribution` handles it if we pass manualMonthlyBurnRate as undefined.
    // But to sync the input field, it's better to interpret it here.
    const calculatedBurnRate = useMemo(() => calculateMonthlyBurnRate(expenses), [expenses]);

    // Use manual or calculated for the logic
    const effectiveBurnRate = manualBurnRate !== undefined ? manualBurnRate : calculatedBurnRate;

    // 2. Main Waterfall
    const result = useMemo(() => {
        return calculateSmartDistribution(invoices, expenses, {
            taxRatePercent: taxRate,
            monthsOfRunway,
            capexPercent: capexRate,
            manualMonthlyBurnRate: effectiveBurnRate,
        });
    }, [invoices, expenses, taxRate, monthsOfRunway, capexRate, effectiveBurnRate]);

    // 3. Final Distribution
    const distribution = useMemo(() => {
        return distribute(result.netDistributable, reinvestmentRate);
    }, [result.netDistributable, reinvestmentRate]);


    // --- Handlers ---
    const handleRecord = () => {
        alert('Funcionalidad de registro próximamente. Esto generaría un egreso de caja por: ' + distribution.toPartners.toFixed(2));
        // Implementation Task: Add real database write.
    };

    if (loadingInvoices || loadingExpenses) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-slate-50">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
            <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">

                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-4 mb-4">
                        <Link href="/" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 no-print">
                            <ArrowLeft className="h-4 w-4" />
                            Volver al Dashboard
                        </Link>
                        <button
                            onClick={() => window.print()}
                            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 no-print"
                        >
                            <Printer className="h-4 w-4" />
                            Imprimir Reporte
                        </button>
                    </div>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.5em] text-gray-400">
                                Utilidad Inteligente
                            </p>
                            <h1 className="mt-1 text-3xl font-semibold leading-tight text-gray-900">
                                Cierre Anual 2025
                            </h1>
                        </div>
                        <div className="text-right hidden sm:block">
                            <p className="text-sm text-gray-500">Saldo en Caja (Est.)</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(result.operationalCashFlow)}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8">
                    {/* Left Column: Logic & Controls */}
                    <div className="space-y-6">

                        {/* 1. Waterfall - Cash Flow */}
                        <WaterfallCard
                            totalInvoiced={result.totalInvoiced}
                            totalCollected={result.totalCollected}
                            totalExpenses={result.totalExpenses}
                            operationalCashFlow={result.operationalCashFlow}
                        />

                        {/* 2. Deductions */}
                        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                            <DeductionSection
                                taxRate={taxRate}
                                onTaxRateChange={setTaxRate}
                                taxAmount={result.taxProvision}

                                monthsOfRunway={monthsOfRunway}
                                onRunwayChange={setMonthsOfRunway}
                                monthlyBurnRate={effectiveBurnRate}
                                onManualBurnRateChange={setManualBurnRate}
                                runwayAmount={result.runwayProvision}

                                capexRate={capexRate}
                                onCapexRateChange={setCapexRate}
                                capexAmount={result.capexProvision}
                            />
                        </div>

                        {/* 3. Slider */}
                        <RiskSlider
                            value={reinvestmentRate}
                            onChange={setReinvestmentRate}
                        />

                    </div>

                    {/* Right Column: Results */}
                    <div className="space-y-6 lg:sticky lg:top-8 h-fit">
                        <DistributionCard
                            totalToPartners={distribution.toPartners}
                            totalToCompany={distribution.toCompany + result.capexProvision + result.runwayProvision + result.taxProvision}
                            // Note: "To Company" logic in the prompt implies "Reinvestment" + Deductions? 
                            // Or just the "Reinvestment Fund" part? 
                            // Prompt says: "0% (Arriesgado): Se reparten todo el sobrante." 
                            // "50% Mitad para socios, mitad para fondo de crecimiento."
                            // The distribution logic splits 'netDistributable'. 
                            // 'netDistributable' is AFTER deductions.
                            // So 'To Company' here means the Reinvestment portion of the net.
                            // PLUS the deductions are also technically "Retained by Company" (except Tax which goes to SUNAT).
                            // Display-wise: The 'DistributionCard' shows "Para la Empresa (Reinversión)". 
                            // So let's show just the Reinvestment part 'distribution.toCompany'.
                            // Or should we clarify that Deductions are ALREADY subtracted? 
                            // The Card says "Para la Empresa (Reinversión)", implying the growth fund.
                            // I'll stick to 'distribution.toCompany' which is the explicit reinvestment from net.

                            partnerCount={partnerCount}
                            onPartnerCountChange={setPartnerCount}
                            onRecord={handleRecord}
                        />

                        {/* Summary Mini-Card */}
                        <div className="rounded-xl bg-gray-100 p-4 text-xs text-gray-500 space-y-2">
                            <p className="font-semibold uppercase tracking-wider">Resumen de Retención</p>
                            <div className="flex justify-between">
                                <span>Impuestos (Bloqueado)</span>
                                <span>{new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(result.taxProvision)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Fondo Maniobra (Bloqueado)</span>
                                <span>{new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(result.runwayProvision)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>CAPEX (Bloqueado)</span>
                                <span>{new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(result.capexProvision)}</span>
                            </div>
                            <div className="flex justify-between font-medium text-gray-700 pt-2 border-t border-gray-200">
                                <span>Total Retenido en Caja</span>
                                <span>{new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(result.taxProvision + result.runwayProvision + result.capexProvision + distribution.toCompany)}</span>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
