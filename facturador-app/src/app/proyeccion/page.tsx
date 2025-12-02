'use client';

import { useState, useEffect, useCallback, ReactNode } from 'react';
import { useInvoices } from '@/hooks/use-invoices';
import { useExpenses } from '@/hooks/use-expenses';
import {
  BrainCircuit,
  Loader2,
  Zap,
  TrendingUp,
  Scale,
  
  Activity,
  AlertTriangle,
} from 'lucide-react';
import { mapInvoicesForAI, mapExpensesForAI } from '@/lib/ai-context';
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  ComposedChart,
} from 'recharts';

// --- Interfaces for AI Response ---
interface PnlData {
  mes: string;
  ventas_devengado: number;
  costos_variables: number;
  costos_fijos: number;
  utilidad_operativa: number;
}

interface CashflowData {
  mes: string;
  ingresos_percibidos: number;
  egresos_totales: number;
  flujo_de_caja_neto: number;
  saldo_caja_final: number;
}

interface Scenario {
  utilidad_anual: number;
  sobrevive: boolean;
  analisis: string;
}

interface Analysis {
  break_even_point: {
    valor_mensual: number;
    analisis: string;
  };
  capacity_analysis: {
    ingresos_max_mensual: number;
    analisis:string;
  };
  scenarios: {
    pesimista: Scenario;
    realista: Scenario;
    optimista: Scenario;
  };
  growth_strategy: string[];
}

interface ProjectionResponse {
  pnl_projection: PnlData[];
  cashflow_projection: CashflowData[];
  analysis: Analysis;
}

// --- Main Component ---
export default function ProyeccionPage() {
  const { invoices, isLoading: isLoadingInvoices } = useInvoices();
  const { expenses, isLoading: isLoadingExpenses } = useExpenses();
  const [data, setData] = useState<ProjectionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<'pesimista' | 'realista' | 'optimista'>('realista');

  const generateProjection = useCallback(
    async (force: boolean = false) => {
      setIsLoading(true);
      setError(null);

      const dataSignature = `${invoices.length}-${expenses.length}-${invoices.reduce(
        (sum, i) => sum + i.total,
        0,
      )}-${expenses.reduce((sum, e) => sum + e.totalAmount, 0)}`;

      if (!force) {
        const cachedProjection = localStorage.getItem('cachedProjection');
        const cachedSignature = localStorage.getItem('cachedSignature');

        if (cachedProjection && cachedSignature && cachedSignature === dataSignature) {
          setData(JSON.parse(cachedProjection));
          setIsLoading(false);
          return;
        }
      }

      try {
        const response = await fetch('/api/ai', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            mode: 'projection',
            invoices: mapInvoicesForAI(invoices),
            expenses: mapExpensesForAI(expenses),
          }),
        });

        if (!response.ok) {
          throw new Error('Error al generar la proyección. Intenta de nuevo.');
        }

        const responseData: ProjectionResponse = await response.json();
        setData(responseData);
        localStorage.setItem('cachedProjection', JSON.stringify(responseData));
        localStorage.setItem('cachedSignature', dataSignature);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsLoading(false);
      }
    },
    [invoices, expenses],
  );

  useEffect(() => {
    if (!isLoadingInvoices && !isLoadingExpenses) {
      void generateProjection(false);
    }
  }, [isLoadingInvoices, isLoadingExpenses, generateProjection]);

  const showInitialState = !isLoading && !data && !error;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex w-full flex-col gap-8 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-500">
              Análisis con IA
            </p>
            <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">
              Proyección Financiera
            </h1>
            <p className="max-w-3xl text-base text-slate-600">
              Tu Growth Architect personal. Proyecciones, análisis de rentabilidad y estrategias de
              crecimiento basadas en tus datos.
            </p>
          </div>
          <div>
            <button
              onClick={() => generateProjection(true)}
              disabled={isLoading || isLoadingInvoices || isLoadingExpenses}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analizando...
                </span>
              ) : (
                'Forzar Nuevo Análisis'
              )}
            </button>
          </div>
        </header>

        {isLoading && <LoadingState />}
        {error && <ErrorState message={error} />}
        {showInitialState && <InitialState />}

        {!isLoading && data && (
          <div className="space-y-8">
            <PnlChart data={data.pnl_projection} />
            <CashflowChart data={data.cashflow_projection} />
            <AnalysisSection
              analysis={data.analysis}
              selectedScenario={selectedScenario}
              setSelectedScenario={setSelectedScenario}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// --- Child Components ---

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
      <div className="rounded-full bg-teal-100 p-4">
        <BrainCircuit className="h-8 w-8 text-teal-600" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Generando Proyección y Análisis Estratégico</h2>
        <p className="max-w-lg text-sm text-slate-600">
          Tu Growth Architect está auditando tus finanzas. Esto puede tomar unos segundos.
        </p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
      <p className='font-semibold'>Error de Análisis</p>
      <p>{message}</p>
    </div>
  );
}

