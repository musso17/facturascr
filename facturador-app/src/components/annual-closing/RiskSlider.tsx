
interface RiskSliderProps {
    value: number; // 0 to 100
    onChange: (value: number) => void;
}

export function RiskSlider({ value, onChange }: RiskSliderProps) {

    const getLabel = (val: number) => {
        if (val < 33) return 'Arriesgado';
        if (val < 66) return 'Equilibrado';
        return 'Conservador';
    };

    const getColor = (val: number) => {
        if (val < 33) return 'accent-red-500'; // Or generic
        if (val < 66) return 'accent-blue-500';
        return 'accent-green-500'; // Wait, standard slider styling might be tricky with accent.
        // Tailwind 'accent-' works for generic range inputs.
    };

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Nivel de Reinversión</h3>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
                    {value}% &rarr; {getLabel(value)}
                </span>
            </div>

            <p className="mb-6 text-sm text-gray-500">
                Define cuánto dinero se queda en la empresa para crecimiento futuro.
                <br />
                <span className="text-xs text-gray-400">0% = Repartir todo | 50% = Mitad/Mitad | 100% = Ahorrar todo</span>
            </p>

            <div className="relative mb-2">
                <input
                    type="range"
                    min="0"
                    max="100"
                    step="10"
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-blue-600"
                />
                <div className="mt-2 flex justify-between text-xs text-gray-400">
                    <span>0%</span>
                    <span>50%</span>
                    <span>100%</span>
                </div>
            </div>
        </div>
    );
}
