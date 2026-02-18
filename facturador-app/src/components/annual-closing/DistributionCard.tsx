
import { Users } from 'lucide-react';

const currencyFormatter = new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2,
});
function formatMoney(amount: number) {
    return currencyFormatter.format(amount);
}

interface DistributionCardProps {
    totalToPartners: number;
    totalToCompany: number;
    partnerCount: number;
    onPartnerCountChange: (val: number) => void;
    onRecord: () => void;
}

export function DistributionCard({
    totalToPartners,
    totalToCompany,
    partnerCount,
    onPartnerCountChange,
    onRecord
}: DistributionCardProps) {

    const perPartner = partnerCount > 0 ? totalToPartners / partnerCount : 0;

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Resultado Final</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                {/* Partner Side */}
                <div className="bg-green-50 rounded-2xl p-6 border border-green-100 text-center">
                    <p className="text-green-800 font-medium text-sm uppercase tracking-wide mb-2">A Repartir (Socios)</p>
                    <p className="text-3xl font-bold text-green-700 mb-4">{formatMoney(totalToPartners)}</p>

                    <div className="flex items-center justify-center gap-2 mb-2">
                        <Users className="h-4 w-4 text-green-600" />
                        <input
                            type="number"
                            min="1"
                            max="10"
                            className="w-12 text-center text-sm font-semibold text-green-800 bg-white border border-green-200 rounded"
                            value={partnerCount}
                            onChange={(e) => onPartnerCountChange(Number(e.target.value))}
                        />
                        <span className="text-sm text-green-700">Socios</span>
                    </div>

                    <div className="border-t border-green-200 pt-3 mt-3">
                        <p className="text-xs text-green-600 mb-1">Cada uno recibe:</p>
                        <p className="text-xl font-bold text-green-800">{formatMoney(perPartner)}</p>
                    </div>
                </div>

                {/* Company Side */}
                <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100 text-center flex flex-col justify-center">
                    <p className="text-blue-800 font-medium text-sm uppercase tracking-wide mb-2">Para la Empresa (Reinversión)</p>
                    <p className="text-3xl font-bold text-blue-700">{formatMoney(totalToCompany)}</p>
                    <p className="text-xs text-blue-600 mt-2">Acumulado para crecimiento en 2026</p>
                </div>
            </div>

            <button
                onClick={onRecord}
                className="w-full flex items-center justify-center rounded-xl bg-gray-900 px-4 py-4 text-base font-semibold text-white transition-all hover:bg-gray-800 active:scale-[0.98]"
            >
                Registrar Retiro de Utilidades
            </button>
            <p className="mt-2 text-center text-xs text-gray-400">
                Esto generará un registro negativo en la caja para iniciar el 2026 limpio.
            </p>
        </div>
    );
}
