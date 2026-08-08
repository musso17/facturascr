'use client';

import { InvoiceFormState, InvoiceRecord, InvoiceStatus } from '@/lib/accounting-types';
import { asLocalDate, round, summarizeInvoices, shortenName, filterByMonth } from '@/lib/accounting-service';
import { calcDetraction } from '@/lib/detraction';
import { useInvoices } from '@/hooks/use-invoices';
import { useManagementIncomes } from '@/hooks/use-management-incomes';
import { usePartners } from '@/hooks/use-partners';
import {
  ChangeEvent,
  FormEvent,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Clock,
  Edit2,
  Eye,
  FileText,
  Folder,
  Plus,
  Search,
  TrendingUp,
  Wallet,
  X,
  Trash2,
} from 'lucide-react';

type InvoiceForm = InvoiceFormState;

type PaymentForm = {
  invoiceId: string;
  amount: string;
};

type SortOption = 'fecha' | 'monto' | 'cliente';
type StatusFilter = 'todos' | InvoiceStatus;
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

const getInitials = (name: string) => {
  if (!name) return '??';
  const parts = name.trim().split(' ');
  if (parts.length > 1) {
    return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
  }
  return (name.substring(0, 2) || '??').toUpperCase();
};

// P3: días de atraso de una factura (0 si no está vencida)
const getDaysOverdue = (invoice: InvoiceRecord) => {
  if (invoice.status !== 'Vencido') return 0;
  const due = asLocalDate(invoice.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
};

type AgingBucket = '0-15' | '16-30' | '+30';

const getAgingBucket = (days: number): AgingBucket =>
  days > 30 ? '+30' : days > 15 ? '16-30' : '0-15';

const getDueDateInfo = (dueDate: string, status: InvoiceStatus) => {
  if (status === 'Pagado') {
    return null;
  }
  const due = asLocalDate(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > 0 && diffDays <= 30) {
    return {
      text: `En ${diffDays} día${diffDays > 1 ? 's' : ''}`,
      className: 'text-orange-600 text-xs font-semibold bg-orange-50 px-2 py-0.5 rounded',
      icon: <AlertCircle className="w-3.5 h-3.5 text-orange-500" />,
    };
  }
  if (diffDays === 0) {
    return {
      text: 'Vence hoy',
      className: 'text-red-600 text-xs font-semibold bg-red-50 px-2 py-0.5 rounded',
      icon: <AlertCircle className="w-3.5 h-3.5 text-red-500" />,
    };
  }
  if (diffDays < 0) {
    return {
      text: `Hace ${Math.abs(diffDays)} día${Math.abs(diffDays) > 1 ? 's' : ''}`,
      className: 'text-red-600 text-xs font-semibold bg-red-50 px-2 py-0.5 rounded',
      icon: <AlertCircle className="w-3.5 h-3.5 text-red-500" />,
    };
  }
  return null;
};

const STATUS_META: Record<
  InvoiceStatus,
  {
    label: string;
    badge: ReactNode;
    filterPill: ReactNode;
  }
> = {
  Pagado: {
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
  Pendiente: {
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
  Vencido: {
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

const INITIAL_FORM: InvoiceForm = {
  id: '',
  client: '',
  clientId: null,
  ruc: '',
  description: '',
  issueDate: '',
  dueDate: '',
  amount: '',
  vat: '18',
  paid: '',
  detractionDeposited: false,
};

const INITIAL_PAYMENT_FORM: PaymentForm = {
  invoiceId: '',
  amount: '',
};

export default function IngresosPage() {
  const {
    invoices,
    isLoading,
    createInvoice,
    createInvoiceFromXML,
    applyManualPayment,
    markAsPaid: markInvoiceAsPaid,
    revertPayment,
    updateInvoice,
    deleteInvoice,
    setDetractionDeposited,
  } = useInvoices();
  const { partners } = usePartners();
  const {
    incomes: otherIncomes,
    tableMissing: otherIncomesTableMissing,
    insertIncome: insertOtherIncome,
    deleteIncome: deleteOtherIncome,
  } = useManagementIncomes();
  const [isOtherIncomeModalOpen, setIsOtherIncomeModalOpen] = useState(false);
  const [otherIncomeForm, setOtherIncomeForm] = useState({
    date: '',
    amount: '',
    description: '',
    clientId: '',
  });
  const [otherIncomeError, setOtherIncomeError] = useState<string | null>(null);
  const [isSavingOtherIncome, setIsSavingOtherIncome] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [monthFilter, setMonthFilter] = useState('todos');
  const [clientFilter, setClientFilter] = useState('todos');
  const [agingFilter, setAgingFilter] = useState<AgingBucket | null>(null);
  const [sortBy] = useState<SortOption>('fecha');
  const [form, setForm] = useState<InvoiceForm>(INITIAL_FORM);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(
    INITIAL_PAYMENT_FORM,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [isUploadingXML, setIsUploadingXML] = useState(false);
  const [xmlUploadError, setXmlUploadError] = useState<string | null>(null);
  const [xmlUploadMessage, setXmlUploadMessage] = useState<string | null>(null);
  const [busyInvoiceId, setBusyInvoiceId] = useState<string | null>(null);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [editingInvoiceRecordId, setEditingInvoiceRecordId] = useState<string | null>(null);
  const xmlInputRef = useRef<HTMLInputElement | null>(null);

  const monthOptions = useMemo(() => buildMonthOptions(invoices), [invoices]);
  const clientOptions = useMemo(() => {
    return partners
      .filter((p) => p.role === 'cliente' || p.role === 'ambos')
      .map((p) => ({ id: p.id, name: p.name }));
  }, [partners]);

  const monthScopedInvoices = useMemo(
    () => filterByMonth(invoices, monthFilter),
    [invoices, monthFilter],
  );

  const filteredInvoices = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return [...monthScopedInvoices]
      .filter((invoice) =>
        statusFilter === 'todos' ? true : invoice.status === statusFilter,
      )
      .filter((invoice) =>
        clientFilter === 'todos' ? true : invoice.clientId === clientFilter,
      )
      .filter((invoice) =>
        agingFilter === null
          ? true
          : invoice.status === 'Vencido' && getAgingBucket(getDaysOverdue(invoice)) === agingFilter,
      )
      .filter((invoice) => {
        if (!term) return true;
        const partner = partners.find(p => p.id === invoice.clientId);
        const tradeName = partner?.tradeName?.toLowerCase() ?? '';
        return (
          invoice.id.toLowerCase().includes(term) ||
          invoice.client.toLowerCase().includes(term) ||
          tradeName.includes(term) ||
          invoice.description.toLowerCase().includes(term) ||
          invoice.ruc.toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        // Vencidos siempre ordenados por días de atraso descendente (P3)
        const overdueA = getDaysOverdue(a);
        const overdueB = getDaysOverdue(b);
        if (statusFilter === 'Vencido' || agingFilter !== null) {
          return overdueB - overdueA;
        }
        switch (sortBy) {
          case 'cliente':
            return a.client.localeCompare(b.client, 'es');
          case 'monto':
            return b.total - a.total;
          case 'fecha':
          default:
            return asLocalDate(b.issueDate).getTime() - asLocalDate(a.issueDate).getTime();
        }
      });
  }, [monthScopedInvoices, searchTerm, statusFilter, clientFilter, agingFilter, sortBy, partners]);

  // P3: aging de cobranza por tramos
  const agingBuckets = useMemo(() => {
    const buckets: Record<AgingBucket, { count: number; total: number }> = {
      '0-15': { count: 0, total: 0 },
      '16-30': { count: 0, total: 0 },
      '+30': { count: 0, total: 0 },
    };
    for (const invoice of monthScopedInvoices) {
      if (invoice.status !== 'Vencido') continue;
      const bucket = getAgingBucket(getDaysOverdue(invoice));
      buckets[bucket].count += 1;
      buckets[bucket].total += invoice.balance;
    }
    return buckets;
  }, [monthScopedInvoices]);

  const hasOverdue =
    agingBuckets['0-15'].count + agingBuckets['16-30'].count + agingBuckets['+30'].count > 0;

  const totals = useMemo(() => summarizeInvoices(monthScopedInvoices), [monthScopedInvoices]);
  const visibleTotals = useMemo(
    () => summarizeInvoices(filteredInvoices),
    [filteredInvoices],
  );

  const monthScopedOtherIncomes = useMemo(
    () => filterByMonth(otherIncomes, monthFilter),
    [otherIncomes, monthFilter],
  );
  const otherIncomesTotal = useMemo(
    () => monthScopedOtherIncomes.reduce((s, i) => s + i.amount, 0),
    [monthScopedOtherIncomes],
  );

  const handleSaveOtherIncome = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(otherIncomeForm.amount);
    if (!otherIncomeForm.date || !amount || amount <= 0 || !otherIncomeForm.description.trim()) {
      setOtherIncomeError('Completa fecha, monto y descripción.');
      return;
    }
    setIsSavingOtherIncome(true);
    const client = partners.find((p) => p.id === otherIncomeForm.clientId);
    const result = await insertOtherIncome({
      issueDate: otherIncomeForm.date,
      amount,
      description: otherIncomeForm.description.trim(),
      clientId: otherIncomeForm.clientId || null,
      clientName: client?.name ?? null,
    });
    if (result.error) {
      setOtherIncomeError(result.error);
    } else {
      setOtherIncomeError(null);
      setOtherIncomeForm({ date: '', amount: '', description: '', clientId: '' });
      setIsOtherIncomeModalOpen(false);
    }
    setIsSavingOtherIncome(false);
  };

  const handleDeleteOtherIncome = async (id: string) => {
    if (!window.confirm('¿Eliminar este ingreso de gestión?')) return;
    await deleteOtherIncome(id);
  };

  const handleClientInput = (value: string) => {
    const sanitized = value.trim();
    const match = partners.find(
      (partner) => partner.name === sanitized || partner.tradeName === sanitized,
    );
    setForm((prev) => ({
      ...prev,
      client: match?.name ?? sanitized,
      clientId: match?.id ?? null,
      ruc: match?.documentNumber ?? '',
    }));
  };

  const handleRucInput = (value: string) => {
    const sanitized = value.trim();
    const match = partners.find((partner) => partner.documentNumber === sanitized);
    setForm((prev) => ({
      ...prev,
      ruc: sanitized,
      clientId: match?.id ?? null,
      client: match?.name ?? prev.client,
    }));
  };

  const handleAddInvoice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.id.trim() || !form.client.trim() || !form.issueDate || !form.dueDate) {
      setFormError('Completa el ID, cliente y ambas fechas.');
      return;
    }
    setIsSavingInvoice(true);
    
    let result;
    if (editingInvoiceRecordId) {
      result = await updateInvoice(editingInvoiceRecordId, form);
    } else {
      result = await createInvoice(form);
    }

    if (result.error) {
      setFormError(result.error);
    } else {
      setForm(INITIAL_FORM);
      setFormError(null);
      setIsInvoiceModalOpen(false);
      setEditingInvoiceRecordId(null);
    }
    setIsSavingInvoice(false);
  };

  const handleEditInvoice = (invoice: import('@/lib/accounting-types').InvoiceRecord) => {
    setForm({
      id: invoice.id,
      client: invoice.client,
      clientId: invoice.clientId || null,
      ruc: invoice.ruc,
      description: invoice.description || '',
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      amount: invoice.amount.toString(),
      vat: invoice.vat.toString(),
      paid: invoice.paid.toString(),
      detractionDeposited: invoice.detractionDeposited ?? false,
    });
    setEditingInvoiceRecordId(invoice.recordId);
    setFormError(null);
    setIsInvoiceModalOpen(true);
  };

  const handleDeleteInvoice = async (invoice: import('@/lib/accounting-types').InvoiceRecord) => {
    if (window.confirm(`¿Seguro que deseas eliminar la factura ${invoice.id}?`)) {
      setBusyInvoiceId(invoice.recordId);
      const result = await deleteInvoice(invoice.recordId);
      if (result.error) {
        alert(result.error);
      }
      setBusyInvoiceId(null);
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
      const result = await createInvoiceFromXML(xmlContent);
      if (result.error) {
        setXmlUploadError(result.error);
      } else if (result.data) {
        setXmlUploadMessage(`Factura ${result.data.id} registrada correctamente.`);
        setTimeout(() => setIsInvoiceModalOpen(false), 1500);
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

  const handleManualPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentForm.invoiceId) {
      setPaymentError('Selecciona una factura.');
      return;
    }
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) {
      setPaymentError('Ingresa un monto válido.');
      return;
    }
    setIsSavingPayment(true);
    const result = await applyManualPayment(paymentForm.invoiceId, amount);
    if (result.error) {
      setPaymentError(result.error);
    } else {
      setPaymentForm(INITIAL_PAYMENT_FORM);
      setPaymentError(null);
      setIsPaymentModalOpen(false);
    }
    setIsSavingPayment(false);
  };

  const handleMarkAsPaid = async (invoiceId: string) => {
    setBusyInvoiceId(invoiceId);
    const result = await markInvoiceAsPaid(invoiceId);
    if (result?.error) {
      console.error(result.error);
    }
    setBusyInvoiceId(null);
  };

  const handleRevertPayment = async (invoiceId: string) => {
    if (!window.confirm('¿Seguro que deseas marcar esta factura como no pagada?')) return;
    setBusyInvoiceId(invoiceId);
    const result = await revertPayment(invoiceId);
    if (result?.error) {
      console.error(result.error);
    }
    setBusyInvoiceId(null);
  };


  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('todos');
    setMonthFilter('todos');
    setClientFilter('todos');
    setAgingFilter(null);
  }

  const buildReminder = (invoice: InvoiceRecord) => {
    const days = getDaysOverdue(invoice);
    const partner = invoice.clientId
      ? partners.find((p) => p.id === invoice.clientId)
      : partners.find((p) => p.name === invoice.client || p.tradeName === invoice.client);
    const subject = `Recordatorio de pago — Factura ${invoice.id}`;
    const body = `Estimados,\n\nLes recordamos que la factura ${invoice.id} por ${formatCurrency(invoice.balance)} venció hace ${days} día${days > 1 ? 's' : ''} (${formatDate(invoice.dueDate)}).\n\nAgradecemos programar el pago a la brevedad.\n\nSaludos,\nCerezo`;
    if (partner?.email) {
      window.open(
        `mailto:${partner.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
        '_blank',
      );
    } else {
      void navigator.clipboard.writeText(`${subject}\n\n${body}`);
      alert('El cliente no tiene email registrado. Recordatorio copiado al portapapeles.');
    }
  };

  const summaryCards = [
    {
      label: 'Facturado',
      value: totals.facturado,
      hint: `En pantalla: ${formatCurrencyNoDecimals(visibleTotals.facturado)}`,
      Icon: TrendingUp,
      color: 'blue',
    },
    {
      label: 'Pagado',
      value: totals.pagado,
      hint: `En pantalla: ${formatCurrencyNoDecimals(visibleTotals.pagado)}`,
      Icon: CheckCircle,
      color: 'green',
    },
    {
      label: 'Pendiente',
      value: totals.pendiente,
      hint: `En pantalla: ${formatCurrencyNoDecimals(visibleTotals.pendiente)}`,
      Icon: Clock,
      color: 'yellow',
    },
    {
      label: 'Vencido',
      value: totals.vencido,
      hint: `En pantalla: ${formatCurrencyNoDecimals(visibleTotals.vencido)}`,
      Icon: AlertCircle,
      color: 'red',
    },
  ];

  const colorMap = {
    blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
    green: { bg: 'bg-green-100', text: 'text-green-600' },
    yellow: { bg: 'bg-yellow-100', text: 'text-yellow-600' },
    red: { bg: 'bg-red-100', text: 'text-red-600' },
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex w-full flex-col gap-8 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <header className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-500">
            Tablero financiero
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">
              Control de facturación
            </h1>
            <div className="flex items-center gap-2">
              <a href="https://drive.google.com/drive/folders/1SRpif_lAiOIg35kM6Jb7vBqGS10bn-xK?usp=sharing" target="_blank" rel="noreferrer" className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-50 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors">
                <Folder className="w-4 h-4" />
                Facturas en Drive
              </a>
              <button onClick={() => setIsPaymentModalOpen(true)} className="px-4 py-2 text-sm font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors">
                Registrar Pago
              </button>
              <button
                onClick={() => {
                  setOtherIncomeError(null);
                  setIsOtherIncomeModalOpen(true);
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-teal-50 border border-teal-200 text-teal-700 rounded-lg hover:bg-teal-100 transition-colors"
                title="Ingreso de gestión: impacta la utilidad, no los módulos fiscales"
              >
                <Wallet className="w-4 h-4" />
                Otro ingreso
              </button>
              <button onClick={() => {
                setForm(INITIAL_FORM);
                setEditingInvoiceRecordId(null);
                setFormError(null);
                setIsInvoiceModalOpen(true);
              }} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                <Plus className="w-4 h-4" />
                Agregar Factura
              </button>
            </div>
          </div>
        </header>

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

        {hasOverdue && (
          <section className="rounded-xl border border-red-200 bg-white shadow-sm">
            <div className="px-5 pt-4 pb-1">
              <h2 className="text-sm font-bold uppercase tracking-wide text-red-700">
                Aging de cobranza — vencidos por antigüedad
              </h2>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-3">
              {(
                [
                  { bucket: '0-15' as AgingBucket, label: '0–15 días', tone: 'amber' },
                  { bucket: '16-30' as AgingBucket, label: '16–30 días', tone: 'orange' },
                  { bucket: '+30' as AgingBucket, label: 'Más de 30 días', tone: 'red' },
                ]
              ).map(({ bucket, label, tone }) => {
                const data = agingBuckets[bucket];
                const active = agingFilter === bucket;
                const toneMap = {
                  amber: 'border-amber-200 bg-amber-50 text-amber-800',
                  orange: 'border-orange-200 bg-orange-50 text-orange-800',
                  red: 'border-red-200 bg-red-50 text-red-800',
                };
                return (
                  <button
                    key={bucket}
                    type="button"
                    onClick={() => setAgingFilter(active ? null : bucket)}
                    className={`rounded-xl border p-4 text-left transition-all ${toneMap[tone as keyof typeof toneMap]} ${
                      active ? 'ring-2 ring-slate-900' : 'hover:shadow-md'
                    } ${data.count === 0 ? 'opacity-45' : ''}`}
                  >
                    <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
                    <p className="mt-1 text-2xl font-black">{formatCurrencyNoDecimals(data.total)}</p>
                    <p className="text-xs font-medium">
                      {data.count} factura{data.count !== 1 ? 's' : ''}
                      {active ? ' · filtrando' : ''}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {monthScopedOtherIncomes.length > 0 && (
          <section className="rounded-xl border border-teal-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-teal-100">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-teal-700">
                <Wallet className="h-4 w-4" />
                Otros ingresos (gestión) — no fiscales
              </h2>
              <p className="text-sm font-bold text-teal-700">{formatCurrency(otherIncomesTotal)}</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {monthScopedOtherIncomes.map((income) => (
                <li key={income.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{income.description}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(income.issueDate)}
                      {income.clientName && <> · {income.clientName}</>}
                      <span className="ml-2 inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase text-teal-700">
                        Gestión
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-slate-900">{formatCurrency(income.amount)}</span>
                    <button
                      onClick={() => handleDeleteOtherIncome(income.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Buscar por ID, cliente, descripción o RUC..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStatusFilter('todos')} className={`px-4 py-2 rounded-lg font-medium ${statusFilter === 'todos' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                  Todos
                </button>
                {(['Pagado', 'Pendiente', 'Vencido'] as Exclude<StatusFilter, 'todos'>[]).map(status => (
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
              <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 focus:ring-2 focus:ring-blue-500">
                <option value="todos">Todos los clientes</option>
                {clientOptions.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
              </select>
              <button onClick={resetFilters} className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg font-medium">
                Restablecer filtros
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-[1100px] text-left text-sm">
                <thead className="bg-slate-50 border-y border-slate-200">
                  <tr>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Factura</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Cliente</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Emisión</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Vencimiento</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Descripción</th>
                    <th className="px-4 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Total</th>
                    <th className="px-4 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Pagado</th>
                    <th className="px-4 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Saldo</th>
                    <th className="px-4 py-4 text-center text-xs font-bold text-slate-700 uppercase tracking-wider">Estado</th>
                    <th className="px-4 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={10} className="p-6 text-center text-slate-500">Sincronizando con Supabase...</td></tr>
                  ) : filteredInvoices.length === 0 ? (
                    <tr><td colSpan={10} className="p-6 text-center text-slate-500">No hay facturas que coincidan con tu búsqueda o filtros.</td></tr>
                  ) : (
                    filteredInvoices.map((invoice) => {
                      const dueDateInfo = getDueDateInfo(invoice.dueDate, invoice.status);
                      const daysOverdue = getDaysOverdue(invoice);
                      const isCritical = daysOverdue > 30;
                      const detraction = calcDetraction(invoice.total);
                      let partner = null;
                      if (invoice.clientId) {
                        partner = partners.find((p) => p.id === invoice.clientId);
                      } else {
                        partner = partners.find(
                          (p) => p.name === invoice.client || p.tradeName === invoice.client,
                        );
                      }
                      const displayName = partner?.name ?? invoice.client;
                      const displayRuc = partner?.documentNumber ?? invoice.ruc;
                      return (
                        <tr
                          key={invoice.recordId || invoice.id}
                          className={`border-b transition-colors group ${
                            isCritical
                              ? 'border-red-200 bg-red-50/70 hover:bg-red-50'
                              : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-slate-900 font-semibold">{invoice.id}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                                <span className="text-blue-700 font-semibold text-sm">{getInitials(displayName)}</span>
                              </div>
                              <div>
                                <p className="text-slate-900 font-medium">{shortenName(displayName)}</p>
                                <p className="text-slate-500 text-xs">{displayRuc}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-slate-700 text-sm">{formatDate(invoice.issueDate)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {dueDateInfo?.icon ?? <Calendar className="w-3.5 h-3.5 text-slate-400" />}
                              <span className="text-slate-900 font-medium text-sm">{formatDate(invoice.dueDate)}</span>
                              {invoice.status === 'Vencido' ? (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-black ${
                                    isCritical ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'
                                  }`}
                                  title={`Vencida hace ${daysOverdue} días`}
                                >
                                  {daysOverdue}d
                                </span>
                              ) : (
                                dueDateInfo && <span className={dueDateInfo.className}>{dueDateInfo.text}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4 max-w-xs">
                            <p className="text-slate-700 text-sm truncate" title={invoice.description}>{invoice.description}</p>
                          </td>
                          <td className="px-4 py-4 text-right whitespace-nowrap">
                            <span className="text-slate-900 font-semibold">{formatCurrency(invoice.total)}</span>
                            {detraction.applies && (
                              <p className="text-[11px] text-slate-500" title="Detracción SPOT 12% al Banco de la Nación">
                                Detracción: {formatCurrency(detraction.detractionAmount)}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right whitespace-nowrap">
                            <span className="text-green-600 font-medium">{formatCurrency(invoice.paid)}</span>
                            {detraction.applies && invoice.status === 'Pagado' && (
                              <p className="text-[11px] text-slate-500">
                                CC {formatCurrency(detraction.netAmount)} · BN{' '}
                                {formatCurrency(detraction.detractionAmount)}
                              </p>
                            )}
                            {detraction.applies && (
                              <label className="mt-1 flex items-center justify-end gap-1.5 text-[11px] font-medium text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={invoice.detractionDeposited ?? false}
                                  onChange={(e) =>
                                    void setDetractionDeposited(invoice.recordId, e.target.checked)
                                  }
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                                />
                                Detracción depositada
                              </label>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right whitespace-nowrap">
                            <span className={`font-bold text-base ${invoice.balance > 0 ? 'text-red-600' : 'text-slate-800'}`}>{formatCurrency(invoice.balance)}</span>
                          </td>
                          <td className="px-4 py-4 text-center whitespace-nowrap">
                            {STATUS_META[invoice.status].badge}
                          </td>
                          <td className="px-4 py-4 text-right whitespace-nowrap">
                            {isCritical && (
                              <button
                                onClick={() => buildReminder(invoice)}
                                className="mb-1.5 inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-red-700 transition-colors"
                                title={`Vencida hace ${daysOverdue} días — enviar recordatorio`}
                              >
                                <AlertCircle className="h-3.5 w-3.5" />
                                Recordatorio
                              </button>
                            )}
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              {invoice.status === 'Vencido' && !isCritical && (
                                <button
                                  onClick={() => buildReminder(invoice)}
                                  className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-xs font-semibold transition-colors"
                                  title="Enviar recordatorio de pago"
                                >
                                  Recordatorio
                                </button>
                              )}
                              <button onClick={() => handleEditInvoice(invoice)} disabled={busyInvoiceId === invoice.recordId} className="p-1.5 text-slate-400 hover:text-blue-600 rounded bg-slate-50 hover:bg-blue-50 transition-colors" title="Editar">
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDeleteInvoice(invoice)} disabled={busyInvoiceId === invoice.recordId} className="p-1.5 text-slate-400 hover:text-red-600 rounded bg-slate-50 hover:bg-red-50 transition-colors" title="Eliminar">
                                <Trash2 className="w-4 h-4" />
                              </button>
                              {invoice.status !== 'Pagado' ? (
                                <button onClick={() => handleMarkAsPaid(invoice.recordId)} disabled={busyInvoiceId === invoice.recordId} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors">
                                  Marcar pagado
                                </button>
                              ) : (
                                <button onClick={() => handleRevertPayment(invoice.recordId)} disabled={busyInvoiceId === invoice.recordId} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors">
                                  Deshacer pago
                                </button>
                              )}
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
        isOpen={isInvoiceModalOpen}
        onClose={() => setIsInvoiceModalOpen(false)}
        title={editingInvoiceRecordId ? "Editar Factura" : "Agregar Factura"}
      >
        <div className="mt-4 rounded-xl bg-slate-900 p-4 text-slate-50">
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
        <form className="mt-4 space-y-4" onSubmit={handleAddInvoice}>
          <div className="grid gap-3">
            <InputField
              label="ID de factura"
              value={form.id}
              onChange={(value) => setForm((prev) => ({ ...prev, id: value }))}
              placeholder="E001-200"
              required
            />
            <InputField
              label="Cliente"
              value={form.client}
              onChange={(value) => handleClientInput(value)}
              placeholder="Nombre del cliente"
              required
              list="client-name-options"
            />
            <datalist id="client-name-options">
              {partners.map((partner) => (
                <option key={partner.id} value={partner.name} />
              ))}
              {partners.map((partner) =>
                partner.tradeName ? (
                  <option key={`${partner.id}-trade`} value={partner.tradeName} />
                ) : null,
              )}
            </datalist>
            <label className="text-sm font-medium text-slate-600">
              RUC
              <input
                list="clients-ruc-options"
                value={form.ruc}
                onChange={(event) => handleRucInput(event.target.value)}
                placeholder="12345678901"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500"
              />
              <datalist id="clients-ruc-options">
                {partners.map((partner) => (
                  <option key={partner.id} value={partner.documentNumber}>
                    {partner.name}
                  </option>
                ))}
              </datalist>
            </label>
            <InputField
              label="Descripción"
              value={form.description}
              onChange={(value) =>
                setForm((prev) => ({ ...prev, description: value }))
              }
              placeholder="Servicio prestado"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField
              label="Fecha emisión"
              type="date"
              value={form.issueDate}
              onChange={(value) =>
                setForm((prev) => ({ ...prev, issueDate: value }))
              }
              required
            />
            <InputField
              label="Fecha vencimiento"
              type="date"
              value={form.dueDate}
              onChange={(value) => setForm((prev) => ({ ...prev, dueDate: value }))}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField
              label="Monto facturado (sin IGV)"
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(value) => setForm((prev) => ({ ...prev, amount: value }))}
              placeholder="0.00"
            />
            <InputField
              label="IGV %"
              type="number"
              step="0.1"
              value={form.vat}
              onChange={(value) => setForm((prev) => ({ ...prev, vat: value }))}
            />
          </div>
          {(() => {
            const estimatedTotal = round(
              (Number(form.amount) || 0) * (1 + (Number(form.vat) || 0) / 100),
            );
            const detraction = calcDetraction(estimatedTotal);
            return (
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 space-y-2">
                <p>
                  Total estimado:{' '}
                  <span className="font-semibold text-slate-900">{formatCurrency(estimatedTotal)}</span>
                </p>
                {detraction.applies && (
                  <>
                    <p className="text-xs text-slate-500">
                      Sujeta a detracción SPOT (12%): el cliente deposita{' '}
                      <span className="font-semibold text-slate-700">
                        {formatCurrency(detraction.detractionAmount)}
                      </span>{' '}
                      al Banco de la Nación y recibes{' '}
                      <span className="font-semibold text-slate-700">
                        {formatCurrency(detraction.netAmount)}
                      </span>{' '}
                      en tu cuenta corriente.
                    </p>
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.detractionDeposited ?? false}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, detractionDeposited: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      Detracción ya depositada en el BN
                    </label>
                  </>
                )}
              </div>
            );
          })()}
          {formError && (
            <p className="text-sm font-medium text-rose-600">{formError}</p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
            disabled={isSavingInvoice}
          >
            {isSavingInvoice ? 'Guardando...' : 'Guardar factura'}
          </button>
        </form>
      </Modal>

      <Modal
        isOpen={isOtherIncomeModalOpen}
        onClose={() => setIsOtherIncomeModalOpen(false)}
        title="Registrar Otro Ingreso (Gestión)"
      >
        <div className="mt-2 rounded-lg bg-teal-50 border border-teal-100 px-3 py-2 text-xs text-teal-800">
          Este ingreso impacta la utilidad, la caja real y el reparto de utilidades, pero{' '}
          <strong>no</strong> aparece en facturación ni en los cálculos de impuestos (IGV/renta).
        </div>
        {otherIncomesTableMissing && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            Falta crear la tabla en Supabase: ejecuta{' '}
            <code className="rounded bg-amber-100 px-1 font-mono">supabase/migration-otros-ingresos.sql</code>{' '}
            en el SQL Editor y recarga.
          </div>
        )}
        <form className="mt-4 space-y-4" onSubmit={handleSaveOtherIncome}>
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField
              label="Fecha"
              type="date"
              value={otherIncomeForm.date}
              onChange={(value) => setOtherIncomeForm((prev) => ({ ...prev, date: value }))}
              required
            />
            <InputField
              label="Monto (S/)"
              type="number"
              step="0.01"
              value={otherIncomeForm.amount}
              onChange={(value) => setOtherIncomeForm((prev) => ({ ...prev, amount: value }))}
              placeholder="3675.00"
              required
            />
          </div>
          <InputField
            label="Descripción"
            value={otherIncomeForm.description}
            onChange={(value) => setOtherIncomeForm((prev) => ({ ...prev, description: value }))}
            placeholder="Origen del ingreso"
            required
          />
          <label className="text-sm font-medium text-slate-600">
            Cliente (opcional — para margen por cliente)
            <select
              value={otherIncomeForm.clientId}
              onChange={(event) =>
                setOtherIncomeForm((prev) => ({ ...prev, clientId: event.target.value }))
              }
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
          {otherIncomeError && (
            <p className="text-sm font-medium text-rose-600">{otherIncomeError}</p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg bg-teal-600 py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60"
            disabled={isSavingOtherIncome || otherIncomesTableMissing}
          >
            {isSavingOtherIncome ? 'Guardando...' : 'Registrar ingreso de gestión'}
          </button>
        </form>
      </Modal>

      <Modal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        title="Registrar Pago Manual"
      >
        <form className="mt-4 space-y-4" onSubmit={handleManualPayment}>
          <label className="text-sm font-medium text-slate-600">
            Factura
            <select
              value={paymentForm.invoiceId}
              onChange={(event) =>
                setPaymentForm((prev) => ({
                  ...prev,
                  invoiceId: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="">Selecciona una factura pendiente</option>
              {invoices.filter(inv => inv.status !== 'Pagado').map((invoice) => (
                <option key={invoice.recordId} value={invoice.recordId}>
                  {invoice.id} · {shortenName(invoice.client)} ({formatCurrency(invoice.balance)})
                </option>
              ))}
            </select>
          </label>
          <InputField
            label="Monto a registrar"
            type="number"
            step="0.01"
            value={paymentForm.amount}
            onChange={(value) =>
              setPaymentForm((prev) => ({ ...prev, amount: value }))
            }
            placeholder="0.00"
          />
          {paymentError && (
            <p className="text-sm font-medium text-rose-600">{paymentError}</p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            disabled={isSavingPayment}
          >
            {isSavingPayment ? 'Aplicando...' : 'Aplicar pago'}
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
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


function InputField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  step,
  list,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  step?: string;
  list?: string;
}) {
  return (
    <label className="block text-sm font-medium text-slate-600">
      {label}
      <input
        list={list}
        value={value}
        type={type}
        step={step}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500"
      />
    </label>
  );
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value || 0);
}

function formatCurrencyNoDecimals(value: number) {
  return currencyFormatterNoDecimals.format(value || 0);
}

function formatDate(value: string) {
  if (!value) return '—';
  return dateFormatter.format(asLocalDate(value));
}

function formatMonthKey(value: string) {
  return asLocalDate(value).toISOString().slice(0, 7);
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, 1);
  return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(date);
}

function buildMonthOptions(list: { issueDate: string }[]) {
  const unique = Array.from(new Set(list.map((invoice) => formatMonthKey(invoice.issueDate))));
  return unique
    .sort((a, b) => (a > b ? -1 : 1))
    .map((value) => ({ value, label: formatMonthLabel(value) }));
}


