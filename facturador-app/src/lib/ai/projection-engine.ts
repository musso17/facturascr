
import {
    ProjectionBaseline,
    FinancialMetrics,
    projectIncomeWithSeasonality,
} from '@/lib/accounting-service';

import type { AIExpenseSummary, AIInvoiceSummary } from '@/lib/ai-context';

export interface FinancialSnapshot {
    totals: {
        facturado: number;
        cobrado: number;
        pendiente: number;
        vencido: number;
        gastos: number;
        utilidad: number;
    };
    counts: {
        invoices: number;
        expenses: number;
        pendientes: number;
    };
    monthlyPerformance: Array<{
        month: string;
        label: string;
        income: number;
        expenses: number;
        profit: number;
    }>;
    clientRanking: Array<{ client: string; total: number; pending: number }>;
    expenseCategories: Array<{ category: string; total: number; share: number }>;
    providerRanking: Array<{ provider: string; total: number }>;
    overdue: Array<{ id: string; client: string; balance: number; daysOverdue: number }>;
    upcoming: Array<{ id: string; client: string; balance: number; dueInDays: number }>;
    highlights: {
        largestInvoice?: AIInvoiceSummary | null;
        largestExpense?: AIExpenseSummary | null;
        newestInvoice?: AIInvoiceSummary | null;
    };
    momentum: {
        incomeChange: number;
        expenseChange: number;
        latestMonth?: string;
        previousMonth?: string;
    };
    samples: {
        invoices: AIInvoiceSummary[];
        expenses: AIExpenseSummary[];
    };
    projectionBaseline?: ProjectionBaseline;
    financialMetrics?: FinancialMetrics;
}

export function buildProjectionPrompt(
    snapshot: FinancialSnapshot,
    userPrompt?: string,
    rates?: { optimistic: number; pessimistic: number }
) {
    const { totals, projectionBaseline, financialMetrics } = snapshot;
    const optRate = rates?.optimistic ?? 30;
    const pesRate = rates?.pessimistic ?? 30;

    return `
    Actúa como un CFO experto y genera una proyección financiera detallada para mi negocio.
    Analiza los siguientes datos actuales:

    1. ESTADO ACTUAL (Snapshot):
    - Facturación Total: ${totals.facturado}
    - Cobrado Real: ${totals.cobrado}
    - Por Cobrar (Pendiente): ${totals.pendiente}
    - Gastos Totales: ${totals.gastos}
    - Utilidad Actual: ${totals.utilidad}

    2. LÍNEA BASE PARA PROYECCIÓN (Cálculo Automático):
    - Ingresos Recurrentes Promedio: ${projectionBaseline?.ingresosPromedioRecurrentes}
    - Costos Fijos Reales (Promedio): ${projectionBaseline?.costosFijosReales}
    - Tasa de Costo Variable (sobre ventas): ${projectionBaseline?.tasaCostoVariable}
    - Saldo de Caja Actual: ${projectionBaseline?.saldoCajaActual}

    3. METRICAS CLAVE:
    - Punto de Equilibrio: ${financialMetrics?.puntoEquilibrio}
    - Runway (Meses): ${financialMetrics?.runway}

    ${userPrompt ? `PREGUNTA ESPECÍFICA DEL USUARIO: "${userPrompt}"\nConsidera esto en tu análisis.` : ''}

    TU TAREA:
    Genera un objeto JSON con la siguiente estructura exacta (sin markdown, solo JSON):

    {
      "pnl_projection": [
        { "mes": "YYYY-MM", "ventas_devengado": number, "costos_variables": number, "costos_fijos": number, "utilidad_operativa": number }
      ],
      "cashflow_projection": [
        { "mes": "YYYY-MM", "ingresos_percibidos": number, "egresos_totales": number, "flujo_de_caja_neto": number, "saldo_caja_final": number }
      ],
      "analysis": {
        "break_even_point": { "valor_mensual": number, "analisis": "string corto" },
        "capacity_analysis": { "ingresos_max_mensual": number, "analisis": "string corto" },
        "scenarios": {
          "pesimista": { "utilidad_anual": number, "sobrevive": boolean, "analisis": "string corto" },
          "realista": { "utilidad_anual": number, "sobrevive": boolean, "analisis": "string corto" },
          "optimista": { "utilidad_anual": number, "sobrevive": boolean, "analisis": "string corto" }
        },
        "growth_strategy": ["string", "string", "string"]
      }
    }

    REGLAS:
    - Proyecta 12 meses a futuro.
    - Usa la estacionalidad lógica del negocio si detectas patrones en los datos provistos.
    - Sé realista con los costos variables.
    - En "cashflow_projection", asume un lag de cobro realista si hay mucha deuda pendiente.
    - "saldo_caja_final" debe ser acumulativo partiendo del saldoCajaActual.
    - Escenario PESIMISTA: Asume una caída de ventas del ${pesRate}%.
    - Escenario OPTIMISTA: Asume un crecimiento de ventas del ${optRate}%.
  `;
}

