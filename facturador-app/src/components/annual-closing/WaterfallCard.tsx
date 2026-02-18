

// I'll check lib/utils existence later, for now I'll use Intl directly or copy the one from page.tsx style.
// Actually page.tsx defined it locally. I should probably move it to a shared place, but to avoid refactoring noise I'll define a simple one here.

const currencyFormatter = new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2,
});

function formatMoney(amount: number) {
    return currencyFormatter.format(amount);
}

interface WaterfallCardProps {
    totalInvoiced: number;
    totalCollected: number;
    totalExpenses: number;
    operationalCashFlow: number;
}

export function WaterfallCard({
    totalInvoiced,
    totalCollected,
    totalExpenses,
    operationalCashFlow,
}: WaterfallCardProps) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Flujo de Caja Operativo</h3>

            <div className="space-y-3 text-sm">
                {/* Helper / Reference row */}
                <div className="flex justify-between text-gray-400">
                    <span>Facturado (Ref)</span>
                    <span>{formatMoney(totalInvoiced)}</span>
                </div>

                <div className="flex justify-between font-medium text-gray-700">
                    <span>(+) Total Cobrado</span>
                    <span className="text-green-600 font-semibold">{formatMoney(totalCollected)}</span>
                </div>

                <div className="flex justify-between font-medium text-gray-700">
                    <span>(-) Egresos Ejecutados</span>
                    <span className="text-red-500">{formatMoney(totalExpenses)}</span>
                </div>

                <div className="my-2 h-px bg-gray-200" />

                <div className="flex justify-between text-base font-bold text-gray-900">
                    <span>(=) Flujo de Caja</span>
                    <span>{formatMoney(operationalCashFlow)}</span>
                </div>
            </div>
        </div>
    );
}
