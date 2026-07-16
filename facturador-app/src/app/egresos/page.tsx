'use client';

import {
  ExpenseCategory,
  ExpenseDocumentType,
  ExpenseRecord,
  PaymentMethod,
  ExpenseStatus,
} from '@/lib/accounting-types';
import { useExpenses } from '@/hooks/use-expenses';
import { usePartners } from '@/hooks/use-partners';
import { ChangeEvent, FormEvent, useMemo, useState, ReactNode, useRef } from 'react';
import {
  ArrowRightLeft,
  Calendar,
  CheckCircle,
  Clock,
  Edit2,
  Eye,
  FileText,
  Plus,
  Receipt,
  Search,
  AlertCircle,
  X,
  Trash2,
} from 'lucide-react';
import {
  asLocalDate,
  formatMonthLabel,
  filterByMonth,
  shortenName,
  toMonthKey,
} from '@/lib/accounting-service';

const currencyFormatter = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
});
const currencyFormatterNoDecimals = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const DOCUMENT_OPTIONS: { label: string; value: ExpenseDocumentType }[] = [
  { label: 'Factura', value: 'factura' },
  { label: 'Recibo por honorarios', value: 'recibo' },
  { label: 'Boleta', value: 'boleta' },
];

const CATEGORY_OPTIONS: { label: string; value: ExpenseCategory }[] = [
  { label: 'Servicios', value: 'servicios' },
  { label: 'Materiales', value: 'materiales' },
  { label: 'Personal', value: 'personal' },
  { label: 'Marketing', value: 'marketing' },
  { label: 'Administrativos', value: 'administrativos' },
  { label: 'Equipos', value: 'equipos' },
  { label: 'Gastos Financieros', value: 'financieros' },
];

const PAYMENT_OPTIONS: { label: string; value: PaymentMethod }[] = [
  { label: 'Transferencia', value: 'transferencia' },
  { label: 'Depósito', value: 'deposito' },
  { label: 'Efectivo', value: 'efectivo' },
  { label: 'Tarjeta', value: 'tarjeta' },
  { label: 'Cheque', value: 'cheque' },
  { label: 'Yape/Plin', value: 'yape_plin' },
  { label: 'Otros', value: 'otros' },
];

type ExpenseFormState = {
  documentType: ExpenseDocumentType;
  documentSeries: string;
  documentNumber: string;
  issueDate: string;
  dueDate: string;
  providerName: string;
  providerDocument: string;
  concept: string;
  baseAmount: string;
  igvAmount: string;
  irRetention: string;
  otherTaxes: string;
  paymentMethod: PaymentMethod;
  operationNumber: string;
  category: ExpenseCategory;
  notes: string;
  clientId: string;
  alreadyPaid: boolean;
};

const INITIAL_FORM: ExpenseFormState = {
  documentType: 'factura',
  documentSeries: '',
  documentNumber: '',
  issueDate: '',
  dueDate: '',
  providerName: '',
  providerDocument: '',
  concept: '',
  baseAmount: '',
  igvAmount: '',
  irRetention: '',
  otherTaxes: '',
  paymentMethod: 'transferencia',
  operationNumber: '',
  category: 'servicios',
  notes: '',
  clientId: '',
  alreadyPaid: false,
};

// Métodos de pago que implican pago inmediato: el egreso nace pagado (P6)
const AUTO_PAID_METHODS: PaymentMethod[] = ['efectivo', 'tarjeta', 'yape_plin'];

