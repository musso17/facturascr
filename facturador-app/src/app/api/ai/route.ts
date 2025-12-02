import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIExpenseSummary, AIInvoiceSummary } from '@/lib/ai-context';
import {
  asLocalDate,
  round,
  ProjectionBaseline,
  FinancialMetrics,
  buildMonthlyAggregates,
  calculateProjectionBaseline,
  calculateFinancialMetrics,
  toMonthKey,
  formatMonthLabel,
  analyzeSeasonality,
  projectIncomeWithSeasonality,
} from '@/lib/accounting-service';

const FALLBACK_API_KEY = 'NO_API_KEY_CONFIGURED';
const API_KEY =
  process.env.GEMINI_API_KEY ?? process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? FALLBACK_API_KEY;
const MODEL_NAME = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const model =
  API_KEY && API_KEY !== 'NO_API_KEY_CONFIGURED'
    ? new GoogleGenerativeAI(API_KEY).getGenerativeModel({
        model: MODEL_NAME,
      })
    : null;

export async function POST(request: NextRequest) {
  console.log('API AI: POST request received.');

  if (!model) {
    console.error('API AI Error: GEMINI_API_KEY not configured.');
    return NextResponse.json(
      { error: 'Configura la variable GEMINI_API_KEY para habilitar la IA.' },
      { status: 500 },
    );
  }

  const payload = (await request.json()) as AIRequestPayload;
  console.log('API AI: Payload received.', { mode: payload.mode, hasInvoices: (payload.invoices?.length ?? 0) > 0, hasExpenses: (payload.expenses?.length ?? 0) > 0 });
  
  const invoices = payload.invoices ?? [];
  const expenses = payload.expenses ?? [];
  const snapshot = buildFinancialSnapshot(invoices, expenses);
    console.log('API AI: Financial snapshot built.', { totals: snapshot.totals, counts: snapshot.counts });
  
    const monthlyAggregates = buildMonthlyAggregates(invoices, expenses);
      console.log('API AI: Monthly aggregates built.', { numAggregates: monthlyAggregates.length });
    
      const projectionBaseline = calculateProjectionBaseline(monthlyAggregates, snapshot.totals.cobrado);
        console.log('API AI: Projection baseline calculated.', projectionBaseline);
      
        const financialMetrics = calculateFinancialMetrics(projectionBaseline);
        console.log('API AI: Financial metrics calculated.', financialMetrics);
      
        snapshot.projectionBaseline = projectionBaseline;
        snapshot.financialMetrics = financialMetrics;
        console.log('API AI: Snapshot augmented with projection data.');

  try {
    if (payload.mode === 'chat') {
      console.log('API AI: Mode is CHAT. Generating content...');
      const response = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildChatPrompt(snapshot, payload.messages ?? [], payload.question) }],
          },
        ],
      });
      console.log('API AI: Chat content generated.');
      const text = response?.response?.text()?.trim() ?? 'No tengo suficiente información aún.';
      return NextResponse.json({ message: text });
    }

    if (payload.mode === 'insights') {
      console.log('API AI: Mode is INSIGHTS. Generating content...');
      const response = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildInsightsPrompt(snapshot) }],
          },
        ],
      });
      console.log('API AI: Insights content generated.');
      const parsed = parseStructuredResponse(response?.response?.text());
      return NextResponse.json(parsed ?? defaultInsightResponse());
    }

    if (payload.mode === 'projection') {
      console.log('API AI: Mode is PROJECTION. Generating content...');
      console.log('API AI: monthlyAggregates count:', monthlyAggregates.length);
      console.log('API AI: projectionBaseline:', JSON.stringify(projectionBaseline, null, 2));
      
      const response = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildProjectionPrompt(snapshot, payload.prompt) }],
          },
        ],
      });
      const rawText = response?.response?.text()?.trim() ?? '{}';
      console.log('API AI: Raw Gemini Projection Response:', rawText);
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        
        // INTELLIGENT PATTERN RECOGNITION: Replace AI-generated pnl_projection with seasonality-aware projection
        try {
          // Generate income projection using historical seasonality pattern
          const baselineIncome = projectionBaseline?.ingresosPromedioRecurrentes ?? 0;
          console.log('API AI: Generating seasonality projection with baseline income:', baselineIncome);
          console.log('API AI: monthlyAggregates for seasonality:', monthlyAggregates.length);
          
          if (monthlyAggregates.length === 0) {
            console.warn('API AI: No historical data available, using fallback projection');
            // Fallback: create default projection if no history
            parsed.pnl_projection = [];
            for (let i = 0; i < 12; i++) {
              const futureDate = new Date();
              futureDate.setMonth(futureDate.getMonth() + i + 1);
              const year = futureDate.getFullYear();
              const month = String(futureDate.getMonth() + 1).padStart(2, '0');
              const monthKey = `${year}-${month}`;
              
              parsed.pnl_projection.push({
                mes: monthKey,
                ventas_devengado: baselineIncome,
                costos_variables: baselineIncome * (projectionBaseline?.tasaCostoVariable ?? 0),
                costos_fijos: projectionBaseline?.costosFijosReales ?? 0,
                utilidad_operativa: baselineIncome - (baselineIncome * (projectionBaseline?.tasaCostoVariable ?? 0)) - (projectionBaseline?.costosFijosReales ?? 0),
              });
            }
          } else {
            const seasonalityProjection = projectIncomeWithSeasonality(
              monthlyAggregates,
              baselineIncome,
              12, // Project 12 months forward
              1.0 // No automatic growth factor (user can specify in growth_strategy)
            );

            console.log('API AI: Seasonality projection generated with', seasonalityProjection.length, 'months');

            // Build pnl_projection with historical seasonality pattern
            parsed.pnl_projection = seasonalityProjection.map((proj) => {
              const costosFijos = projectionBaseline?.costosFijosReales ?? 0;
              const tasaCostoVar = projectionBaseline?.tasaCostoVariable ?? 0;
              const costoVar = proj.projectedIncome * tasaCostoVar;
              const utilidad = proj.projectedIncome - costoVar - costosFijos;

              return {
                mes: proj.month,
                ventas_devengado: proj.projectedIncome,
                costos_variables: costoVar,
                costos_fijos: costosFijos,
                utilidad_operativa: utilidad,
              };
            });
          }

          console.log('API AI: pnl_projection generated with seasonality analysis.');
        } catch (seasonalityErr) {
          console.error('Failed to apply seasonality projection', seasonalityErr);
          // Fallback: build from monthlyAggregates
          if (monthlyAggregates.length > 0) {
            parsed.pnl_projection = monthlyAggregates.map((m) => ({
              mes: m.month,
              ventas_devengado: m.income,
              costos_variables: m.variableExpenses,
              costos_fijos: m.fixedExpenses,
              utilidad_operativa: m.income - (m.fixedExpenses + m.variableExpenses),
            }));
          } else {
            // Emergency fallback
            parsed.pnl_projection = [];
          }
        }

        // Ensure cashflow_projection exists
        try {
          if (!parsed.cashflow_projection || !Array.isArray(parsed.cashflow_projection)) {
            // Build from pnl_projection
            let runningCash = projectionBaseline?.saldoCajaActual ?? 0;
            parsed.cashflow_projection = (parsed.pnl_projection || []).map((pnl: any) => {
              const netFlow = pnl.utilidad_operativa ?? 0;
              runningCash += netFlow;
              return {
                mes: pnl.mes,
                ingresos_percibidos: pnl.ventas_devengado ?? 0,
                egresos_totales: (pnl.costos_variables ?? 0) + (pnl.costos_fijos ?? 0),
                flujo_de_caja_neto: netFlow,
                saldo_caja_final: runningCash,
              };
            });
          }
        } catch (cfErr) {
          console.error('Failed to ensure cashflow_projection structure', cfErr);
        }

        if (parsed.analysis && typeof parsed.analysis.growth_strategy === 'string') {
          parsed.analysis.growth_strategy = parsed.analysis.growth_strategy
            .split('\n')
            .filter((s: string) => s.trim().length > 0);
        }
        return NextResponse.json(parsed);
      } catch (e) {
        console.error('Failed to parse projection response from Gemini', e);
        return NextResponse.json(
          { error: 'No se pudo interpretar la respuesta del AI.' },
          { status: 500 },
        );
      }
    }

    console.error('API AI Error: Unsupported mode received.', payload.mode);
    return NextResponse.json({ error: 'Modo no soportado.' }, { status: 400 });
  } catch (error: unknown) {
    console.error(error);
    console.error('API AI General Error:', error);
    const message =
      payload.mode === 'insights'
        ? 'No se pudieron generar los insights.'
        : payload.mode === 'projection'
          ? 'No se pudo generar la proyección.'
          : 'No se pudo responder la consulta.';
    const debug = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message, debug }, { status: 500 });
  }
}

