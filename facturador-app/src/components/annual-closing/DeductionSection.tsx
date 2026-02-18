
import { AlertTriangle, ShieldCheck, Wallet } from 'lucide-react';
// import { formatCurrency } from '@/lib/utils'; // Keep local for speed/simplicity as before
const currencyFormatter = new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2,
});
function formatMoney(amount: number) {
    return currencyFormatter.format(amount);
}

interface DeductionSectionProps {
    taxRate: number;
    onTaxRateChange: (val: number) => void;
    taxAmount: number;

    monthsOfRunway: number;
    onRunwayChange: (val: number) => void;
    monthlyBurnRate: number;
    onManualBurnRateChange: (val: number) => void;
    runwayAmount: number;

    capexRate: number;
    onCapexRateChange: (val: number) => void;
    capexAmount: number;
}

export function DeductionSection({
    taxRate,
    onTaxRateChange,
    taxAmount,
    monthsOfRunway,
    onRunwayChange,
    monthlyBurnRate,
    onManualBurnRateChange,
    runwayAmount,
    capexRate,
    onCapexRateChange,
    capexAmount,
}: DeductionSectionProps) {
    return (
        <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Filtros de Seguridad</h3>

            {/* 1. Tax Provision */}
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <div className="flex items-start gap-3">
                    <div className="bg-blue-100 rounded-lg p-2 text-blue-600">
                        <Wallet className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="font-semibold text-blue-900">Impuesto a la Renta</h4>
                            <span className="font-bold text-blue-700">- {formatMoney(taxAmount)}</span>
                        </div>
                        <p className="text-xs text-blue-700 mb-3">
                            Provisión estimada para pago anual.
                        </p>
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-medium text-blue-800">Tasa:</label>
                            <select
                                value={taxRate}
                                onChange={(e) => onTaxRateChange(Number(e.target.value))}
                                className="text-xs rounded border-blue-200 bg-white py-1 pl-2 pr-6"
                            >
                                <option value="1">1% (RER / Especial)</option>
                                <option value="1.5">1.5% (MYPE Mensual)</option>
                                <option value="10">10% (MYPE Anual Tramo 1)</option>
                                <option value="29.5">29.5% (General)</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. Runway / Fondo de Maniobra */}
            <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
                <div className="flex items-start gap-3">
                    <div className="bg-amber-100 rounded-lg p-2 text-amber-600">
                        <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="font-semibold text-amber-900">Fondo de Maniobra</h4>
                            <span className="font-bold text-amber-700">- {formatMoney(runwayAmount)}</span>
                        </div>
                        <p className="text-xs text-amber-700 mb-3">
                            Colchón de seguridad para {monthsOfRunway} {monthsOfRunway === 1 ? 'mes' : 'meses'} sin ingresos.
                        </p>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-amber-800 mb-1">Meses Cobertura</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="12"
                                    className="w-full text-xs rounded border-amber-200 bg-white px-2 py-1"
                                    value={monthsOfRunway}
                                    onChange={(e) => onRunwayChange(Number(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-amber-800 mb-1">Costo Mensual (Est.)</label>
                                <input
                                    type="number"
                                    className="w-full text-xs rounded border-amber-200 bg-white px-2 py-1"
                                    value={Math.round(monthlyBurnRate)}
                                    onChange={(e) => onManualBurnRateChange(Number(e.target.value))}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 3. CAPEX */}
            <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-4">
                <div className="flex items-start gap-3">
                    <div className="bg-purple-100 rounded-lg p-2 text-purple-600">
                        <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="font-semibold text-purple-900">Inversión / CAPEX</h4>
                            <span className="font-bold text-purple-700">- {formatMoney(capexAmount)}</span>
                        </div>
                        <p className="text-xs text-purple-700 mb-3">
                            Fondo para renovación de equipos y nuevos proyectos.
                        </p>
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-medium text-purple-800">Porcentaje:</label>
                            <div className="flex items-center gap-2 w-full max-w-[120px]">
                                <input
                                    type="number"
                                    min="0" max="100"
                                    className="w-full text-xs rounded border-purple-200 bg-white px-2 py-1"
                                    value={capexRate}
                                    onChange={(e) => onCapexRateChange(Number(e.target.value))}
                                />
                                <span className="text-xs text-purple-800">%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    );
}