/**
 * Generates a deterministic projection based on accounting rules when AI is unavailable
 */
export function generateFallbackByRuleEngine(
    baseline: ProjectionBaseline,
    monthlyAggregates: any[],
    metrics?: FinancialMetrics,
    rates?: { optimistic: number; pessimistic: number }
) {
    const { ingresosPromedioRecurrentes, costosFijosReales, tasaCostoVariable, saldoCajaActual } = baseline;
    const optRate = (rates?.optimistic ?? 30) / 100;
    const pesRate = (rates?.pessimistic ?? 30) / 100;

    // 1. Generate P&L Projection (Linear + Seasonality)
    let pnl_projection: any[] = [];

    if (monthlyAggregates.length > 0) {
        const seasonalityProjection = projectIncomeWithSeasonality(
            monthlyAggregates,
            ingresosPromedioRecurrentes,
            12,
            1.0 // Flat growth in fallback
        );

        pnl_projection = seasonalityProjection.map((proj) => {
            const costoVar = proj.projectedIncome * tasaCostoVariable;
            const utilidad = proj.projectedIncome - costoVar - costosFijosReales;
            return {
                mes: proj.month,
                ventas_devengado: proj.projectedIncome,
                costos_variables: costoVar,
                costos_fijos: costosFijosReales,
                utilidad_operativa: utilidad,
            };
        });
    } else {
        // Zero-data fallback
        for (let i = 0; i < 12; i++) {
            const futureDate = new Date();
            futureDate.setMonth(futureDate.getMonth() + i + 1);
            const year = futureDate.getFullYear();
            const month = String(futureDate.getMonth() + 1).padStart(2, '0');
            const monthKey = `${year}-${month}`;

            pnl_projection.push({
                mes: monthKey,
                ventas_devengado: ingresosPromedioRecurrentes,
                costos_variables: ingresosPromedioRecurrentes * tasaCostoVariable,
                costos_fijos: costosFijosReales,
                utilidad_operativa: ingresosPromedioRecurrentes - (ingresosPromedioRecurrentes * tasaCostoVariable) - costosFijosReales,
            });
        }
    }

    // 2. Derive Cashflow
    let runningCash = saldoCajaActual;
    const cashflow_projection = pnl_projection.map((pnl) => {
        // Simple assumption: Cashflow Net = Operating Profit (ignoring payment delays in fallback)
        const netFlow = pnl.utilidad_operativa;
        runningCash += netFlow;

        return {
            mes: pnl.mes,
            ingresos_percibidos: pnl.ventas_devengado,
            egresos_totales: pnl.costos_variables + pnl.costos_fijos,
            flujo_de_caja_neto: netFlow,
            saldo_caja_final: runningCash,
        };
    });

    // 3. Generate Static Analysis
    // Calculate annual utility for scenarios
    const baseAnnualUtility = pnl_projection.reduce((sum, m) => sum + m.utilidad_operativa, 0);

    const analysis = {
        break_even_point: {
            valor_mensual: metrics?.puntoEquilibrio ?? 0,
            analisis: `Tu punto de equilibrio calculado es S/ ${(metrics?.puntoEquilibrio ?? 0).toLocaleString()}. Ventas inferiores a este monto generarán pérdidas.`,
        },
        capacity_analysis: {
            ingresos_max_mensual: ingresosPromedioRecurrentes * 1.5, // Heuristic: 50% more than average
            analisis: "Basado en tu histórico, tu capacidad operativa parece estable. Para crecer más, considera contratar o automatizar.",
        },
        scenarios: {
            pesimista: {
                utilidad_anual: baseAnnualUtility * (1 - pesRate),
                sobrevive: saldoCajaActual > Math.abs(Math.min(0, baseAnnualUtility * (1 - pesRate))),
                analisis: `En un escenario de contracción severa (caída del ${(pesRate * 100).toFixed(0)}%), cuida tu caja y reduce gastos fijos innecesarios.`,
            },
            realista: {
                utilidad_anual: baseAnnualUtility,
                analisis: "Proyección basada en tu tendencia actual (crecimiento plano). Mantén la disciplina financiera.",
            },
            optimista: {
                utilidad_anual: baseAnnualUtility * (1 + optRate),
                analisis: `Si logras aumentar ventas un ${(optRate * 100).toFixed(0)}%, reinvierte este excedente en marketing o equipo.`,
            },
        },
        growth_strategy: [
            "Optimiza tus Costos Fijos: Revisa suscripciones y gastos recurrentes.",
            "Cuida el Flujo de Caja: Asegura que los clientes paguen a tiempo para evitar huecos de liquidez.",
            "Diversifica Ingresos: No dependas de pocos clientes grandes.",
        ],
    };

    return {
        pnl_projection,
        cashflow_projection,
        analysis,
        isFallback: true,
    };
}

