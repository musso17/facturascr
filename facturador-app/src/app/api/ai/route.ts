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
import {
  buildProjectionPrompt,
  generateFallbackByRuleEngine,
  FinancialSnapshot,
  buildChatPrompt,
  buildInsightsPrompt,
  parseStructuredResponse,
  defaultInsightResponse,
} from '@/lib/ai/projection-engine';

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

      const generateContentWithRetry = async (prompt: string) => {
        let retries = 0;
        const maxRetries = 5;
        const baseDelay = 2000;

        while (true) {
          try {
            return await model.generateContent({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: prompt }],
                },
              ],
            });
          } catch (error: any) {
            if (error?.status === 429 || error?.toString().includes('429')) {
              retries++;
              if (retries > maxRetries) throw error;
              const delay = baseDelay * Math.pow(2, retries - 1);
              console.log(`API AI: Rate limit hit. Retrying in ${delay}ms... (Attempt ${retries}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            throw error;
          }
        }
      };

      const response = await generateContentWithRetry(buildProjectionPrompt(snapshot, payload.prompt, payload.rates));
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
  } catch (error: any) {
    console.error(error);
    console.error('API AI General Error:', error);

    // FALLBACK STRATEGY: If AI fails (Rate Limit or other), generate local projection
    if (payload.mode === 'projection' && snapshot.projectionBaseline) {
      console.warn('API AI: Generating fallback projection due to API error.');
      try {
        const fallbackData = generateFallbackByRuleEngine(snapshot.projectionBaseline, monthlyAggregates, snapshot.financialMetrics, payload.rates);
        return NextResponse.json(fallbackData);
      } catch (fallbackError) {
        console.error('API AI: Fallback generation also failed.', fallbackError);
      }
    }

    if (error?.status === 429 || error?.toString().includes('429')) {
      return NextResponse.json(
        { error: 'El sistema de IA está saturado. Se intentó generar una proyección local pero falló. Por favor intenta más tarde.' },
        { status: 429 }
      );
    }

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
  rates?: { optimistic: number; pessimistic: number };
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



function percentChange(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return round(((current - previous) / previous) * 100);
}
