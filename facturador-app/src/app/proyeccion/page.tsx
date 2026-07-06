'use client';

import { useState, useMemo, useEffect } from 'react';
import { useInvoices } from '@/hooks/use-invoices';
import { useExpenses } from '@/hooks/use-expenses';
import { useLiquidations } from '@/hooks/use-liquidations';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Calculator,
  PieChart,
  Users,
  Building,
  TrendingUp,
  Wallet,
  ShieldCheck,
  PiggyBank,
  ChevronRight,
  Calendar,
  Lock,
  Unlock,
  Download,
  Loader2,
  Save,
  History,
  Trash2,
  AlertCircle,
  CheckCircle
} from 'lucide-react';

export default function UtilidadesPage() {
  const { invoices } = useInvoices();
  const { expenses } = useExpenses();
  const {
    liquidations,
    tableMissing,
    saveLiquidation,
    deleteLiquidation,
    isLoading: isLoadingLiquidations,
  } = useLiquidations();
  const [isSavingLiquidation, setIsSavingLiquidation] = useState(false);
  const [liquidationMessage, setLiquidationMessage] = useState<string | null>(null);

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  });

  const [usoManual, setUsoManual] = useState(false);
  const [excedenteManual, setExcedenteManual] = useState<number | ''>('');

  const [facturacionEdson, setFacturacionEdson] = useState<number | ''>('');
  const [facturacionMauricio, setFacturacionMauricio] = useState<number | ''>('');
  const [facturacionMarcelo, setFacturacionMarcelo] = useState<number | ''>('');
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  // Helper to get the last 3 months (including the selected one)
  const getTargetMonths = (monthStr: string) => {
    const [year, month] = monthStr.split('-').map(Number);
    const result = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(year, month - 1 - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      result.push(`${y}-${m}`);
    }
    return result;
  };

  // Breakdown of the last 3 months
  const monthlyBreakdown = useMemo(() => {
    const targetMonths = getTargetMonths(selectedMonth);
    const breakdown = targetMonths.map(monthStr => {
      let mIncome = 0;
      let mOutflow = 0;
      invoices.forEach(inv => {
        // Usamos la fecha de pago real si existe, sino caemos a la fecha de emisión
        const effectiveDate = inv.paymentDate || inv.issueDate;
        if (effectiveDate && effectiveDate.startsWith(monthStr)) {
          mIncome += inv.paid || 0;
        }
      });
      expenses.forEach(exp => {
        // Para los egresos, usamos la fecha de emisión (devengado)
        // para asegurar que la deuda se reste en el mes en que se contrae.
        const effectiveDate = exp.issueDate;
        if (effectiveDate && effectiveDate.startsWith(monthStr)) {
          // Sumamos el gasto total (incluyendo pendientes) para no repartir dinero comprometido
          mOutflow += exp.totalAmount || 0;
        }
      });
      return {
        month: monthStr,
        income: mIncome,
        outflow: mOutflow,
        profit: mIncome - mOutflow
      };
    });
    
    breakdown.sort((a, b) => a.month.localeCompare(b.month)); // chronological

    const totalIncome = breakdown.reduce((acc, curr) => acc + curr.income, 0);
    const totalOutflow = breakdown.reduce((acc, curr) => acc + curr.outflow, 0);
    const totalProfit = totalIncome - totalOutflow;
    const averageProfit = totalProfit / 3;

    return {
      breakdown,
      totalIncome,
      totalOutflow,
      totalProfit,
      averageProfit
    };
  }, [invoices, expenses, selectedMonth]);

  // Auto-calculation of Excedente (Trimestral)
  const autoExcedente = useMemo(() => {
    return Math.max(0, monthlyBreakdown.totalProfit);
  }, [monthlyBreakdown]);

  // Use manual or auto
  const valExcedente = usoManual 
    ? (typeof excedenteManual === 'number' ? excedenteManual : 0) 
    : autoExcedente;

  const valEdson = typeof facturacionEdson === 'number' ? facturacionEdson : 0;
  const valMauricio = typeof facturacionMauricio === 'number' ? facturacionMauricio : 0;
  const valMarcelo = typeof facturacionMarcelo === 'number' ? facturacionMarcelo : 0;

  // --- Cascada Matemática ---
  
  // 1. Reserva de Seguridad (20%)
  const reservaCerezo = valExcedente * 0.20;
  const remanente1 = valExcedente - reservaCerezo;
  
  // 2. Bonos Comerciales (5% comisión)
  const bonoEdson = valEdson * 0.05;
  const bonoMauricio = valMauricio * 0.05;
  const bonoMarcelo = valMarcelo * 0.05;
  const totalBonos = bonoEdson + bonoMauricio + bonoMarcelo;
  
  const remanente2 = Math.max(0, remanente1 - totalBonos);
  const alertaNegativa = (remanente1 - totalBonos) < 0;
  
  // 3. Retención Empresa para Crecimiento (50%)
  const retencionCrecimiento = remanente2 * 0.50;
  
  // 4. Utilidad Neta (Restante 50%)
  const utilidadNeta = remanente2 - retencionCrecimiento;
  
  // 5. Distribución Accionarial
  const utilidadMarcelo = utilidadNeta * 0.51;
  const utilidadMauricio = utilidadNeta * 0.30;
  const utilidadEdson = utilidadNeta * 0.19;
  
  // 6. Pago Total Final a Socios
  const pagoTotalMarcelo = bonoMarcelo + utilidadMarcelo;
  const pagoTotalMauricio = bonoMauricio + utilidadMauricio;
  const pagoTotalEdson = bonoEdson + utilidadEdson;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency: 'PEN',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const handleSaveLiquidation = async () => {
    setIsSavingLiquidation(true);
    setLiquidationMessage(null);
    const result = await saveLiquidation({
      period: selectedMonth,
      excedente: valExcedente,
      reserva: reservaCerezo,
      fondoCrecimiento: retencionCrecimiento,
      utilidadNeta,
      payouts: {
        marcelo: { bono: bonoMarcelo, utilidad: utilidadMarcelo, total: pagoTotalMarcelo },
        mauricio: { bono: bonoMauricio, utilidad: utilidadMauricio, total: pagoTotalMauricio },
        edson: { bono: bonoEdson, utilidad: utilidadEdson, total: pagoTotalEdson },
      },
      ventas: { marcelo: valMarcelo, mauricio: valMauricio, edson: valEdson },
      notes: usoManual ? 'Excedente ingresado manualmente' : 'Excedente auto-calculado',
    });
    if (result.error) {
      setLiquidationMessage(`Error: ${result.error}`);
    } else {
      setLiquidationMessage(`Liquidación de ${selectedMonth} guardada en el histórico.`);
      setTimeout(() => setLiquidationMessage(null), 4000);
    }
    setIsSavingLiquidation(false);
  };

  const handleDeleteLiquidation = async (id: string, period: string) => {
    if (!window.confirm(`¿Eliminar la liquidación de ${period} del histórico?`)) return;
    await deleteLiquidation(id);
  };

  const accumulatedBySocio = useMemo(() => {
    const acc: Record<string, number> = { marcelo: 0, mauricio: 0, edson: 0 };
    for (const liq of liquidations) {
      for (const socio of Object.keys(acc)) {
        acc[socio] += liq.payouts[socio]?.total ?? 0;
      }
    }
    return acc;
  }, [liquidations]);

  const generatePDF = () => {
    setIsGeneratingPDF(true);
    try {
      const doc = new jsPDF();
      
      // Header
      doc.setFontSize(20);
      doc.setTextColor(40, 40, 40);
      doc.text('CEREZO - Liquidación de Utilidades', 14, 20);
      doc.setFontSize(12);
      doc.setTextColor(100, 100, 100);
      doc.text(`Trimestre finalizado en: ${selectedMonth}`, 14, 28);
      
      let finalY = 40;

      // 1. Resumen Trimestral
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text('1. Resumen Trimestral', 14, finalY);
      
      const breakdownRows = monthlyBreakdown.breakdown.map(m => [
        m.month,
        formatCurrency(m.income),
        formatCurrency(m.outflow),
        formatCurrency(m.profit)
      ]);
      
      autoTable(doc, {
        startY: finalY + 5,
        head: [['Mes', 'Ingresos', 'Egresos', 'Utilidad']],
        body: [
          ...breakdownRows,
          [{ content: 'Totales del Trimestre', styles: { fontStyle: 'bold' } as any }, formatCurrency(monthlyBreakdown.totalIncome), formatCurrency(monthlyBreakdown.totalOutflow), formatCurrency(monthlyBreakdown.totalProfit)]
        ],
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] },
      });
      
      finalY = (doc as any).lastAutoTable.finalY + 15;

      // 2. Cascada de Distribución
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text('2. Cascada de Distribución', 14, finalY);

      autoTable(doc, {
        startY: finalY + 5,
        head: [['Concepto', 'Monto', 'Descripción']],
        body: [
          ['Excedente Inicial', formatCurrency(valExcedente), 'Utilidad bruta del trimestre'],
          ['Reserva Cerezo (20%)', formatCurrency(reservaCerezo), 'Fondo blindado para impuestos/equipos'],
          ['Retención Crecimiento (50%)', formatCurrency(retencionCrecimiento), 'Fondo de empresa post-bonos'],
          ['Utilidad Neta a Repartir', formatCurrency(utilidadNeta), 'Restante 50% distribuible a socios']
        ],
        theme: 'striped',
        headStyles: { fillColor: [44, 62, 80] },
      });

      finalY = (doc as any).lastAutoTable.finalY + 15;

      // 3. Liquidación a Socios
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text('3. Liquidación a Socios', 14, finalY);

      autoTable(doc, {
        startY: finalY + 5,
        head: [['Socio', 'Utilidad Neta', 'Pago Total']],
        body: [
          ['Marcelo (51%)', formatCurrency(utilidadMarcelo), formatCurrency(pagoTotalMarcelo)],
          ['Mauricio (30%)', formatCurrency(utilidadMauricio), formatCurrency(pagoTotalMauricio)],
          ['Edson (19%)', formatCurrency(utilidadEdson), formatCurrency(pagoTotalEdson)]
        ],
        theme: 'grid',
        headStyles: { fillColor: [39, 174, 96] },
        styles: { fontSize: 11 },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 2) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = [0, 100, 0];
          }
        }
      });

      finalY = (doc as any).lastAutoTable.finalY + 15;
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('Documento generado automáticamente por el Facturador Inteligente Cerezo.', 14, finalY);
      
      doc.save(`Liquidacion_Utilidades_${selectedMonth}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Hubo un error al generar el PDF.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-10 sm:px-6 lg:px-8">
        
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold uppercase tracking-[0.4em] text-teal-600">
              Distribución Jerárquica
            </p>
            <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">
              Utilidades a Repartir
            </h1>
            <p className="max-w-2xl text-base text-slate-600 mt-2">
              Calculadora para la distribución justa de utilidades y comisiones por captación de ventas, protegiendo previamente los fondos operativos de Cerezo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSaveLiquidation}
              disabled={isSavingLiquidation || tableMissing}
              className="flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-teal-700 hover:shadow-md disabled:opacity-70 disabled:cursor-not-allowed"
              title={tableMissing ? 'Ejecuta la migración SQL primero' : 'Guardar esta liquidación en el histórico'}
            >
              {isSavingLiquidation ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isSavingLiquidation ? 'Guardando...' : 'Guardar Liquidación'}
            </button>
            <button
              onClick={generatePDF}
              disabled={isGeneratingPDF}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-slate-800 hover:shadow-md disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isGeneratingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {isGeneratingPDF ? 'Generando...' : 'Descargar Constancia PDF'}
            </button>
          </div>
        </header>

        {tableMissing && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              El histórico de liquidaciones necesita una tabla nueva en Supabase. Ejecuta el archivo{' '}
              <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                supabase/migration-mejoras-v1.sql
              </code>{' '}
              en el SQL Editor de Supabase y recarga esta página.
            </p>
          </div>
        )}

        {liquidationMessage && (
          <div
            className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
              liquidationMessage.startsWith('Error')
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {liquidationMessage.startsWith('Error') ? (
              <AlertCircle className="h-4 w-4" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            {liquidationMessage}
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-12">
          
          {/* Columna Izquierda: Entradas de Datos */}
          <div className="lg:col-span-4 space-y-6">

            {/* Selector de Mes */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800 border-b border-slate-100 pb-3 mb-5">
                <Calendar className="w-5 h-5 text-indigo-500" />
                Periodo a Liquidar
              </h2>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Mes de Cierre (Últimos 3 Meses)
                </label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full rounded-lg border-slate-300 bg-slate-50 px-4 py-3 text-lg font-semibold text-slate-900 transition-colors focus:border-indigo-500 focus:bg-white focus:ring-indigo-500"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Se calculará el trimestre finalizando en el mes seleccionado.
                </p>
              </div>
            </div>

            {/* Resumen del Trimestre */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800 border-b border-slate-100 pb-3 mb-4">
                <PieChart className="w-5 h-5 text-blue-500" />
                Desglose del Trimestre
              </h2>
              <div className="space-y-3 mb-4">
                {monthlyBreakdown.breakdown.map((m) => (
                  <div key={m.month} className="flex justify-between items-center text-sm border-b border-slate-50 pb-2">
                    <span className="font-semibold text-slate-700">{m.month}</span>
                    <div className="text-right">
                      <p className="text-slate-500 text-xs">Ingresos: <span className="text-green-600">{formatCurrency(m.income)}</span></p>
                      <p className="text-slate-500 text-xs">Egresos: <span className="text-red-500">{formatCurrency(m.outflow)}</span></p>
                      <p className={`font-bold mt-0.5 ${m.profit >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                        Utilidad: {formatCurrency(m.profit)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-2">
                <div className="flex justify-between text-sm font-medium">
                  <span className="text-slate-600">Total Ingresos:</span>
                  <span className="text-green-600">{formatCurrency(monthlyBreakdown.totalIncome)}</span>
                </div>
                <div className="flex justify-between text-sm font-medium">
                  <span className="text-slate-600">Total Egresos:</span>
                  <span className="text-red-500">{formatCurrency(monthlyBreakdown.totalOutflow)}</span>
                </div>
                <div className="flex justify-between text-base font-bold pt-2 border-t border-slate-200 mt-2">
                  <span className="text-slate-800">Total Trimestre:</span>
                  <span className={monthlyBreakdown.totalProfit >= 0 ? 'text-indigo-600' : 'text-orange-600'}>
                    {formatCurrency(monthlyBreakdown.totalProfit)}
                  </span>
                </div>
                <div className="flex justify-between text-xs font-semibold pt-1">
                  <span className="text-slate-500">Promedio Mensual:</span>
                  <span className={monthlyBreakdown.averageProfit >= 0 ? 'text-slate-700' : 'text-orange-600'}>
                    {formatCurrency(monthlyBreakdown.averageProfit)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-5">
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                  <Wallet className="w-5 h-5 text-teal-600" />
                  Caja Disponible
                </h2>
                <button
                  onClick={() => setUsoManual(!usoManual)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                    usoManual 
                      ? 'bg-orange-100 text-orange-700 hover:bg-orange-200' 
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                  title="Permite insertar el excedente manualmente."
                >
                  {usoManual ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  {usoManual ? 'Forzar Input' : 'Auto-Calculado'}
                </button>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Excedente del Mes (S/)
                </label>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                  {usoManual 
                    ? 'Estás en modo manual. Ingresa el monto que quedó en caja para el trimestre.' 
                    : 'Calculado automáticamente sumando los montos ya COBRADOS y restando los EGRESOS totales (pagados y pendientes) de los últimos 3 meses.'}
                </p>
                
                {usoManual ? (
                  <input
                    type="number"
                    value={excedenteManual}
                    onChange={(e) => setExcedenteManual(e.target.value ? Number(e.target.value) : '')}
                    className="w-full rounded-lg border-orange-300 bg-orange-50 px-4 py-3 text-lg font-bold text-orange-900 transition-colors focus:border-orange-500 focus:bg-white focus:ring-orange-500"
                    placeholder="Ej: 9000"
                  />
                ) : (
                    <div className="w-full rounded-lg border border-slate-200 bg-slate-100 px-4 py-3 text-lg font-bold text-slate-600 flex justify-between items-center cursor-not-allowed">
                      <span>{formatCurrency(autoExcedente)}</span>
                      <span className="text-xs font-medium px-2 py-1 bg-teal-100 text-teal-700 rounded uppercase">Flujo Real</span>
                    </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800 border-b border-slate-100 pb-3 mb-5">
                <TrendingUp className="w-5 h-5 text-indigo-600" />
                Facturación Atribuida (Trimestre)
              </h2>
              <p className="text-xs text-slate-500 mb-4 cursor-default">
                Monto facturado en el trimestre gracias a la gestión comercial individual de cada socio. Determina el bono del 5%.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    Ventas por Marcelo (S/)
                  </label>
                  <input
                    type="number"
                    value={facturacionMarcelo}
                    onChange={(e) => setFacturacionMarcelo(e.target.value ? Number(e.target.value) : '')}
                    className="w-full rounded-lg border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    Ventas por Mauricio (S/)
                  </label>
                  <input
                    type="number"
                    value={facturacionMauricio}
                    onChange={(e) => setFacturacionMauricio(e.target.value ? Number(e.target.value) : '')}
                    className="w-full rounded-lg border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    Ventas por Edson (S/)
                  </label>
                  <input
                    type="number"
                    value={facturacionEdson}
                    onChange={(e) => setFacturacionEdson(e.target.value ? Number(e.target.value) : '')}
                    className="w-full rounded-lg border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Columna Derecha: Resultados (Cascada) */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            
            {/* Cascada Institucional */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm relative overflow-hidden group hover:border-slate-300 transition-colors">
                <div className="absolute top-0 right-0 p-4 opacity-5">
                  <ShieldCheck className="w-24 h-24" />
                </div>
                <div className="z-10 relative">
                  <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    Reserva Cerezo (20%)
                  </h3>
                  <p className="mt-2 text-3xl font-bold text-slate-800">
                    {formatCurrency(reservaCerezo)}
                  </p>
                  <p className="text-xs text-slate-500 mt-2 font-medium">
                    Fondo blindado para impuestos y equipos.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm relative overflow-hidden group hover:border-slate-300 transition-colors">
                <div className="absolute top-0 right-0 p-4 opacity-5">
                  <PiggyBank className="w-24 h-24" />
                </div>
                <div className="z-10 relative">
                  <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    Fondo de Crecimiento
                  </h3>
                  <p className="mt-2 text-3xl font-bold text-slate-800">
                    {formatCurrency(retencionCrecimiento)}
                  </p>
                  <p className="text-xs text-slate-500 mt-2 font-medium">
                    50% de retención post-bonos para capitalización.
                  </p>
                </div>
              </div>
            </div>

            {alertaNegativa && (
              <div className="rounded-lg bg-red-50 p-4 border border-red-200">
                <p className="text-sm text-red-800 font-medium">
                  <strong>Atención:</strong> El pozo excedente no es suficiente para cubrir los bonos comerciales del 5%. Revisa los cálculos o ingresos atribuidos.
                </p>
              </div>
            )}

            {/* Panel Principal de Socios */}
            <div className="rounded-xl border-2 border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="bg-slate-50/80 px-6 py-4 border-b border-slate-200 flex flex-wrap justify-between items-center">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  Liquidación de Socios (Pago Total)
                </h2>
                <div className="text-right">
                  <p className="text-xs text-slate-500 uppercase font-semibold">Total a Repartir</p>
                  <p className="text-xl font-bold text-green-600">{formatCurrency(pagoTotalMarcelo + pagoTotalMauricio + pagoTotalEdson)}</p>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {/* MARCELO */}
                <div className="p-6 transition-colors hover:bg-slate-50/50">
                  <div className="flex flex-wrap items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Marcelo</h3>
                      <p className="text-sm text-slate-500 font-medium tracking-wide">Accionista Mayoritario (51%)</p>
                    </div>
                    <div className="text-right bg-green-50 px-4 py-2 rounded-lg border border-green-100">
                      <p className="text-xs font-bold text-green-700 uppercase tracking-wider mb-0.5">Transferir</p>
                      <p className="text-2xl font-black text-green-700">{formatCurrency(pagoTotalMarcelo)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase">Bono Comercial (5%)</p>
                      <p className="font-semibold text-slate-800">{formatCurrency(bonoMarcelo)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase">Utilidad Neta (51%)</p>
                      <p className="font-semibold text-slate-800">{formatCurrency(utilidadMarcelo)}</p>
                    </div>
                  </div>
                </div>

                {/* MAURICIO */}
                <div className="p-6 transition-colors hover:bg-slate-50/50">
                  <div className="flex flex-wrap items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Mauricio</h3>
                      <p className="text-sm text-slate-500 font-medium tracking-wide">Socio Fundador (30%)</p>
                    </div>
                    <div className="text-right bg-green-50 px-4 py-2 rounded-lg border border-green-100">
                      <p className="text-xs font-bold text-green-700 uppercase tracking-wider mb-0.5">Transferir</p>
                      <p className="text-2xl font-black text-green-700">{formatCurrency(pagoTotalMauricio)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase">Bono Comercial (5%)</p>
                      <p className="font-semibold text-slate-800">{formatCurrency(bonoMauricio)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase">Utilidad Neta (30%)</p>
                      <p className="font-semibold text-slate-800">{formatCurrency(utilidadMauricio)}</p>
                    </div>
                  </div>
                </div>

                {/* EDSON */}
                <div className="p-6 transition-colors hover:bg-slate-50/50">
                  <div className="flex flex-wrap items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Edson</h3>
                      <p className="text-sm text-slate-500 font-medium tracking-wide">Socio Operativo (19%)</p>
                    </div>
                    <div className="text-right bg-green-50 px-4 py-2 rounded-lg border border-green-100">
                      <p className="text-xs font-bold text-green-700 uppercase tracking-wider mb-0.5">Transferir</p>
                      <p className="text-2xl font-black text-green-700">{formatCurrency(pagoTotalEdson)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase">Bono Comercial (5%)</p>
                      <p className="font-semibold text-slate-800">{formatCurrency(bonoEdson)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase">Utilidad Neta (19%)</p>
                      <p className="font-semibold text-slate-800">{formatCurrency(utilidadEdson)}</p>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Sumario de Trazabilidad */}
            <div className="flex items-center gap-3 px-4 py-3 bg-slate-200/50 rounded-lg text-sm text-slate-600 font-medium w-fit mx-auto mt-2">
              <Calculator className="w-4 h-4 text-slate-500" />
              Verificación Matemática:
              <span className="text-slate-800">
                Reserva ({formatCurrency(reservaCerezo)}) + 
                Bonos ({formatCurrency(totalBonos)}) + 
                Fondo Empresa ({formatCurrency(retencionCrecimiento)}) + 
                Utilidad Socios ({formatCurrency(utilidadNeta)}) = 
                {formatCurrency(reservaCerezo + totalBonos + retencionCrecimiento + utilidadNeta)}
              </span>
            </div>

          </div>
        </div>

        {/* ── P7: Histórico de liquidaciones ─────────────────────────────────── */}
        {!tableMissing && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-4">
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                <History className="w-5 h-5 text-slate-500" />
                Histórico de liquidaciones
              </h2>
              {liquidations.length > 0 && (
                <div className="flex flex-wrap gap-4 text-sm">
                  {(['marcelo', 'mauricio', 'edson'] as const).map((socio) => (
                    <div key={socio} className="text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {socio} acumulado
                      </p>
                      <p className="font-bold text-slate-800">
                        {formatCurrency(accumulatedBySocio[socio])}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {isLoadingLiquidations ? (
              <p className="p-6 text-center text-sm text-slate-500">Cargando histórico...</p>
            ) : liquidations.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-500">
                Aún no hay liquidaciones guardadas. Calcula la del trimestre y presiona
                “Guardar Liquidación” para dejar constancia.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-700">Periodo</th>
                      <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-700">Excedente</th>
                      <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-700">Reserva 20%</th>
                      <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-700">Fondo 50%</th>
                      <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-700">Marcelo</th>
                      <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-700">Mauricio</th>
                      <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-700">Edson</th>
                      <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-700"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {liquidations.map((liq) => (
                      <tr key={liq.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-6 py-3 font-semibold text-slate-900">{liq.period}</td>
                        <td className="px-6 py-3 text-right">{formatCurrency(liq.excedente)}</td>
                        <td className="px-6 py-3 text-right text-slate-600">{formatCurrency(liq.reserva)}</td>
                        <td className="px-6 py-3 text-right text-slate-600">{formatCurrency(liq.fondoCrecimiento)}</td>
                        <td className="px-6 py-3 text-right font-semibold text-green-700">
                          {formatCurrency(liq.payouts.marcelo?.total ?? 0)}
                        </td>
                        <td className="px-6 py-3 text-right font-semibold text-green-700">
                          {formatCurrency(liq.payouts.mauricio?.total ?? 0)}
                        </td>
                        <td className="px-6 py-3 text-right font-semibold text-green-700">
                          {formatCurrency(liq.payouts.edson?.total ?? 0)}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <button
                            onClick={() => handleDeleteLiquidation(liq.id, liq.period)}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Eliminar del histórico"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  );
}
