'use client';

import { useState, useMemo, useEffect } from 'react';
import { useInvoices } from '@/hooks/use-invoices';
import { useExpenses } from '@/hooks/use-expenses';
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
  Unlock
} from 'lucide-react';

export default function UtilidadesPage() {
  const { invoices } = useInvoices();
  const { expenses } = useExpenses();

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  });

  const [usoManual, setUsoManual] = useState(false);
  const [excedenteManual, setExcedenteManual] = useState<number | ''>('');

  const [facturacionEdson, setFacturacionEdson] = useState<number | ''>('');
  const [facturacionMauricio, setFacturacionMauricio] = useState<number | ''>('');
  const [facturacionMarcelo, setFacturacionMarcelo] = useState<number | ''>('');

  // Auto-calculation of Excedente
  const autoExcedente = useMemo(() => {
    let income = 0;
    let outflow = 0;
    
    invoices.forEach(inv => {
      if (inv.issueDate && inv.issueDate.startsWith(selectedMonth)) {
        // Solo sumamos lo que ya ha sido pagado (dinero real)
        income += inv.paid || 0;
      }
    });
    expenses.forEach(exp => {
      if (exp.issueDate && exp.issueDate.startsWith(selectedMonth)) {
        // Solo restamos lo que ya ha sido pagado
        outflow += exp.paidAmount || 0;
      }
    });
    
    return Math.max(0, income - outflow);
  }, [invoices, expenses, selectedMonth]);

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-10 sm:px-6 lg:px-8">
        
        {/* Encabezado */}
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
        </header>

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
                  Mes / Año
                </label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full rounded-lg border-slate-300 bg-slate-50 px-4 py-3 text-lg font-semibold text-slate-900 transition-colors focus:border-indigo-500 focus:bg-white focus:ring-indigo-500"
                />
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
                    ? 'Estás en modo manual. Ingresa el monto que quedó en caja.' 
                    : 'Calculado automáticamente sumando los montos ya COBRADOS de facturas y restando los EGRESOS pagados del mes.'}
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
                Facturación Atribuida
              </h2>
              <p className="text-xs text-slate-500 mb-4 cursor-default">
                Monto facturado gracias a la gestión comercial individual de cada socio. Determina el bono del 5%.
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

      </div>
    </div>
  );
}