export function buildChatPrompt(
    snapshot: FinancialSnapshot,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    question?: string | null,
) {
    const history = messages
        .slice(-6)
        .map((message) => `${message.role === 'user' ? 'Usuario' : 'Asistente'}: ${message.content}`)
        .join('\n');

    return `
    Actúa como un analista financiero experto. Tienes acceso a los siguientes datos del negocio:
    
    RESUMEN FINANCIERO:
    - Facturado Total: ${snapshot.totals.facturado}
    - Cobrado: ${snapshot.totals.cobrado}
    - Por Cobrar: ${snapshot.totals.pendiente}
    - Vencido: ${snapshot.totals.vencido}
    - Gastos: ${snapshot.totals.gastos}
    - Utilidad Neta: ${snapshot.totals.utilidad}

    CLIENTES TOP:
    ${snapshot.clientRanking.map(c => `- ${c.client}: Facturado ${c.total}, Debe ${c.pending}`).join('\n')}

    GASTOS TOP:
    ${snapshot.expenseCategories.map(c => `- ${c.category}: ${c.total} (${c.share}%)`).join('\n')}

    TENDENCIA RECIENTE:
    - Cambio en Ingresos: ${snapshot.momentum.incomeChange}% vs mes anterior
    - Cambio en Gastos: ${snapshot.momentum.expenseChange}% vs mes anterior

    HISTORIAL DE CHAT:
    ${history}

    PREGUNTA ACTUAL: "${question}"

    Responde de manera concisa, profesional y basada estrictamente en los datos provistos. Si te preguntan algo fuera de estos datos, indica que no tienes esa información.
  `;
}

export function buildInsightsPrompt(snapshot: FinancialSnapshot) {
    return `
    Analiza este estado financiero y genera 3 insights clave y 3 recomendaciones accionables.
    
    DATOS:
    - Utilidad Neta: ${snapshot.totals.utilidad}
    - Margen: ${snapshot.totals.cobrado > 0 ? ((snapshot.totals.utilidad / snapshot.totals.cobrado) * 100).toFixed(1) : 0}%
    - Deuda Vencida: ${snapshot.totals.vencido}
    - Top Gasto: ${snapshot.expenseCategories[0]?.category} (${snapshot.expenseCategories[0]?.share}%)
    - Tendencia Ingresos: ${snapshot.momentum.incomeChange}%
    
    Formato JSON requerido:
    {
      "insights": [
        { "title": "string", "description": "string", "type": "positive" | "negative" | "neutral", "metric": "string" }
      ],
      "recommendations": [
        { "title": "string", "description": "string", "priority": "high" | "medium" | "low", "impact": "string" }
      ]
    }
  `;
}

export function parseStructuredResponse(text?: string) {
    if (!text) return null;
    try {
        const clean = text.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        console.error('Failed to parse AI response', e);
        return null;
    }
}

export function defaultInsightResponse() {
    return {
        insights: [
            {
                title: 'Análisis no disponible',
                description: 'No se pudieron generar insights automáticos en este momento.',
                type: 'neutral',
                metric: 'N/A',
            },
        ],
        recommendations: [],
    };
}