function InitialState() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center shadow-sm">
      <div className="rounded-full bg-teal-100 p-4">
        <BrainCircuit className="h-8 w-8 text-teal-600" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Listo para tu Análisis Estratégico</h2>
        <p className="max-w-lg text-sm text-slate-600">
          Usa el botón &quot;Forzar Nuevo Análisis&quot; para que tu Growth Architect audite
          tus finanzas.
        </p>
      </div>
    </div>
  );
}

function PnlChart({ data }: { data: PnlData[] }) {
  const processedData = data.map((item) => {
    const totalCosts = item.costos_variables + item.costos_fijos;
    const netProfit = item.ventas_devengado - totalCosts;
    const netMarginPercentage = item.ventas_devengado > 0 ? (netProfit / item.ventas_devengado) * 100 : 0;
    return {
      ...item,
      total_costs: totalCosts,
      net_profit: netProfit,
      net_margin_percentage: netMarginPercentage,
    };
  });

  const formatYAxis = (value: number) => {
    if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
    return value.toString();
  };

  return (
    <ChartCard title="Proyección de Estado de Resultados (P&L)">
      <div style={{ width: '100%', height: '400px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={processedData}
            margin={{
              top: 20,
              right: 30,
              left: 20,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="mes" />
            <YAxis 
              yAxisId="left" 
              orientation="left" 
              stroke="#6B7280"
              tickFormatter={formatYAxis}
              label={{ value: 'S/ (Soles)', angle: -90, position: 'insideLeft', offset: 10 }} 
            />
            <YAxis 
              yAxisId="right" 
              orientation="right" 
              stroke="#6B7280"
              tickFormatter={(value) => `${value}%`} 
              label={{ value: '% Margen Neto', angle: 90, position: 'insideRight', offset: 10 }} 
            />
            <Tooltip 
              formatter={(value: unknown) => {
                if (value === null || value === undefined) return '-';
                const num = typeof value === 'number' ? value : Number(String(value));
                if (Number.isNaN(num)) return String(value);
                return `S/ ${num.toLocaleString()}`;
              }}
              contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px', color: '#F3F4F6' }}
            />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            <Bar yAxisId="left" dataKey="ventas_devengado" fill="#34D399" opacity={0.9} name="Ventas" />
            <Bar yAxisId="left" dataKey="costos_fijos" stackId="costs" fill="#9CA3AF" name="Costos Fijos" />
            <Bar yAxisId="left" dataKey="costos_variables" stackId="costs" fill="#4B5563" name="Costos Variables" />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="net_margin_percentage"
              stroke="#8B5CF6"
              name="% Margen Neto"
              strokeWidth={3}
              dot={{ r: 5, fill: '#FFFFFF', strokeWidth: 2, stroke: '#8B5CF6' }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function CashflowChart({ data, initialCash = 0 }: { data: CashflowData[]; initialCash?: number }) {
  // CRITICAL: Recalculate saldo_caja_final to ensure it matches the KPI
  const correctedData: CashflowData[] = [];
  let runningBalance = initialCash;

  for (const item of data) {
    const netFlow = (item.flujo_de_caja_neto || 0);
    runningBalance += netFlow;
    correctedData.push({
      ...item,
      saldo_caja_final: runningBalance, // Override with correct cumulative balance
    });
  }

  // Calculate runway based on corrected balance
  let runwayMonths = 0;
  let tempBalance = initialCash;
  for (const item of correctedData) {
    tempBalance = item.saldo_caja_final;
    if (tempBalance > 0) {
      runwayMonths++;
    } else {
      break;
    }
  }

  const finalBalance = correctedData.length > 0 ? correctedData[correctedData.length - 1].saldo_caja_final : initialCash;

  const formatYAxis = (value: number) => {
    if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
    if (value <= -1000) return `-${(Math.abs(value) / 1000).toFixed(0)}k`;
    return value.toString();
  };

  const renderCustomLegend = (props: any) => {
    const { payload } = props;
    if (!payload) return null;
    return (
      <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', paddingTop: '16px', flexWrap: 'wrap' }}>
        {payload.map((entry: any, index: number) => (
          <div key={`legend-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div
              style={{
                width: '12px',
                height: '12px',
                backgroundColor: entry.color,
                borderRadius: '2px',
              }}
            />
            <span style={{ fontSize: '12px', color: '#6B7280' }}>{entry.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <ChartCard title="Proyección de Flujo de Caja">
      <div className="flex flex-col w-full gap-0">
        {/* AREA 1: KPIs Header with gap and clear separation */}
        <div className="flex gap-5 mb-6">
          <div className="flex-1 bg-gray-50 rounded-lg border border-slate-200 p-4 relative static">
            <div className="text-xs text-slate-500 font-semibold">RUNWAY</div>
            <div className="text-lg font-bold text-slate-900 mt-2">
              {runwayMonths > 0 ? `${runwayMonths} ${runwayMonths === 1 ? 'mes' : 'meses'}` : 'Sin efectivo'}
            </div>
          </div>
          <div className="flex-1 bg-gray-50 rounded-lg border border-slate-200 p-4 relative static">
            <div className="text-xs text-slate-500 font-semibold">SALDO PROYECTADO</div>
            <div className={`text-lg font-bold mt-2 ${finalBalance < 0 ? 'text-red-600' : 'text-slate-900'}`}>
              {`S/ ${finalBalance.toLocaleString()}`}
            </div>
          </div>
        </div>

        {/* AREA 2: Chart Container with proper height and padding */}
        <div className="w-full" style={{ height: '400px', paddingBottom: '50px', overflow: 'visible' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={correctedData}
              margin={{ top: 5, right: 20, left: 20, bottom: 25 }}
            >
              <defs>
                <linearGradient id="saldoGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#64748B" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#64748B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis dataKey="mes" stroke="#6B7280" />
              <YAxis 
                stroke="#6B7280"
                tickFormatter={formatYAxis}
                label={{ value: 'S/ (Soles)', angle: -90, position: 'insideLeft', offset: 10 }} 
              />
              <Tooltip 
                formatter={(value: unknown) => {
                  if (value === null || value === undefined) return '-';
                  const num = typeof value === 'number' ? value : Number(String(value));
                  if (Number.isNaN(num)) return String(value);
                  return `S/ ${num.toLocaleString()}`;
                }}
                contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px', color: '#F3F4F6' }}
              />
              <Legend content={renderCustomLegend} />
              
              {/* Income Bars (Green) */}
              <Bar 
                dataKey="ingresos_percibidos" 
                fill="#10B981" 
                name="Caja Recibida"
                radius={[4, 4, 0, 0]}
              />
              
              {/* Expense Bars (Red) */}
              <Bar 
                dataKey="egresos_totales" 
                fill="#EF4444" 
                name="Caja Gastada"
                radius={[4, 4, 0, 0]}
              />
              
              {/* Balance Area (Gray Background) */}
              <Area
                type="monotone"
                dataKey="saldo_caja_final"
                fill="url(#saldoGradient)"
                stroke="#475569"
                strokeWidth={2.5}
                name="Saldo en Caja"
                isAnimationActive={false}
                dot={{ r: 3, fill: '#475569', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#475569', strokeWidth: 0 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ChartCard>
  );
}

function AnalysisSection({
  analysis,
  selectedScenario,
  setSelectedScenario,
}: {
  analysis: Analysis;
  selectedScenario: 'pesimista' | 'realista' | 'optimista';
  setSelectedScenario: (scenario: 'pesimista' | 'realista' | 'optimista') => void;
}) {

  return (
    <div className="space-y-8">
      {analysis?.scenarios && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Análisis de Escenarios (Utilidad Anual)</h3>
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => setSelectedScenario('pesimista')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${
                selectedScenario === 'pesimista'
                  ? 'bg-red-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Modo Pánico (Pesimista)
            </button>
            <button
              onClick={() => setSelectedScenario('realista')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${
                selectedScenario === 'realista'
                  ? 'bg-orange-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Modo Carbono (Realista)
            </button>
            <button
              onClick={() => setSelectedScenario('optimista')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${
                selectedScenario === 'optimista'
                  ? 'bg-green-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Modo Expansión (Optimista)
            </button>
          </div>
          {selectedScenario && analysis.scenarios[selectedScenario] && (
            <InfoCard
              title={`Escenario: ${selectedScenario.charAt(0).toUpperCase() + selectedScenario.slice(1)}`}
              icon={
                selectedScenario === 'pesimista'
                  ? <AlertTriangle className="h-6 w-6 text-red-500" />
                  : selectedScenario === 'optimista'
                  ? <TrendingUp className="h-6 w-6 text-green-500" />
                  : <Scale className="h-6 w-6 text-orange-500" />
              }
            >
              <p className="text-3xl font-bold">
                {`s/${(analysis.scenarios[selectedScenario].utilidad_anual || 0).toLocaleString()}`}
                <span className="text-sm font-normal text-slate-500">/año</span>
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {analysis.scenarios[selectedScenario].analisis}
              </p>
              {selectedScenario === 'pesimista' && (
                <p className={`mt-2 text-sm font-semibold ${analysis.scenarios[selectedScenario].sobrevive ? 'text-green-600' : 'text-red-600'}`}>
                  {analysis.scenarios[selectedScenario].sobrevive ? '¡El negocio sobrevive!' : '¡Riesgo de insolvencia!'}
                </p>
              )}
            </InfoCard>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {analysis?.break_even_point && (
          <InfoCard title="Punto de Equilibrio" icon={<Scale className="h-6 w-6 text-amber-600" />}>
            <p className="text-3xl font-bold">
              {`s/${(analysis.break_even_point.valor_mensual || 0).toLocaleString()}`}
              <span className="text-sm font-normal text-slate-500">/mes</span>
            </p>
            <p className="mt-2 text-sm text-slate-600">{analysis.break_even_point.analisis}</p>
          </InfoCard>
        )}
        {analysis?.capacity_analysis && (
          <InfoCard title="Capacidad Máxima" icon={<Activity className="h-6 w-6 text-indigo-600" />}>
            <p className="text-3xl font-bold">
              {`s/${(analysis.capacity_analysis.ingresos_max_mensual || 0).toLocaleString()}`}
              <span className="text-sm font-normal text-slate-500">/mes</span>
            </p>
            <p className="mt-2 text-sm text-slate-600">{analysis.capacity_analysis.analisis}</p>
          </InfoCard>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold">Análisis del Growth Architect</h3>
        <div className="mt-6 grid gap-8">
          {analysis?.scenarios && (
            <AnalysisItem title="Análisis de Escenarios" icon={<AlertTriangle className="h-6 w-6 text-red-500" />}>
              <ul className="mt-2 space-y-2">
                {Object.entries(analysis.scenarios).map(([key, value]) => (
                  <li key={key} className="flex items-start gap-2">
                    <span className="font-semibold capitalize text-sm">{key}:</span>
                    <span className="text-sm text-slate-600">{value.analisis}</span>
                  </li>
                ))}
              </ul>
            </AnalysisItem>
          )}

          {analysis?.growth_strategy && (
            <AnalysisItem title="Estrategia de Crecimiento" icon={<Zap className="h-6 w-6 text-green-500" />}>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-600">
                {Array.isArray(analysis.growth_strategy) ? (
                  analysis.growth_strategy.map((rec, i) => <li key={i}>{rec}</li>)
                ) : (
                  <li>{analysis.growth_strategy}</li>
                )}
              </ul>
            </AnalysisItem>
          )}
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string, children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm mb-10">
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="mt-4">
        {children}
      </div>
    </div>
  );
}

function InfoCard({ title, icon, children }: { title: string, icon: ReactNode, children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm flex gap-6">
      <div className="flex-shrink-0">{icon}</div>
      <div>
        <h4 className="font-semibold text-slate-800">{title}</h4>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

function AnalysisItem({ title, icon, children }: { title: string, icon: ReactNode, children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0">{icon}</div>
      <div>
        <h4 className="font-semibold text-slate-800">{title}</h4>
        {children}
      </div>
    </div>
  );
}
