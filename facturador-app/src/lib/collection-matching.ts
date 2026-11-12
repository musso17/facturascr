/**
 * Sugerencias de conciliación: qué factura(s) explica cada abono del banco.
 *
 * Un abono puede ser:
 *  - una factura con detracción (total − 12%, con o sin decimales),
 *  - una o varias facturas chicas con retención IGV 3% (cliente agente),
 *  - el total completo (el cliente no aplicó la detracción),
 *  - varias facturas del mismo cliente juntas.
 * El pagador se reconoce por los alias bancarios del cliente, su nombre o RUC.
 */
import type { InvoiceRecord, PartnerRecord } from './accounting-types';
import { calcDetraction, DETRACTION_RATE } from './detraction';
import { IGV_RETENTION_RATE, round2 } from './collection';

export type MatchVariant = 'neto' | 'neto_entero' | 'retencion' | 'total' | 'saldo';

export interface MatchAllocation {
  invoice: InvoiceRecord;
  /** Lo que entró a la cuenta por esta factura */
  received: number;
  retention: number;
  /** El cliente pagó el total sin detraer */
  detractionNotApplied: boolean;
}

export interface MatchSuggestion {
  allocations: MatchAllocation[];
  partner?: PartnerRecord;
  clientName: string;
  score: number; // 0..1
  difference: number; // abono − suma esperada
  reasons: string[];
  /** Alias/nombre del cliente encontrado en la glosa */
  payerMatched: boolean;
}

export interface BankCredit {
  id: string;
  transactionDate: string;
  description: string;
  reference: string | null;
  amount: number;
}

const EXACT = 0.05;
const ROUNDING = 1.0;
const MAX_COMBO = 4;
// Facturas por cliente que entran a las combinaciones (las más antiguas)
const MAX_PER_CLIENT_KNOWN_PAYER = 20;
const MAX_PER_CLIENT = 12;

export function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'SAC', 'S', 'A', 'C', 'SA', 'SRL', 'EIRL', 'DEL', 'DE', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'PERU',
  'E', 'I', 'R', 'L', 'CORP', 'GROUP', 'GRUPO', 'EMPRESA', 'COMPANIA',
]);

function significantWords(name: string) {
  return normalizeText(name)
    .split(' ')
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

/** "G Y Service" y "G Y SERVICE S.A.C" son el mismo cliente */
export function clientNameKey(name: string) {
  return normalizeText(name)
    .split(' ')
    .filter((word) => word && !STOPWORDS.has(word))
    .join(' ');
}

/** El banco corta las glosas: "OPERACIONES DEPORT" debe reconocer "DEPORTE" */
function wordInTokens(word: string, tokens: string[]) {
  return tokens.some(
    (token) => token === word || (token.length >= 5 && word.length > token.length && word.startsWith(token)),
  );
}

/** ¿La glosa del banco menciona a este cliente? */
export function payerMatches(glosa: string, partner: PartnerRecord | undefined, clientName: string) {
  const text = ` ${normalizeText(glosa)} `;
  if (partner) {
    for (const alias of partner.bankAliases) {
      const normalized = normalizeText(alias);
      if (normalized && text.includes(` ${normalized} `)) return { matched: true, via: `alias "${alias}"` };
      if (normalized.length >= 6 && text.includes(normalized)) return { matched: true, via: `alias "${alias}"` };
    }
    if (partner.documentNumber && text.includes(partner.documentNumber)) {
      return { matched: true, via: 'RUC en la glosa' };
    }
  }
  const tokens = text.trim().split(' ');
  const names = [clientName, partner?.name, partner?.tradeName].filter(Boolean) as string[];
  for (const name of names) {
    const words = significantWords(name);
    if (words.length === 0) continue;
    const hits = words.filter((word) => wordInTokens(word, tokens)).length;
    if (hits >= Math.min(2, words.length)) return { matched: true, via: 'nombre del cliente' };
  }
  return { matched: false, via: '' };
}

type Option = { variant: MatchVariant; received: number; retention: number; label: string };

/** Montos con los que una factura puede aparecer en la cuenta corriente */
function amountOptions(invoice: InvoiceRecord, agent: boolean): Option[] {
  if (invoice.paid > 0) {
    return [{ variant: 'saldo', received: invoice.balance, retention: 0, label: 'saldo pendiente' }];
  }
  const total = invoice.total;
  const detraction = calcDetraction(total);
  const options: Option[] = [];
  if (detraction.applies) {
    options.push({ variant: 'neto', received: detraction.netAmount, retention: 0, label: 'neto de detracción' });
    const integer = round2(total - Math.round(total * DETRACTION_RATE));
    if (Math.abs(integer - detraction.netAmount) >= 0.01) {
      options.push({ variant: 'neto_entero', received: integer, retention: 0, label: 'detracción redondeada' });
    }
    options.push({ variant: 'total', received: total, retention: 0, label: 'total SIN detracción' });
  } else {
    const recorded = invoice.igvRetention ?? 0;
    const retention = recorded > 0 ? recorded : round2(total * IGV_RETENTION_RATE);
    if (agent || recorded > 0) {
      options.push({ variant: 'retencion', received: round2(total - retention), retention, label: 'con retención 3%' });
      options.push({ variant: 'total', received: total, retention: 0, label: 'total' });
    } else {
      options.push({ variant: 'total', received: total, retention: 0, label: 'total' });
      options.push({ variant: 'retencion', received: round2(total - retention), retention, label: 'con retención 3%' });
    }
  }
  return options;
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000);
}

