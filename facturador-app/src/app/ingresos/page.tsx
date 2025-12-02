'use client';

import { InvoiceFormState, InvoiceStatus } from '@/lib/accounting-types';
import { asLocalDate, round, summarizeInvoices, shortenName } from '@/lib/accounting-service';
import { useInvoices } from '@/hooks/use-invoices';
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
  Plus,
  Search,
  TrendingUp,
  X,
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
  } = useInvoices();
  const { partners } = usePartners();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [monthFilter, setMonthFilter] = useState('todos');
  const [clientFilter, setClientFilter] = useState('todos');
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
  }, [monthScopedInvoices, searchTerm, statusFilter, clientFilter, sortBy, partners]);

  const totals = useMemo(() => summarizeInvoices(monthScopedInvoices), [monthScopedInvoices]);
  const visibleTotals = useMemo(
    () => summarizeInvoices(filteredInvoices),
    [filteredInvoices],
  );

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
    const result = await createInvoice(form);
    if (result.error) {
      setFormError(result.error);
    } else {
      setForm(INITIAL_FORM);
      setFormError(null);
      setIsInvoiceModalOpen(false);
    }
    setIsSavingInvoice(false);
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

  // Revert payment handler removed because not used in UI; keep revertInvoicePayment available from hooks
  
  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('todos');
    setMonthFilter('todos');
    setClientFilter('todos');
  }

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
              <button onClick={() => setIsPaymentModalOpen(true)} className="px-4 py-2 text-sm font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50">
                Registrar Pago
              </button>
              <button onClick={() => setIsInvoiceModalOpen(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800">
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
                        <tr key={invoice.recordId || invoice.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors group">
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
                              {dueDateInfo && <span className={dueDateInfo.className}>{dueDateInfo.text}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-4 max-w-xs">
                            <p className="text-slate-700 text-sm truncate" title={invoice.description}>{invoice.description}</p>
                          </td>
                          <td className="px-4 py-4 text-right whitespace-nowrap">
                            <span className="text-slate-900 font-semibold">{formatCurrency(invoice.total)}</span>
                          </td>
                          <td className="px-4 py-4 text-right whitespace-nowrap">
                            <span className="text-green-600 font-medium">{formatCurrency(invoice.paid)}</span>
                          </td>
                          <td className="px-4 py-4 text-right whitespace-nowrap">
                            <span className={`font-bold text-base ${invoice.balance > 0 ? 'text-red-600' : 'text-slate-800'}`}>{formatCurrency(invoice.balance)}</span>
                          </td>
                          <td className="px-4 py-4 text-center whitespace-nowrap">
                            {STATUS_META[invoice.status].badge}
                          </td>
                          <td className="px-4 py-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-blue-600 transition-colors" title="Ver detalles"><Eye className="w-3.5 h-3.5" /></button>
                              <button className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-green-600 transition-colors" title="Editar"><Edit2 className="w-3.5 h-3.5" /></button>
                              {invoice.status !== 'Pagado' && (
                                <button onClick={() => handleMarkAsPaid(invoice.recordId)} disabled={busyInvoiceId === invoice.recordId} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors">
                                  Marcar pagado
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
        title="Agregar Factura"
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
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <p>
              Total estimado: 
              <span className="font-semibold text-slate-900">
                {formatCurrency(
                  round((Number(form.amount) || 0) * (1 + (Number(form.vat) || 0) / 100)),
                )}
              </span>
            </p>
          </div>
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

function filterByMonth<T extends { issueDate: string }>(list: T[], month: string) {
  if (month === 'todos') return list;
  return list.filter((item) => formatMonthKey(item.issueDate) === month);
}
