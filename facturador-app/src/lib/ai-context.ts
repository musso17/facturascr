import type {
  ExpenseCategory,
  ExpenseRecord,
  InvoiceRecord,
  InvoiceStatus,
} from './accounting-types';

export interface AIInvoiceSummary {
  id: string;
  client: string;
  issueDate: string;
  dueDate: string;
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
  category: string | null;
  description: string;
}

export interface AIExpenseSummary {
  id: string;
  providerName: string;
  concept: string;
  issueDate: string;
  dueDate?: string | null;
  category: ExpenseCategory;
  totalAmount: number;
  paidAmount: number;
  status: ExpenseRecord['status'];
}

export function mapInvoicesForAI(list: InvoiceRecord[]): AIInvoiceSummary[] {
  return list.map((invoice) => ({
    id: invoice.id,
    client: invoice.client,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    total: invoice.total,
    paid: invoice.paid,
    balance: invoice.balance,
    status: invoice.status,
    category: invoice.category ?? null,
    description: invoice.description,
  }));
}

export function mapExpensesForAI(list: ExpenseRecord[]): AIExpenseSummary[] {
  return list.map((expense) => ({
    id: expense.id,
    providerName: expense.providerName,
    concept: expense.concept,
    issueDate: expense.issueDate,
    dueDate: expense.dueDate,
    category: expense.category,
    totalAmount: expense.totalAmount,
    paidAmount: expense.paidAmount,
    status: expense.status,
  }));
}