interface AIRequestPayload {
  mode: 'chat' | 'insights' | 'projection';
  question?: string;
  prompt?: string;
  invoices?: AIInvoiceSummary[];
  expenses?: AIExpenseSummary[];
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface FinancialSnapshot {
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

function buildFinancialSnapshot(
  invoices: AIInvoiceSummary[],
  expenses: AIExpenseSummary[],
): FinancialSnapshot {
  const totals = {
    facturado: 0,
    cobrado: 0,
    pendiente: 0,
    vencido: 0,
    gastos: 0,
    utilidad: 0,
  };
  const counts = {
    invoices: invoices.length,
    expenses: expenses.length,
    pendientes: invoices.filter((invoice) => invoice.status !== 'Pagado').length,
  };
  const monthlyMap = new Map<string, { income: number; expenses: number }>();
  const clientMap = new Map<string, { total: number; pending: number }>();
  const expenseCategoryMap = new Map<string, number>();
  const providerMap = new Map<string, number>();
  const overdue: FinancialSnapshot['overdue'] = [];
  const upcoming: FinancialSnapshot['upcoming'] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  invoices.forEach((invoice) => {
    totals.facturado += invoice.total;
    totals.cobrado += invoice.paid;
    totals.pendiente += Math.max(invoice.balance, 0);
    if (invoice.status === 'Vencido') {
      totals.vencido += Math.max(invoice.balance, 0);
    }
    const monthKey = toMonthKey(invoice.issueDate);
    const monthEntry = monthlyMap.get(monthKey) ?? { income: 0, expenses: 0 };
    monthEntry.income += invoice.total;
    monthlyMap.set(monthKey, monthEntry);

    const clientEntry = clientMap.get(invoice.client) ?? { total: 0, pending: 0 };
    clientEntry.total += invoice.total;
    clientEntry.pending += Math.max(invoice.balance, 0);
    clientMap.set(invoice.client, clientEntry);

    const due = asLocalDate(invoice.dueDate);
    const diffDays = Math.round((due.getTime() - today.getTime()) / DAY_IN_MS);
    if (invoice.status !== 'Pagado' && due < today) {
      overdue.push({
        id: invoice.id,
        client: invoice.client,
        balance: Math.max(invoice.balance, 0),
        daysOverdue: Math.abs(diffDays),
      });
    } else if (invoice.status !== 'Pagado' && due >= today && due <= nextWeek) {
      upcoming.push({
        id: invoice.id,
        client: invoice.client,
        balance: Math.max(invoice.balance, 0),
        dueInDays: diffDays,
      });
    }
  });

  expenses.forEach((expense) => {
    totals.gastos += expense.totalAmount;
    const monthKey = toMonthKey(expense.issueDate);
    const monthEntry = monthlyMap.get(monthKey) ?? { income: 0, expenses: 0 };
    monthEntry.expenses += expense.totalAmount;
    monthlyMap.set(monthKey, monthEntry);

    const catTotal = expenseCategoryMap.get(expense.category) ?? 0;
    expenseCategoryMap.set(expense.category, catTotal + expense.totalAmount);

    const providerTotal = providerMap.get(expense.providerName) ?? 0;
    providerMap.set(expense.providerName, providerTotal + expense.totalAmount);
  });

  totals.utilidad = totals.cobrado - totals.gastos;

  const monthlyPerformance = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, data]) => ({
      month,
      label: formatMonthLabel(month),
      income: round(data.income),
      expenses: round(data.expenses),
      profit: round(data.income - data.expenses),
    }));

  const last = monthlyPerformance.at(-1);
  const prev = monthlyPerformance.length > 1 ? monthlyPerformance.at(-2) : undefined;

  const clientRanking = Array.from(clientMap.entries())
    .map(([client, values]) => ({ client, total: round(values.total), pending: round(values.pending) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const expenseCategories = Array.from(expenseCategoryMap.entries())
    .map(([category, amount]) => ({
      category,
      total: round(amount),
      share: totals.gastos > 0 ? round((amount / totals.gastos) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const providerRanking = Array.from(providerMap.entries())
    .map(([provider, amount]) => ({ provider, total: round(amount) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const largestInvoice =
    invoices.length > 0
      ? [...invoices].sort((a, b) => b.total - a.total)[0]
      : null;

  const newestInvoice =
    invoices.length > 0
      ? [...invoices].sort((a, b) => (a.issueDate > b.issueDate ? -1 : 1))[0]
      : null;

  const largestExpense =
    expenses.length > 0
      ? [...expenses].sort((a, b) => b.totalAmount - a.totalAmount)[0]
      : null;

  return {
    totals,
    counts,
    monthlyPerformance,
    clientRanking,
    expenseCategories,
    providerRanking,
    overdue: overdue.slice(0, 8),
    upcoming: upcoming.slice(0, 8),
    highlights: {
      largestInvoice,
      largestExpense,
      newestInvoice,
    },
    momentum: {
      incomeChange: percentChange(last?.income ?? 0, prev?.income ?? 0),
      expenseChange: percentChange(last?.expenses ?? 0, prev?.expenses ?? 0),
      latestMonth: last?.label,
      previousMonth: prev?.label,
    },
    samples: {
      invoices: invoices.slice(0, 25),
      expenses: expenses.slice(0, 25),
    },
  };
}

function buildChatPrompt(
  snapshot: FinancialSnapshot,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  question?: string | null,
) {
  const history = messages
    .slice(-6)
    .map((message) => `${message.role === 'user' ? 'Usuario' : 'Asistente'}: ${message.content}`)
    .join('\n');

  const currentQuestion = question ?? messages.at(-1)?.content ?? '';

  return [
    'Eres un asistente contable virtual peruano, experto en SUNAT y finanzas para pymes.',
    'Tu nombre es Carbon AI y hablas en español latino con tono profesional y cercano.',
    'Debes responder siempre con pasos concretos, explicar supuestos y sugerir acciones (cobrar, pagar, ahorrar).',
    'Si el usuario solicita normativa, explica el concepto y cómo aplicarlo a su negocio.',
    'Cuando no haya datos suficientes, dilo claramente y sugiere qué información se necesita.',
    '',
    'Resumen contable en JSON:',
    JSON.stringify(snapshot, null, 2),
    '',
    'Historial reciente de la conversación:',
    history || 'Sin historial previo.',
    '',
    `Pregunta actual: ${currentQuestion}`,
    '',
    'Responde en máximo 180 palabras y termina con una recomendación accionable.',
  ].join('\n');
}

function buildInsightsPrompt(snapshot: FinancialSnapshot) {
  return [
    'Actúa como un analista financiero senior que interpreta los datos de una empresa peruana.',
    'Debes detectar tendencias, alertas tempranas, comparaciones contra promedio y oportunidades.',
    'Usa porcentajes, montos en PEN y menciona meses cuando ayude a contextualizar.',
    'Devuelve tu respuesta en JSON con la forma:',
    `{
  "headline": "Resumen con máximo 25 palabras",
  "alerts": ["Alerta 1", "Alerta 2"],
  "insights": ["Insight 1", "Insight 2"],
  "recommendations": ["Acción 1", "Acción 2"]
}`,
    'Los arreglos deben contener entre 1 y 4 mensajes cada uno.',
    'Resumen contable:',
    JSON.stringify(snapshot, null, 2),
    'Recuerda responder SOLO con JSON válido, sin explicaciones adicionales.',
  ].join('\n');
}

function buildProjectionPrompt(snapshot: FinancialSnapshot, prompt?: string) {
  return [
    '# ROL: Consultor Senior en Economía y Estrategia de Negocios (Growth Architect)',
    '### PERFIL',
    'Actúa como un experto híbrido con dos facetas clave:',
    '1. **El Economista Riguroso:** Obsesionado con los datos, el flujo de caja, los márgenes operativos, la economía de escala y los modelos de proyección financiera.',
    '2. **El Empresario Veterano:** Pragmático, enfocado en la ejecución, la eficiencia operativa y la rentabilidad real (no métricas de vanidad).',
    '',
    '### TU MISIÓN',
    'Tu objetivo es auditar mis ideas de negocio, ayudarme a construir proyecciones financieras sólidas y diseñar hojas de ruta para el crecimiento escalable. No estás aquí para motivarme, estás aquí para asegurar que mi negocio sobreviva y prospere.',
    '',
    '### CONCEPTOS CLAVE A APLICAR (NO NEGOCIABLES)',
    '1. **P&L vs. Flujo de Caja:** Distingue siempre entre Ventas (Devengado) y Caja (Percibido). La proyección debe reflejar el "hueco financiero" por días de crédito. Asume un promedio de días de crédito si no se provee explícitamente.',
    '2. **Stress Testing (Triángulo de Escenarios):** Genera tres escenarios (Base/Realista, Pesimista, Optimista) para el total anual. El pesimista debe ser un "break-it test" (ej. cliente principal reduce 50%).',
    '3. **Capacidad Instalada:** Si el negocio es de servicios, basa la proyección de ingresos en horas-hombre disponibles, una tasa de ocupación realista (70-80%), y un precio por hora.',
    '   Para esta proyección, considera:',
    '   - Número de Empleados (Full-time equivalentes): 3 (Edson, Mauricio, y el usuario).',
    '   - Tarifa Promedio por Hora (PEN): 100 (S/100).',
    '   No asumas que la demanda es infinita. Calcula el "Techo de Facturación Actual" basado en estas cifras.',
    `4. **Costos Ocultos y "Cisnes Negros":** Incluye un "Colchón de seguridad" del 5-10% de los gastos fijos en tus proyecciones. Considera estacionalidad (B2B es lento en Ene/Feb).`,
    '',
    '### MÉTRICAS FINANCIERAS CLAVE (PRE-CALCULADAS):',
    `Basado en tus datos históricos de los últimos 6 meses, aquí están las métricas fundamentales para el análisis:`,
    `*   **Costos Fijos Totales (CFT):** S/${snapshot.projectionBaseline?.costosFijosReales?.toFixed(2) ?? 'N/A'} (Promedio mensual real).`,
    `*   **Tasa de Costo Variable (TCV):** ${(snapshot.projectionBaseline?.tasaCostoVariable ?? 0).toFixed(2)} (${((snapshot.projectionBaseline?.tasaCostoVariable ?? 0) * 100).toFixed(2)}% de las ventas).`,
    `*   **Punto de Equilibrio (PE) Mensual:** S/${snapshot.financialMetrics?.puntoEquilibrio?.toFixed(2) ?? 'N/A'}. Si tus ventas mensuales son inferiores a este valor, estarás operando con pérdidas.`,
    `*   **Runway de Caja:** ${
      (snapshot.financialMetrics?.runway ?? Infinity) === Infinity
        ? 'Ilimitado (o no aplica por flujo positivo)'
        : `${snapshot.financialMetrics?.runway?.toFixed(2)} meses`
    }. Tiempo que tu negocio puede operar con el saldo de caja actual, manteniendo los gastos promedio y sin ingresos adicionales.`,
    '',
    '### FORMATO DE RESPUESTA (JSON ESTRICTO)',
    'Debes responder en formato JSON. Tu respuesta debe ser un objeto JSON con la siguiente estructura:',
    '{',
    '  "pnl_projection": [{ "mes": "YYYY-MM", "ventas_devengado": number, "costos_variables": number, "costos_fijos": number, "utilidad_operativa": number }],',
    '  "cashflow_projection": [{ "mes": "YYYY-MM", "ingresos_percibidos": number, "egresos_totales": number, "flujo_de_caja_neto": number, "saldo_caja_final": number }],',
  '  "analysis": {',
  '    "break_even_point": { "valor_mensual": number (en PEN), "analisis": "Análisis sobre el punto de equilibrio." },',
  '    "capacity_analysis": { "ingresos_max_mensual": number, "analisis": "Análisis de capacidad instalada." },',
  '    "scenarios": {',
  '      "pesimista": { "utilidad_anual": number, "sobrevive": boolean, "analisis": "Análisis del escenario pesimista." },',
  '      "realista": { "utilidad_anual": number, "analisis": "Análisis del escenario realista." },',
  '      "optimista": { "utilidad_anual": number, "analisis": "Análisis del escenario optimista." }',
  '    },',
  '    "growth_strategy": ["Paso táctico 1", "Paso táctico 2", "Paso táctico 3"]',
  '  }',
  '}',
    '',
    '### DATOS DISPONIBLES',
    'Resumen contable en JSON:',
    JSON.stringify(snapshot, null, 2),
    '',
    `### INSTRUCCIÓN DEL USUARIO`,
    `Prompt: ${prompt ?? 'Realiza un análisis exhaustivo y una proyección a 12 meses.'}`,
    'Recuerda responder SOLO con JSON válido, sin explicaciones adicionales.',
  ].join('\n');
}

function parseStructuredResponse(raw?: string | null) {
  if (!raw) return null;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      headline: String(parsed.headline ?? ''),
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts.map(String) : [],
      insights: Array.isArray(parsed.insights) ? parsed.insights.map(String) : [],
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.map(String)
        : [],
    };
  } catch (error) {
    console.error('No se pudo parsear la respuesta de Gemini', error);
    return null;
  }
}

function defaultInsightResponse() {
  return {
    headline: 'Aún no hay suficiente información contable para detectar tendencias.',
    alerts: [],
    insights: ['Registra tus primeras facturas y egresos para activar el análisis automático.'],
    recommendations: ['Carga ventas y gastos históricos para generar comparativas.'],
  };
}

function percentChange(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return round(((current - previous) / previous) * 100);
}
