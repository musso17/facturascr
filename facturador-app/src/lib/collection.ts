/**
 * Cobranza de facturas de venta: cuánto debe entrar a cada cuenta.
 *
 *   Total factura = cuenta corriente + detracción (BN) + retención IGV
 *
 * - Detracción (SPOT 12%): solo facturas sujetas (> S/ 700). Estado real:
 *   pendiente / depositada / no aplicada (el cliente pagó el total sin detraer).
 * - Retención IGV (3%): la practican los clientes "agentes de retención" en
 *   operaciones NO sujetas a detracción cuando el pago supera S/ 700 (también
 *   si junta varias facturas chicas). Se descuenta del IGV por pagar, no de la renta.
 */
import { calcDetraction } from './detraction';
import type { DetractionStatus, InvoiceRecord } from './accounting-types';

export const IGV_RETENTION_RATE = 0.03;

export const PAYMENT_ACCOUNTS = [
  'BBVA cuenta corriente',
  'Banco de la Nación (detracciones)',
  'Otra cuenta',
  'Efectivo / caja',
] as const;

export const DETRACTION_STATUS_LABEL: Record<DetractionStatus, string> = {
  pendiente: 'Pendiente',
  depositada: 'Depositada',
  no_aplicada: 'No aplicada',
};

export interface CollectionBreakdown {
  detractionApplies: boolean;
  /** null si la factura no está sujeta a detracción */
  detractionStatus: DetractionStatus | null;
  /** true si nadie confirmó todavía el estado (dato antiguo) */
  detractionUnverified: boolean;
  /** Lo que va (o fue) al Banco de la Nación; 0 si no aplica o no se aplicó */
  detractionAmount: number;
  retentionAmount: number;
  /** La retención es una estimación (cliente agente de retención, aún sin registrar) */
  retentionIsEstimate: boolean;
  /** Lo que debe entrar a la cuenta corriente */
  netToAccount: number;
}

export function getCollectionBreakdown(
  invoice: Pick<InvoiceRecord, 'total' | 'igvRetention' | 'detractionStatus'>,
  options: { isRetentionAgent?: boolean } = {},
): CollectionBreakdown {
  const detraction = calcDetraction(invoice.total);
  const detractionStatus = detraction.applies ? (invoice.detractionStatus ?? 'pendiente') : null;
  const detractionAmount =
    detraction.applies && detractionStatus !== 'no_aplicada' ? detraction.detractionAmount : 0;

  const recordedRetention = invoice.igvRetention ?? 0;
  const retentionIsEstimate =
    recordedRetention === 0 && !detraction.applies && Boolean(options.isRetentionAgent);
  const retentionAmount =
    recordedRetention > 0
      ? recordedRetention
      : retentionIsEstimate
        ? round2(invoice.total * IGV_RETENTION_RATE)
        : 0;

  return {
    detractionApplies: detraction.applies,
    detractionStatus,
    detractionUnverified: detraction.applies && !invoice.detractionStatus,
    detractionAmount,
    retentionAmount,
    retentionIsEstimate,
    netToAccount: round2(invoice.total - detractionAmount - retentionAmount),
  };
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}
