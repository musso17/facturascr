export type AccountingStatus = 'pendiente' | 'pagado' | 'vencido';
export type InvoiceStatus = 'Pagado' | 'Pendiente' | 'Vencido';
export type ExpenseStatus = AccountingStatus;

export const ACCOUNTING_STATUS_TO_LABEL: Record<AccountingStatus, InvoiceStatus> = {
  pendiente: 'Pendiente',
  pagado: 'Pagado',
  vencido: 'Vencido',
};

export type PaymentMethod =
  | 'transferencia'
  | 'deposito'
  | 'efectivo'
  | 'tarjeta'
  | 'cheque'
  | 'yape_plin'
  | 'otros';

export type ExpenseDocumentType = 'factura' | 'recibo' | 'boleta';
export type ExpenseCategory =
  | 'servicios'
  | 'materiales'
  | 'personal'
  | 'marketing'
  | 'administrativos'
  | 'equipos'
  | 'financieros'
  | 'otros';

export interface InvoiceFormState {
  id: string;
  client: string;
  clientId?: string | null;
  ruc: string;
  description: string;
  issueDate: string;
  dueDate: string;
  amount: string;
  vat: string;
  paid: string;
  detractionDeposited?: boolean;
}

export interface InvoiceRecord {
  recordId: string;
  id: string;
  client: string;
  clientId?: string | null;
  ruc: string;
  description: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  vat: number;
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
  paymentMethod?: PaymentMethod | null;
  paymentReference?: string | null;
  paymentDate?: string | null;
  retentionIR?: number | null;
  itf?: number | null;
  category?: string | null;
  detractionDeposited?: boolean;
}

export interface SupabaseInvoiceRow {
  id: string;
  invoice_number: string | null;
  client: string | null;
  client_id?: string | null;
  ruc: string | null;
  description: string | null;
  issue_date: string | null;
  due_date: string | null;
  amount: number | null;
  vat: number | null;
  total: number | null;
  paid: number | null;
  payment_method?: PaymentMethod | null;
  payment_reference?: string | null;
  payment_date?: string | null;
  category?: string | null;
  status?: AccountingStatus | null;
  retention_ir?: number | null;
  itf?: number | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ExpenseRecord {
  id: string;
  documentType: ExpenseDocumentType;
  documentSeries?: string | null;
  documentNumber: string;
  issueDate: string;
  dueDate?: string | null;
  partnerId?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  providerName: string;
  providerDocument?: string | null;
  concept: string;
  paymentMethod?: PaymentMethod | null;
  operationNumber?: string | null;
  paymentDate?: string | null;
  baseAmount: number;
  igvAmount: number;
  irRetention: number;
  otherTaxes: number;
  totalAmount: number;
  category: ExpenseCategory;
  status: AccountingStatus;
  paidAmount: number;
  notes?: string | null;
}

export interface SupabaseExpenseRow {
  id: string;
  document_type: ExpenseDocumentType;
  document_series: string | null;
  document_number: string;
  issue_date: string;
  due_date: string | null;
  partner_id: string | null;
  provider_name: string;
  provider_document: string | null;
  concept: string;
  payment_method: PaymentMethod | null;
  operation_number: string | null;
  payment_date: string | null;
  base_amount: number;
  igv_amount: number;
  ir_retention: number;
  other_taxes: number;
  total_amount: number;
  category: ExpenseCategory;
  status: AccountingStatus;
  paid_amount: number;
  notes: string | null;
  attachments?: unknown;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PartnerRecord {
  id: string;
  role: 'cliente' | 'proveedor' | 'ambos';
  name: string;
  tradeName?: string | null;
  documentType: 'ruc' | 'dni' | 'carnet_extranjeria' | 'pasaporte' | 'otros';
  documentNumber: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface SupabasePartnerRow {
  id: string;
  role: 'cliente' | 'proveedor' | 'ambos';
  name: string;
  trade_name: string | null;
  document_type: 'ruc' | 'dni' | 'carnet_extranjeria' | 'pasaporte' | 'otros';
  document_number: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface MonthlyTaxSummary {
  period: string; // YYYY-MM-01
  taxableSales: number;
  igvSales: number;
  taxablePurchases: number;
  igvPurchases: number;
  igvPayable: number;
  irRetentionExpenses: number;
  irWithheldSales: number;
}

export type ProjectStatus = 'en_progreso' | 'completado' | 'cancelado';
export type ProjectBillingStatus = 'pendiente' | 'parcial' | 'facturado';

export interface ProjectRecord {
  id: string;
  name: string;
  clientId?: string | null;
  clientName?: string | null;
  description?: string | null;
  status: ProjectStatus;
  billingStatus: ProjectBillingStatus;
  expectedAmount: number;
  dueDate?: string | null;
}

export interface SupabaseProjectRow {
  id: string;
  name: string;
  client_id?: string | null;
  description?: string | null;
  status: ProjectStatus;
  billing_status: ProjectBillingStatus;
  expected_amount: number;
  due_date?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PartnerPayout {
  bono: number;
  utilidad: number;
  total: number;
}

export interface LiquidationRecord {
  id: string;
  period: string; // YYYY-MM (mes de cierre del trimestre)
  excedente: number;
  reserva: number;
  fondoCrecimiento: number;
  utilidadNeta: number;
  payouts: Record<string, PartnerPayout>; // marcelo | mauricio | edson
  ventas: Record<string, number>;
  notes?: string | null;
  createdAt?: string | null;
}

// Ingreso de gestión: impacta utilidad y caja, nunca los módulos fiscales
export interface ManagementIncomeRecord {
  id: string;
  issueDate: string; // income_date, nombrado así para reusar filterByMonth
  amount: number;
  description: string;
  clientId?: string | null;
  clientName?: string | null;
}

export interface SupabaseManagementIncomeRow {
  id: string;
  income_date: string;
  amount: number;
  description: string;
  client_id: string | null;
  client_name: string | null;
  created_at?: string | null;
}

export interface SupabaseLiquidationRow {
  id: string;
  period: string;
  excedente: number;
  reserva: number;
  fondo_crecimiento: number;
  utilidad_neta: number;
  payouts: Record<string, PartnerPayout>;
  ventas: Record<string, number>;
  notes: string | null;
  created_at: string | null;
}
