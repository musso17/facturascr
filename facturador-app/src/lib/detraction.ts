/**
 * Peruvian SPOT (Sistema de Pago de Obligaciones Tributarias)
 * Detracción rules for services — updated 2024.
 *
 * For Cerezo (audiovisual / creative services):
 * - Applies to invoices (facturas) ≥ S/ 700
 * - Rate: 12% of the invoice total
 * - The client deposits 12% to the company's BN detraction account
 * - The company receives 88% to their regular bank account
 */

export const DETRACTION_THRESHOLD = 700;   // S/ 700 minimum to apply
export const DETRACTION_RATE     = 0.12;   // 12%

export interface DetractionBreakdown {
  /** Full invoice amount */
  total: number;
  /** 12% to BN detraction account (only if total >= threshold) */
  detractionAmount: number;
  /** Amount the company actually receives in their bank account (88%) */
  netAmount: number;
  /** Whether detraction applies */
  applies: boolean;
}

/**
 * Calculate detraction breakdown for a given invoice total.
 */
export function calcDetraction(total: number): DetractionBreakdown {
  if (total < DETRACTION_THRESHOLD) {
    return {
      total,
      detractionAmount: 0,
      netAmount: total,
      applies: false,
    };
  }

  const detractionAmount = round2(total * DETRACTION_RATE);
  const netAmount = round2(total - detractionAmount);

  return {
    total,
    detractionAmount,
    netAmount,
    applies: true,
  };
}

/**
 * Given a bank deposit amount, find the invoice total it corresponds to.
 * Useful when the deposit is 88% and we need to reverse-calculate the invoice.
 * Returns the likely full invoice total, or null if doesn't match any standard scenario.
 */
export function reverseDetraction(depositAmount: number): number {
  // If the deposit is net (88%), the full invoice would be deposit / 0.88
  return round2(depositAmount / (1 - DETRACTION_RATE));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