// P5: conceptos sospechosos — solo dígitos/símbolos o demasiado cortos
const isSuspiciousConcept = (concept: string) => {
  const t = (concept ?? '').trim();
  return t.length < 10 || /^[\d\s.,\-/#]+$/.test(t);
};

const getInitials = (name: string) => {
  if (!name) return '??';
  const parts = name.trim().split(' ');
  if (parts.length > 1) {
    return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
  }
  return (name.substring(0, 2) || '??').toUpperCase();
};

const STATUS_META: Record<
  ExpenseStatus,
  {
    label: string;
    badge: ReactNode;
    filterPill: ReactNode;
  }
> = {
  pagado: {
    label: 'Pagado',
    badge: (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-200">
        <CheckCircle className="w-3 h-3" />
        Pagado
      </span>
    ),
    filterPill: (
      <>
        <div className="w-2 h-2 rounded-full bg-green-500"></div>
        Pagado
      </>
    ),
  },
  pendiente: {
    label: 'Pendiente',
    badge: (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 border border-yellow-200">
        <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"></div>
        Pendiente
      </span>
    ),
    filterPill: (
      <>
        <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
        Pendiente
      </>
    ),
  },
  vencido: {
    label: 'Vencido',
    badge: (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
        <AlertCircle className="w-3 h-3" />
        Vencido
      </span>
    ),
    filterPill: (
      <>
        <div className="w-2 h-2 rounded-full bg-red-500"></div>
        Vencido
      </>
    ),
  },
};

export default function EgresosPage() {
  const {
    expenses,
    isLoading,
    syncError,
    insertExpense,
    insertExpenseFromXML,
    updateExpense,
    markExpensePaid,
    revertExpensePayment,
    deleteExpense,
  } = useExpenses();
  const { partners } = usePartners();
  const [form, setForm] = useState(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | ExpenseStatus>('todos');
  const [monthFilter, setMonthFilter] = useState('todos');
  const [busyExpenseId, setBusyExpenseId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [showDirtyPanel, setShowDirtyPanel] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isUploadingXML, setIsUploadingXML] = useState(false);
  const [xmlUploadError, setXmlUploadError] = useState<string | null>(null);
  const [xmlUploadMessage, setXmlUploadMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setFormError('El archivo es muy pesado (máximo 5MB).');
      return;
    }
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      setFormError('Solo se admiten archivos PDF. Para imágenes, ingresa los datos manualmente.');
      return;
    }

    setIsScanning(true);
    setFormError(null);

    try {
      // Extracción 100% en el navegador: no depende de funciones serverless
      const { extractText, getDocumentProxy } = await import('unpdf');
      const bytes = await file.arrayBuffer();
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: true });
      const { parseReciboText } = await import('@/lib/recibo-parser');
      const data = parseReciboText(text);

      if (data) {
        if (data.documentType === 'recibo' && data.documentNumber && data.providerName && data.issueDate && data.baseAmount) {
          const base = Number(data.baseAmount) || 0;
          const ir = data.irRetentionAmount ? Number(data.irRetentionAmount) : 0;
          const total = data.totalAmount ? Number(data.totalAmount) : (base - ir);

          // RUC personal 10XXXXXXXXY ↔ DNI XXXXXXXX: mismo profesional
          const scannedDoc = data.ruc ?? '';
          const scannedDni =
            scannedDoc.length === 11 && scannedDoc.startsWith('10')
              ? scannedDoc.slice(2, 10)
              : null;

          const duplicate = expenses.find(
            (e) =>
              e.documentNumber === String(data.documentNumber) &&
              (e.providerDocument === scannedDoc ||
                (scannedDni !== null && e.providerDocument === scannedDni)),
          );
          if (duplicate) {
            setFormError(
              `El recibo ${data.documentSeries ? `${data.documentSeries}-` : ''}${data.documentNumber} de ${duplicate.providerName} ya está registrado.`,
            );
            return;
          }

          // Reusar el nombre canónico del socio/proveedor si ya existe
          const partnerMatch = partners.find(
            (p) =>
              p.documentNumber === scannedDoc ||
              (scannedDni !== null && p.documentNumber === scannedDni),
          );
          const knownProvider = expenses.find(
            (e) =>
              e.providerDocument === scannedDoc ||
              (scannedDni !== null && e.providerDocument === scannedDni),
          );

          const result = await insertExpense({
            documentType: 'recibo',
            documentSeries: data.documentSeries || null,
            documentNumber: data.documentNumber,
            issueDate: data.issueDate,
            dueDate: data.dueDate || data.issueDate,
            providerName: partnerMatch?.name ?? knownProvider?.providerName ?? data.providerName,
            partnerId: partnerMatch?.id ?? null,
            providerDocument: data.ruc || null,
            concept: data.description || 'Servicios profesionales',
            paymentMethod: 'transferencia',
            operationNumber: null,
            paymentDate: null,
            baseAmount: base,
            igvAmount: 0,
            irRetention: ir,
            otherTaxes: 0,
            totalAmount: total,
            category: (data.category as ExpenseCategory) || 'servicios',
            status: 'pendiente',
            paidAmount: 0,
            notes: 'Generado automáticamente al escanear recibo por honorarios',
          });
          
          if (!result.error) {
            setFormError(null);
            setIsScanning(false);
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
            return;
          }
        }

        setForm(prev => ({
          ...prev,
          documentType: data.documentType || prev.documentType,
          documentSeries: data.documentSeries || prev.documentSeries,
          documentNumber: data.documentNumber || prev.documentNumber,
          issueDate: data.issueDate || prev.issueDate,
          dueDate: data.dueDate || prev.dueDate,
          providerName: data.providerName || prev.providerName,
          providerDocument: data.ruc || prev.providerDocument,
          concept: data.description || prev.concept,
          baseAmount: data.baseAmount ? String(data.baseAmount) : prev.baseAmount,
          igvAmount: data.igvAmount ? String(data.igvAmount) : prev.igvAmount,
          irRetention: data.irRetentionAmount ? String(data.irRetentionAmount) : prev.irRetention,
          category: (data.category as ExpenseCategory) || prev.category,
        }));

        // Auto-calculate IGV if base is present but IGV is not
        if (data.baseAmount && !data.igvAmount && data.documentType !== 'recibo') {
          const base = Number(data.baseAmount);
          const igv = (base * 0.18).toFixed(2);
          setForm(prev => ({ ...prev, igvAmount: String(igv) }));
        }

        setIsModalOpen(true);
      }
    } catch (error) {
      console.error(error);
      setFormError('No se pudo leer el documento. Intenta ingresar los datos manualmente.');
    } finally {
      setIsScanning(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleXMLUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setXmlUploadError(null);
    setXmlUploadMessage(null);
    setIsUploadingXML(true);

    try {
      const xmlContent = await file.text();
      const result = await insertExpenseFromXML(xmlContent);
      if (result.error) {
        setXmlUploadError(result.error);
      } else if (result.data) {
        setXmlUploadMessage(`Egreso ${result.data.documentNumber} registrado correctamente.`);
        setTimeout(() => {
          setIsModalOpen(false);
          setXmlUploadMessage(null);
        }, 1500);
      }
    } catch (error) {
      console.error(error);
      setXmlUploadError(
        error instanceof Error ? error.message : 'No se pudo interpretar el XML.',
      );
    } finally {
      setIsUploadingXML(false);
    }
  };

  const triggerXMLUpload = () => {
    xmlInputRef.current?.click();
  };

  const monthOptions = useMemo(() => buildMonthOptions(expenses), [expenses]);

  const clientOptions = useMemo(
    () =>
      partners
        .filter((p) => p.role === 'cliente' || p.role === 'ambos')
        .map((p) => ({ id: p.id, name: p.name })),
    [partners],
  );

  // P5: categoría dominante por proveedor (para detectar inconsistencias y precargar)
  const dominantCategoryByProvider = useMemo(() => {
    const counts = new Map<string, Map<ExpenseCategory, number>>();
    for (const e of expenses) {
      const inner = counts.get(e.providerName) ?? new Map<ExpenseCategory, number>();
      inner.set(e.category, (inner.get(e.category) ?? 0) + 1);
      counts.set(e.providerName, inner);
    }
    const result = new Map<string, { category: ExpenseCategory; count: number; total: number }>();
    for (const [provider, inner] of counts) {
      let best: ExpenseCategory | null = null;
      let bestCount = 0;
      let total = 0;
      for (const [cat, n] of inner) {
        total += n;
        if (n > bestCount) {
          best = cat;
          bestCount = n;
        }
      }
      if (best) result.set(provider, { category: best, count: bestCount, total });
    }
    return result;
  }, [expenses]);

  // P5: egresos con datos por limpiar
  const dirtyExpenses = useMemo(() => {
    return expenses
      .map((e) => {
        const reasons: string[] = [];
        if (isSuspiciousConcept(e.concept)) reasons.push('Concepto poco descriptivo');
        const dominant = dominantCategoryByProvider.get(e.providerName);
        if (dominant && dominant.total >= 3 && e.category !== dominant.category) {
          reasons.push(`Categoría "${e.category}" difiere del histórico ("${dominant.category}")`);
        }
        return { expense: e, reasons };
      })
      .filter((item) => item.reasons.length > 0);
  }, [expenses, dominantCategoryByProvider]);

  const lastCategoryForProvider = (name: string): ExpenseCategory | null => {
    const match = expenses
      .filter((e) => e.providerName === name)
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
    return match[0]?.category ?? null;
  };

  const openCreateModal = () => {
    setForm(INITIAL_FORM);
    setEditingExpenseId(null);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleEditExpense = (expense: ExpenseRecord) => {
    setForm({
      documentType: expense.documentType,
      documentSeries: expense.documentSeries ?? '',
      documentNumber: expense.documentNumber,
      issueDate: expense.issueDate.slice(0, 10),
      dueDate: expense.dueDate ? expense.dueDate.slice(0, 10) : '',
      providerName: expense.providerName,
      providerDocument: expense.providerDocument ?? '',
      concept: expense.concept,
      baseAmount: String(expense.baseAmount),
      igvAmount: String(expense.igvAmount),
      irRetention: expense.irRetention ? String(expense.irRetention) : '',
      otherTaxes: expense.otherTaxes ? String(expense.otherTaxes) : '',
      paymentMethod: expense.paymentMethod ?? 'transferencia',
      operationNumber: expense.operationNumber ?? '',
      category: expense.category,
      notes: expense.notes ?? '',
      clientId: expense.clientId ?? '',
      alreadyPaid: expense.status === 'pagado',
    });
    setEditingExpenseId(expense.id);
    setFormError(null);
    setIsModalOpen(true);
  };

  const monthScopedExpenses = useMemo(
    () => filterByMonth(expenses, monthFilter),
    [expenses, monthFilter],
  );

  const filteredExpenses = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return monthScopedExpenses
      .filter((expense) => {
        return statusFilter === 'todos' ? true : expense.status === statusFilter;
      })
      .filter((expense) => {
        if (!term) return true;
        const partner = partners.find(p => p.id === expense.partnerId);
        const tradeName = partner?.tradeName?.toLowerCase() ?? '';
        return (
          expense.providerName.toLowerCase().includes(term) ||
          tradeName.includes(term) ||
          expense.concept.toLowerCase().includes(term) ||
          expense.documentNumber.toLowerCase().includes(term)
        );
      });
  }, [monthScopedExpenses, searchTerm, statusFilter, partners]);

  const totals = useMemo(() => {
    return monthScopedExpenses.reduce(
      (acc, expense) => {
        acc.total += expense.totalAmount;
        acc.paid += expense.paidAmount;
        acc.pending += Math.max(expense.totalAmount - expense.paidAmount, 0);
        acc.igv += expense.igvAmount;
        return acc;
      },
      { total: 0, paid: 0, pending: 0, igv: 0 },
    );
  }, [monthScopedExpenses]);

  const visibleTotals = useMemo(() => {
    return filteredExpenses.reduce(
      (acc, expense) => {
        acc.total += expense.totalAmount;
        acc.paid += expense.paidAmount;
        acc.pending += Math.max(expense.totalAmount - expense.paidAmount, 0);
        acc.igv += expense.igvAmount;
        return acc;
      },
      { total: 0, paid: 0, pending: 0, igv: 0 },
    );
  }, [filteredExpenses]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !form.documentNumber.trim() ||
      !form.providerName.trim() ||
      !form.issueDate ||
      !form.baseAmount
    ) {
      setFormError('Completa número, proveedor, fecha y monto base.');
      return;
    }
    if (isSuspiciousConcept(form.concept)) {
      setFormError(
        'El concepto debe describir el gasto: mínimo 10 caracteres y no puede ser solo números.',
      );
      return;
    }
    setIsSaving(true);
    const base = Number(form.baseAmount) || 0;
    const igv = form.igvAmount ? Number(form.igvAmount) : Number((base * 0.18).toFixed(2));
    const ir = Number(form.irRetention) || 0;
    const other = Number(form.otherTaxes) || 0;
    const total = base + igv + other - ir;
    const selectedClient = partners.find((p) => p.id === form.clientId);
    const payload = {
      documentType: form.documentType,
      documentSeries: form.documentSeries || null,
      documentNumber: form.documentNumber,
      issueDate: form.issueDate,
      dueDate: form.dueDate || form.issueDate,
      providerName: form.providerName,
      providerDocument: form.providerDocument || null,
      concept: form.concept.trim(),
      paymentMethod: form.paymentMethod,
      operationNumber: form.operationNumber || null,
      paymentDate: form.alreadyPaid ? form.issueDate : null,
      baseAmount: base,
      igvAmount: igv,
      irRetention: ir,
      otherTaxes: other,
      totalAmount: total,
      category: form.category,
      status: (form.alreadyPaid ? 'pagado' : 'pendiente') as ExpenseStatus,
      paidAmount: form.alreadyPaid ? total : 0,
      notes: form.notes || null,
      clientId: form.clientId || null,
      clientName: selectedClient?.name ?? null,
    };
    const result = editingExpenseId
      ? await updateExpense(editingExpenseId, payload)
      : await insertExpense(payload);
    if (result.error) {
      setFormError(result.error);
    } else {
      setFormError(null);
      setForm(INITIAL_FORM);
      setEditingExpenseId(null);
      setIsModalOpen(false);
    }
    setIsSaving(false);
  };

  const handleMarkPaid = async (expenseId: string) => {
    setBusyExpenseId(expenseId);
    await markExpensePaid(expenseId);
    setBusyExpenseId(null);
  };

  const handleRevertPaid = async (expenseId: string) => {
    if (!window.confirm('¿Seguro que deseas marcar este egreso como no pagado?')) return;
    setBusyExpenseId(expenseId);
    await revertExpensePayment(expenseId);
    setBusyExpenseId(null);
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!window.confirm('¿Seguro que deseas eliminar este egreso de forma permanente?')) return;
    setBusyExpenseId(expenseId);
    const result = await deleteExpense(expenseId);
    if (result.error) {
      alert(result.error);
    }
    setBusyExpenseId(null);
  };


  const handleAutoIgv = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm((prev) => ({
      ...prev,
      baseAmount: value,
      igvAmount: ((Number(value) || 0) * 0.18).toFixed(2),
    }));
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('todos');
    setMonthFilter('todos');
  };

  const summaryCards = [
    { label: 'Gasto total', value: totals.total, hint: `Visible: ${formatCurrencyNoDecimals(visibleTotals.total)}`, Icon: ArrowRightLeft, color: 'orange' },
    { label: 'Pagado', value: totals.paid, hint: `Visible: ${formatCurrencyNoDecimals(visibleTotals.paid)}`, Icon: CheckCircle, color: 'green' },
    { label: 'Pendiente', value: totals.pending, hint: `Visible: ${formatCurrencyNoDecimals(visibleTotals.pending)}`, Icon: Clock, color: 'yellow' },
    { label: 'IGV compras', value: totals.igv, hint: `Visible: ${formatCurrencyNoDecimals(visibleTotals.igv)}`, Icon: Receipt, color: 'blue' },
  ];

  const colorMap = {
    blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
    green: { bg: 'bg-green-100', text: 'text-green-600' },
    yellow: { bg: 'bg-yellow-100', text: 'text-yellow-600' },
    orange: { bg: 'bg-orange-100', text: 'text-orange-600' },
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex w-full flex-col gap-8 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <header className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-500">
            Egresos
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">
              Control de gastos
            </h1>
            <div className="flex gap-2">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*,.pdf"
                onChange={handleFileUpload}
                disabled={isScanning}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isScanning}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                {isScanning ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-slate-500 border-t-transparent animate-spin" />
                    Analizando...
                  </>
                ) : (
                  <>
                    <Receipt className="w-4 h-4" />
                    Escanear
                  </>
                )}
              </button>
              <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800">
                <Plus className="w-4 h-4" />
                Registrar Egreso
              </button>
            </div>
          </div>
        </header>

        {syncError && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {syncError}
          </p>
        )}

        {formError && !isModalOpen && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {formError}
          </p>
        )}

        {dirtyExpenses.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 shadow-sm">
            <button
              type="button"
              onClick={() => setShowDirtyPanel((prev) => !prev)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlertCircle className="h-4 w-4" />
                Datos por limpiar: {dirtyExpenses.length} egreso{dirtyExpenses.length > 1 ? 's' : ''} con
                concepto o categoría sospechosa
              </span>
              <span className="text-xs font-medium text-amber-700">
                {showDirtyPanel ? 'Ocultar' : 'Revisar'}
              </span>
            </button>
            {showDirtyPanel && (
              <ul className="divide-y divide-amber-100 border-t border-amber-200">
                {dirtyExpenses.slice(0, 20).map(({ expense, reasons }) => (
                  <li key={expense.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">
                        {expense.documentNumber} · {expense.providerName}
                      </p>
                      <p className="truncate text-xs text-slate-600">
                        “{expense.concept}” — {reasons.join(' · ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleEditExpense(expense)}
                      className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-100"
                    >
                      Corregir
                    </button>
                  </li>
                ))}
                {dirtyExpenses.length > 20 && (
                  <li className="px-4 py-2 text-xs text-amber-700">
                    …y {dirtyExpenses.length - 20} más. Corrige estos primero.
                  </li>
                )}
              </ul>
            )}
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">{card.label}</p>
                </div>
                <div className={`${colorMap[card.color as keyof typeof colorMap].bg} p-3 rounded-lg`}>
                  <card.Icon className={`w-5 h-5 ${colorMap[card.color as keyof typeof colorMap].text}`} />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-slate-900 text-4xl font-bold">{formatCurrencyNoDecimals(card.value)}</p>
                <p className="text-slate-500 text-sm">{card.hint}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Buscar por proveedor, concepto o N° de documento..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStatusFilter('todos')} className={`px-4 py-2 rounded-lg font-medium ${statusFilter === 'todos' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                  Todos
                </button>
                {(['pagado', 'pendiente', 'vencido'] as ExpenseStatus[]).map(status => (
                  <button key={status} onClick={() => setStatusFilter(status)} className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${statusFilter === status ? 'bg-slate-900 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                    {STATUS_META[status].filterPill}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 focus:ring-2 focus:ring-blue-500">
                <option value="todos">Todo el año</option>
                <option value="historico">Todo el histórico</option>
                {monthOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <button onClick={resetFilters} className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg font-medium">
                Restablecer filtros
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 border-y border-slate-200">
                  <tr>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Comprobante</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Proveedor</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Fechas</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Concepto</th>
                    <th className="px-4 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Total</th>
                    <th className="px-4 py-4 text-center text-xs font-bold text-slate-700 uppercase tracking-wider">Estado</th>
                    <th className="px-4 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={7} className="p-6 text-center text-slate-500">Sincronizando...</td></tr>
                  ) : filteredExpenses.length === 0 ? (
                    <tr><td colSpan={7} className="p-6 text-center text-slate-500">No hay egresos que coincidan con tu búsqueda.</td></tr>
                  ) : (
                    filteredExpenses.map((expense) => {
                      let partner = null;
                      if (expense.partnerId) {
                        partner = partners.find((p) => p.id === expense.partnerId);
                      } else {
                        partner = partners.find(
                          (p) =>
                            p.name === expense.providerName ||
                            p.tradeName === expense.providerName,
                        );
                      }
                      const displayName = partner?.name ?? expense.providerName;
                      const displayDocument =
                        partner?.documentNumber ?? expense.providerDocument;
                      return (
                        <tr key={expense.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors group">
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-slate-400" />
                              <div>
                                <p className="text-slate-900 font-semibold">{expense.documentNumber}</p>
                                <p className="text-slate-500 text-xs">{expense.documentType}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                                <span className="text-orange-700 font-semibold text-sm">{getInitials(displayName)}</span>
                              </div>
                              <div>
                                <p className="text-slate-900 font-medium">{displayName}</p>
                                <p className="text-slate-500 text-xs">{displayDocument}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              <div>
                                <p className="text-slate-700 text-sm">{formatDate(expense.issueDate)}</p>
                                <p className="text-slate-500 text-xs">Vence: {formatDate(expense.dueDate)}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 max-w-xs">
                            <p className="text-slate-700 text-sm truncate" title={expense.concept}>{expense.concept}</p>
                            <p className="text-slate-500 text-xs">
                              {expense.category}
                              {expense.clientName && (
                                <span className="ml-2 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                                  {shortenName(expense.clientName, 24)}
                                </span>
                              )}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-right whitespace-nowrap">
                            <span className="text-slate-900 font-semibold">{formatCurrency(expense.totalAmount)}</span>
                          </td>
                          <td className="px-4 py-4 text-center whitespace-nowrap">
                            {STATUS_META[expense.status].badge}
                          </td>
                          <td className="px-4 py-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleEditExpense(expense)}
                                disabled={busyExpenseId === expense.id}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Editar / asignar cliente"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              {expense.status !== 'pagado' ? (
                                <button onClick={() => handleMarkPaid(expense.id)} disabled={busyExpenseId === expense.id} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors">
                                  Marcar pagado
                                </button>
                              ) : (
                                <button onClick={() => handleRevertPaid(expense.id)} disabled={busyExpenseId === expense.id} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors">
                                  Revertir
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteExpense(expense.id)}
                                disabled={busyExpenseId === expense.id}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Eliminar"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingExpenseId(null);
        }}
        title={editingExpenseId ? 'Editar Egreso' : 'Registrar Egreso'}
      >
        <div className={`rounded-xl bg-slate-900 p-4 text-slate-50 ${editingExpenseId ? 'hidden' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                Importar XML (SUNAT)
              </p>
            </div>
            <button
              type="button"
              onClick={triggerXMLUpload}
              disabled={isUploadingXML}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/30 transition hover:bg-white/20 disabled:opacity-60"
            >
              {isUploadingXML ? 'Cargando...' : 'Seleccionar XML'}
            </button>
          </div>
          {xmlUploadMessage && (
            <p className="mt-3 text-sm font-semibold text-emerald-300">{xmlUploadMessage}</p>
          )}
          {xmlUploadError && (
            <p className="mt-3 text-sm font-semibold text-rose-300">{xmlUploadError}</p>
          )}
          <input
            ref={xmlInputRef}
            type="file"
            accept=".xml"
            className="sr-only"
            onChange={handleXMLUpload}
          />
        </div>
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-600">
              Tipo
              <select
                value={form.documentType}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, documentType: event.target.value as ExpenseDocumentType }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                {DOCUMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-600">
              Serie · Número
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                <input
                  value={form.documentSeries}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, documentSeries: event.target.value.toUpperCase() }))
                  }
                  placeholder="F001"
                  maxLength={4}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-blue-500"
                />
                <input
                  value={form.documentNumber}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, documentNumber: event.target.value }))
                  }
                  placeholder="00012345"
                  maxLength={12}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-600">
              Fecha emisión
              <input
                type="date"
                value={form.issueDate}
                onChange={(event) => setForm((prev) => ({ ...prev, issueDate: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
              />
            </label>
            <label className="text-sm font-medium text-slate-600">
              Fecha vencimiento
              <input
                type="date"
                value={form.dueDate}
                onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
              />
            </label>
          </div>
          <label className="text-sm font-medium text-slate-600">
            Proveedor / Profesional
            <input
              value={form.providerName}
              list="partner-options"
              onChange={(event) => {
                const name = event.target.value;
                const match = partners.find(
                  (partner) => partner.name === name || partner.tradeName === name,
                );
                const lastCategory = editingExpenseId ? null : lastCategoryForProvider(name);
                setForm((prev) => ({
                  ...prev,
                  providerName: name,
                  providerDocument: match?.documentNumber ?? prev.providerDocument,
                  category: lastCategory ?? prev.category,
                }));
              }}
              placeholder="Nombre o razón social"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
            />
            <datalist id="partner-options">
              {partners.map((partner) => (
                <option key={partner.id} value={partner.name} />
              ))}
              {partners.map(
                (partner) =>
                  partner.tradeName && (
                    <option key={`${partner.id}-trade`} value={partner.tradeName} />
                  ),
              )}
            </datalist>
          </label>
          <label className="text-sm font-medium text-slate-600">
            RUC / DNI
            <input
              value={form.providerDocument}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, providerDocument: event.target.value }))
              }
              placeholder="Documento"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="text-sm font-medium text-slate-600">
            Concepto
            <input
              value={form.concept}
              onChange={(event) => setForm((prev) => ({ ...prev, concept: event.target.value }))}
              placeholder="Descripción del servicio o producto (mín. 10 caracteres)"
              minLength={10}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="text-sm font-medium text-slate-600">
            Cliente / Proyecto (opcional — habilita margen por cliente)
            <select
              value={form.clientId}
              onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              <option value="">— Sin asignar —</option>
              {clientOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-600">
              Monto base
              <input
                type="number"
                step="0.01"
                value={form.baseAmount}
                onChange={handleAutoIgv}
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
              />
            </label>
            <label className="text-sm font-medium text-slate-600">
              IGV (18%)
              <input
                type="number"
                step="0.01"
                value={form.igvAmount}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, igvAmount: event.target.value }))
                }
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-600">
              Retención IR (8%)
              <input
                type="number"
                step="0.01"
                value={form.irRetention}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, irRetention: event.target.value }))
                }
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
              />
            </label>
            <label className="text-sm font-medium text-slate-600">
              Otros impuestos
              <input
                type="number"
                step="0.01"
                value={form.otherTaxes}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, otherTaxes: event.target.value }))
                }
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
              />
            </label>
          </div>
          <label className="text-sm font-medium text-slate-600">
            Método de pago
            <select
              value={form.paymentMethod}
              onChange={(event) => {
                const method = event.target.value as PaymentMethod;
                setForm((prev) => ({
                  ...prev,
                  paymentMethod: method,
                  alreadyPaid: editingExpenseId
                    ? prev.alreadyPaid
                    : AUTO_PAID_METHODS.includes(method),
                }));
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
            >
              {PAYMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.alreadyPaid}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, alreadyPaid: event.target.checked }))
              }
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>
              Ya está pagado
              <span className="block text-xs font-normal text-slate-500">
                Se registrará como pagado con fecha de emisión (efectivo, tarjeta y Yape lo marcan solos)
              </span>
            </span>
          </label>
          <label className="text-sm font-medium text-slate-600">
            Categoría
            <select
              value={form.category}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, category: event.target.value as ExpenseCategory }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {formError && <p className="text-sm font-semibold text-rose-600">{formError}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
            disabled={isSaving}
          >
            {isSaving
              ? 'Guardando...'
              : editingExpenseId
                ? 'Guardar cambios'
                : 'Registrar egreso'}
          </button>
        </form>
      </Modal>
    </div>
  );
}

function Modal({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex justify-center items-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center flex-shrink-0">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value || 0);
}

function formatCurrencyNoDecimals(value: number) {
  return currencyFormatterNoDecimals.format(value || 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return dateFormatter.format(asLocalDate(value));
}



function buildMonthOptions(list: { issueDate: string }[]) {
  const unique = Array.from(new Set(list.map((item) => toMonthKey(item.issueDate))));
  return unique
    .sort((a, b) => (a > b ? -1 : 1))
    .map((value) => ({ value, label: formatMonthLabel(value) }));
}