function clientKey(invoice: InvoiceRecord, partner?: PartnerRecord) {
  return partner ? `p:${partner.id}` : `n:${clientNameKey(invoice.client)}`;
}

/** Cliente del directorio para una factura: por id, o por nombre tolerando variantes (S.A.C., mayúsculas) */
export function findPartner(invoice: InvoiceRecord, partners: PartnerRecord[]) {
  if (invoice.clientId) {
    const byId = partners.find((p) => p.id === invoice.clientId);
    if (byId) return byId;
  }
  const key = clientNameKey(invoice.client);
  return partners.find(
    (p) =>
      p.role !== 'proveedor' &&
      (p.name === invoice.client ||
        p.tradeName === invoice.client ||
        clientNameKey(p.name) === key ||
        (p.tradeName ? clientNameKey(p.tradeName) === key : false)),
  );
}

function* combinations<T>(items: T[], size: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if (prefix.length === size) {
    yield prefix;
    return;
  }
  for (let i = start; i < items.length; i += 1) {
    yield* combinations(items, size, i + 1, [...prefix, items[i]]);
  }
}

export function suggestMatches(
  credit: BankCredit,
  pendingInvoices: InvoiceRecord[],
  partners: PartnerRecord[],
  limit = 3,
): MatchSuggestion[] {
  const glosa = `${credit.description} ${credit.reference ?? ''}`;
  // Solo facturas emitidas antes del abono (con margen de 3 días)
  const eligible = pendingInvoices.filter(
    (invoice) => invoice.balance > 0 && daysBetween(credit.transactionDate, invoice.issueDate) >= -3,
  );

  const byClient = new Map<string, { partner?: PartnerRecord; name: string; invoices: InvoiceRecord[] }>();
  for (const invoice of eligible) {
    const partner = findPartner(invoice, partners);
    const key = clientKey(invoice, partner);
    const group = byClient.get(key) ?? { partner, name: partner?.name ?? invoice.client, invoices: [] };
    group.invoices.push(invoice);
    byClient.set(key, group);
  }

  const suggestions: MatchSuggestion[] = [];

  for (const group of byClient.values()) {
    const agent = group.partner?.isRetentionAgent ?? false;
    const payer = payerMatches(glosa, group.partner, group.name);
    // Las más antiguas primero: es lo que normalmente se paga
    const invoices = [...group.invoices]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, payer.matched ? MAX_PER_CLIENT_KNOWN_PAYER : MAX_PER_CLIENT);
    // Sin pagador reconocido, combinar muchas facturas da falsos positivos
    const maxCombo = payer.matched ? MAX_COMBO : 2;

    const consider = (allocations: MatchAllocation[], labels: string[]) => {
      const expected = round2(allocations.reduce((sum, a) => sum + a.received, 0));
      const difference = round2(credit.amount - expected);
      const abs = Math.abs(difference);
      if (abs > ROUNDING) return;

      let score = abs <= EXACT ? 0.6 : 0.45;
      const reasons: string[] = [];
      reasons.push(abs <= EXACT ? 'monto exacto' : `difiere ${difference > 0 ? '+' : ''}${difference.toFixed(2)}`);
      if (payer.matched) {
        score += 0.3;
        reasons.push(`pagador: ${payer.via}`);
      }
      // Cercanía al vencimiento de la factura más antigua
      const oldest = allocations[0].invoice;
      const fromDue = daysBetween(credit.transactionDate, oldest.dueDate);
      if (fromDue >= -45 && fromDue <= 90) score += 0.1;
      if (allocations.length > 1) {
        score -= 0.05 * (allocations.length - 1);
        reasons.push(`${allocations.length} facturas juntas`);
      }
      if (allocations.some((a) => a.detractionNotApplied)) {
        score -= 0.1;
        reasons.push('pagó el total sin detracción');
      }
      if (allocations.some((a) => a.retention > 0)) {
        reasons.push('con retención IGV 3%');
        if (!agent) score -= 0.05;
      }
      reasons.push(...labels.filter((label) => !reasons.includes(label)));

      suggestions.push({
        allocations,
        partner: group.partner,
        clientName: group.name,
        score: Math.max(0, Math.min(1, round2(score))),
        difference,
        reasons,
        payerMatched: payer.matched,
      });
    };

    // Una sola factura, todas sus variantes
    for (const invoice of invoices) {
      for (const option of amountOptions(invoice, agent)) {
        consider(
          [
            {
              invoice,
              received: option.received,
              retention: option.retention,
              detractionNotApplied: option.variant === 'total' && calcDetraction(invoice.total).applies,
            },
          ],
          [],
        );
      }
    }

    // Varias facturas del mismo cliente: neto normal, o retención sobre el conjunto
    for (let size = 2; size <= Math.min(maxCombo, invoices.length); size += 1) {
      for (const combo of combinations(invoices, size)) {
        const primary = combo.map((invoice) => {
          const option = amountOptions(invoice, agent)[0];
          return {
            invoice,
            received: option.received,
            retention: option.retention,
            detractionNotApplied: false,
          };
        });
        consider(primary, []);

        // Facturas chicas que juntas superan S/ 700: el agente retiene 3% de todas
        const noDetraction = combo.every((invoice) => !calcDetraction(invoice.total).applies && invoice.paid <= 0);
        const comboTotal = combo.reduce((sum, invoice) => sum + invoice.total, 0);
        if (noDetraction && comboTotal > 700) {
          consider(
            combo.map((invoice) => {
              const retention = round2(invoice.total * IGV_RETENTION_RATE);
              return { invoice, received: round2(invoice.total - retention), retention, detractionNotApplied: false };
            }),
            [],
          );
          // y sin retención (cliente que no es agente)
          if (!agent) {
            consider(
              combo.map((invoice) => ({ invoice, received: invoice.total, retention: 0, detractionNotApplied: false })),
              [],
            );
          }
        }
      }
    }
  }

  // Quita duplicados (mismas facturas) quedándose con el mejor puntaje
  const best = new Map<string, MatchSuggestion>();
  for (const suggestion of suggestions) {
    const key = suggestion.allocations
      .map((a) => a.invoice.recordId)
      .sort()
      .join('+');
    const current = best.get(key);
    if (!current || suggestion.score > current.score) best.set(key, suggestion);
  }

  return Array.from(best.values())
    .sort((a, b) => b.score - a.score || Math.abs(a.difference) - Math.abs(b.difference))
    .slice(0, limit);
}
