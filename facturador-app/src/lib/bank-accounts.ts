/**
 * Cuentas bancarias de la empresa. No hay tabla propia: una cuenta existe por los
 * movimientos importados con ese nombre (bank_transactions.account_name), más las que el
 * usuario registra a mano antes de importar.
 */
import { normalizeText } from './collection-matching';

export const DEFAULT_ACCOUNT = 'BBVA cuenta corriente';
/** Movimientos importados antes de elegir cuenta quedaron como "Principal" (son de BBVA) */
export const LEGACY_ACCOUNT = 'Principal';

const BANK_WORDS = ['BBVA', 'INTERBANK', 'BCP', 'SCOTIABANK', 'BANBIF', 'PICHINCHA', 'NACION', 'MIBANCO'];

/** Nombre legible a partir de lo que trae el extracto: "Interbank cuenta corriente ···3739" */
export function suggestAccountName(
  bankName: string | null | undefined,
  accountType: string | null | undefined,
  accountNumber: string | null | undefined,
) {
  if (!bankName) return null;
  const type = (accountType ?? 'cuenta').toLowerCase();
  const digits = (accountNumber ?? '').replace(/\D/g, '');
  return `${bankName} ${type}${digits.length >= 4 ? ` ···${digits.slice(-4)}` : ''}`;
}

/** Banco de un nombre de cuenta ("Interbank cuenta corriente ···3739" → INTERBANK) */
export function bankOf(name: string | null | undefined) {
  const text = normalizeText(name ?? '');
  return BANK_WORDS.find((word) => text.split(' ').includes(word)) ?? null;
}

function lastDigits(name: string | null | undefined) {
  return /(\d{4})\D*$/.exec(name ?? '')?.[1] ?? null;
}

/**
 * ¿Es la misma cuenta? Tolera cómo se escribió en la factura ("INTERBANK", "Interbank cte").
 * Mismo banco y, si ambos traen últimos 4 dígitos, que coincidan.
 */
export function sameAccount(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  if (normalizeText(a) === normalizeText(b)) return true;
  const bankA = bankOf(a);
  if (!bankA || bankA !== bankOf(b)) return false;
  const digitsA = lastDigits(a);
  const digitsB = lastDigits(b);
  return !digitsA || !digitsB || digitsA === digitsB;
}

export function accountOfTransaction(accountName: string | null | undefined) {
  return !accountName || accountName === LEGACY_ACCOUNT ? DEFAULT_ACCOUNT : accountName;
}
