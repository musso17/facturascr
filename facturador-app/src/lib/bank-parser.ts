/**
 * Bank Statement Parser
 *
 * Parses CSV/Excel files from Peruvian banks (BCP, Interbank, BBVA)
 * into a normalized format for import.
 */

import type { BankImportResult, ParsedBankRow } from './bank-types';

// ─── Format Detection ────────────────────────────────────────────────

type BankFormat = 'bcp' | 'interbank' | 'bbva' | 'generic';

interface ColumnMapping {
  dateCol: number;
  descriptionCol: number;
  amountCol: number | null; // single amount column (signed)
  creditCol: number | null; // separate credit column
  debitCol: number | null;  // separate debit column
  balanceCol: number | null;
  referenceCol: number | null;
  valueDateCol: number | null;
}

/**
 * Main entry point: parse a bank statement file (CSV or Excel).
 */
export async function parseBankStatement(file: File): Promise<BankImportResult> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  let rawRows: string[][];

  if (extension === 'csv' || extension === 'txt') {
    const text = await file.text();
    rawRows = parseCSV(text);
  } else if (extension === 'xlsx' || extension === 'xls') {
    rawRows = await parseExcel(file);
  } else if (extension === 'pdf') {
    rawRows = await parsePDF(file);
  } else {
    return {
      rows: [],
      bankName: null,
      accountName: null,
      errors: [`Formato no soportado: .${extension}. Usa CSV, Excel o PDF.`],
      skippedCount: 0,
    };
  }

  if (rawRows.length < 2) {
    return {
      rows: [],
      bankName: null,
      accountName: null,
      errors: ['El archivo está vacío o no tiene suficientes filas.'],
      skippedCount: 0,
    };
  }

  const { format, bankName, accountName, dataStartRow } = detectFormat(rawRows);
  const headerRow = rawRows[dataStartRow > 0 ? dataStartRow - 1 : 0];
  const mapping = mapColumns(headerRow, format);

  const rows: ParsedBankRow[] = [];
  const errors: string[] = [];
  let skippedCount = 0;

  for (let i = dataStartRow; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every((cell) => !cell?.trim())) {
      skippedCount++;
      continue;
    }

    try {
      const parsed = parseRow(row, mapping, format);
      if (parsed) {
        rows.push(parsed);
      } else {
        skippedCount++;
      }
    } catch (e) {
      errors.push(`Fila ${i + 1}: ${e instanceof Error ? e.message : 'Error desconocido'}`);
      skippedCount++;
    }
  }

  return { rows, bankName, accountName, errors, skippedCount };
}

// ─── CSV Parser ──────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((char === ',' || char === ';') && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

// ─── PDF Parser (BBVA) ───────────────────────────────────────────────

async function parsePDF(file: File): Promise<string[][]> {
  const { extractText } = await import('unpdf');
  const buffer = await file.arrayBuffer();
  const result = await extractText(new Uint8Array(buffer));
  const pages: string[] = Array.isArray(result.text) ? result.text : [String(result.text)];
  const fullText = pages.join('\n');
  const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Extract the year from the footer (e.g. "30-01-2026")
  let statementYear = String(new Date().getFullYear());
  for (const line of lines) {
    const dateMatch = line.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
    if (dateMatch) {
      statementYear = dateMatch[3]!;
    }
  }

  // Detect BBVA format: look for the actual column header
  // The PDF has "VALOR DESCRIPCIÓN OFICINA CAN N° OPER. CARGO/ABONO ITF SALDO"
  // followed by "CONTABLE" — data starts after "CONTABLE"
  let headerIdx = lines.findIndex(l => l.includes('CARGO/ABONO'));
  if (headerIdx >= 0) {
    // Check if next line is "CONTABLE" (continuation of header)
    if (lines[headerIdx + 1]?.includes('CONTABLE')) {
      headerIdx = headerIdx + 1; // Data starts after "CONTABLE"
    }
  } else {
    // Fallback: look for "CONTABLE" directly
    headerIdx = lines.findIndex(l => l === 'CONTABLE');
  }

  if (headerIdx < 0) {
    // Not a recognized BBVA PDF — return empty
    return [];
  }

  // After the header, BBVA PDFs dump each column sequentially.
  // Instead of a state machine, we collect all lines by type then split by count.
  const dataLines = lines.slice(headerIdx + 1);

  const datePattern = /^\d{1,2}-\d{1,2}$/;
  const amountPattern = /^-?[\d,]+\.\d{2}$/;

  // Collect lines into typed groups in order of appearance
  const allDates: string[] = [];
  const allDescriptions: string[] = [];
  const allAmounts: string[] = [];
  const allOpNumbers: string[] = [];
  // We track which "phase" we're in based on what we see
  let phase: 'dates' | 'text' | 'numbers' | 'amounts' = 'dates';

  for (const line of dataLines) {
    // Stop at footer
    if (line.includes('CODIGO CUENTA') || line.includes('BANCA POR') ||
        line.includes('SALDO A NUESTRO') || line.includes('RECLAMOS') ||
        line.includes('EN CASO DE')) break;

    // Skip ITF summary lines
    if (line.includes('TOTALES POR ITF') || line.startsWith('CARGOS ') ||
        line.startsWith('ABONOS ') || line.startsWith('DEVOLUCIONES') ||
        line.startsWith('PAGOS ')) continue;

    const isDate = datePattern.test(line);
    const isAmount = amountPattern.test(line);
    const isOpNum = /^\d{3}$/.test(line);

    if (phase === 'dates') {
      if (isDate) { allDates.push(line); }
      else { phase = 'text'; allDescriptions.push(line); }
    } else if (phase === 'text') {
      if (isOpNum) { phase = 'numbers'; allOpNumbers.push(line); }
      else if (isAmount) { phase = 'amounts'; allAmounts.push(line); }
      else { allDescriptions.push(line); }
    } else if (phase === 'numbers') {
      if (isAmount) { phase = 'amounts'; allAmounts.push(line); }
      else if (isOpNum) { allOpNumbers.push(line); }
    } else if (phase === 'amounts') {
      if (isAmount) { allAmounts.push(line); }
    }
  }

  // Filter out non-transaction descriptions and "SALDO ANTERIOR"
  // Also skip office/channel labels that got mixed into descriptions
  const officeLabels = new Set(['BCA. INTERNET', 'BIE', 'BIN', 'BEL', 'INT']);
  const txDescs = allDescriptions.filter(d =>
    d !== 'SALDO ANTERIOR' && !officeLabels.has(d) &&
    !/^[A-Z]{2,4}$/.test(d) && !d.startsWith('BCA.'),
  );
  const txCount = txDescs.length;

  if (txCount === 0) return [];

  // Split dates: first half = FECHA OPER, second half = FECHA VALOR
  // +1 for SALDO ANTERIOR which has a date but no description
  const fechaOper = allDates.slice(0, allDates.length / 2);
  const fechaValor = allDates.slice(allDates.length / 2);
  // Offset: SALDO ANTERIOR has a date entry we skip
  const dateOffset = fechaOper.length > txCount ? fechaOper.length - txCount : 0;
  const valDateOffset = fechaValor.length > txCount ? fechaValor.length - txCount : 0;

  // Split amounts: first txCount = CARGO/ABONO, next up to txCount = ITF, rest = SALDO
  // But only some transactions have ITF, so we use txCount + 1 (for SALDO ANTERIOR balance)
  const cargoAbono = allAmounts.slice(0, txCount);
  const remaining = allAmounts.slice(txCount);
  // The balances include SALDO ANTERIOR's balance as first item, then one per transaction
  // ITF values are much smaller (< 1.00), balances are large
  const itfValues: string[] = [];
  const balanceValues: string[] = [];
  for (const val of remaining) {
    const num = Math.abs(parseFloat(val.replace(/,/g, '')));
    if (num < 1 && itfValues.length < txCount) {
      itfValues.push(val);
    } else {
      balanceValues.push(val);
    }
  }
  // Skip the first balance (SALDO ANTERIOR)
  const txBalances = balanceValues.length > txCount
    ? balanceValues.slice(balanceValues.length - txCount)
    : balanceValues;

  // Build rows
  const header = ['FECHA OPER.', 'FECHA VALOR', 'DESCRIPCIÓN', 'OFICINA', 'CAN', 'N°OPER.', 'CARGO/ABONO', 'ITF', 'SALDO CONTABLE'];
  const result2: string[][] = [header];

  for (let i = 0; i < txCount; i++) {
    const fOper = fechaOper[i + dateOffset] ?? '';
    const fVal = fechaValor[i + valDateOffset] ?? '';
    result2.push([
      fOper ? `${fOper}-${statementYear}` : '',
      fVal ? `${fVal}-${statementYear}` : '',
      txDescs[i] ?? '',
      '', '', // office, channel - not critical
      allOpNumbers[i] ?? '',
      cargoAbono[i] ?? '',
      itfValues[i] ?? '',
      txBalances[i] ?? '',
    ]);
  }

  return result2;
}

// ─── Excel Parser ────────────────────────────────────────────────────

async function parseExcel(file: File): Promise<string[][]> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  // Try BBVA-style: look for a sheet with a header row containing "FECHA" and "CARGO/ABONO"
  // where values are newline-packed into single cells
  const bbvaResult = tryParseBBVA(workbook, XLSX);
  if (bbvaResult && bbvaResult.length > 1) {
    return bbvaResult;
  }

  // Standard approach: try each sheet until we find one with data rows
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const jsonData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      dateNF: 'yyyy-mm-dd',
    });

    // Must have at least a header + 1 data row
    if (jsonData.length >= 2) {
      const flatText = jsonData.slice(0, 5).map(r => (r as string[]).join(' ')).join(' ').toLowerCase();
      const hasDateKeyword = flatText.includes('fecha') || flatText.includes('date');
      const hasAmountKeyword = flatText.includes('monto') || flatText.includes('cargo') || flatText.includes('importe') || flatText.includes('saldo');
      if (hasDateKeyword && hasAmountKeyword) {
        return jsonData.map((row) =>
          (row as unknown[]).map((cell) => (cell != null ? String(cell).trim() : '')),
        );
      }
    }
  }

  // Fallback: just use first sheet
  const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? ''];
  if (!firstSheet) return [];
  const jsonData: unknown[][] = XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });
  return jsonData.map((row) =>
    (row as unknown[]).map((cell) => (cell != null ? String(cell).trim() : '')),
  );
}

/**
 * BBVA-specific parser: their XLS exports pack all transaction lines
 * into a single cell per column, separated by \n characters.
 * The header row has: FECHA OPER. | FECHA VALOR | DESCRIPCIÓN | OFICINA | CAN | NºOPER. | CARGO/ABONO | ITF | SALDO CONTABLE
 */
function tryParseBBVA(workbook: any, XLSX: any): string[][] | null {
  // First, extract the statement year from Sheet12 (has full date like "30-01-2026")
  let statementYear: string | null = null;
  const metaSheet = workbook.Sheets['Sheet12'];
  if (metaSheet) {
    const metaRows: unknown[][] = XLSX.utils.sheet_to_json(metaSheet, { header: 1, raw: false });
    for (const row of metaRows) {
      for (const cell of row as string[]) {
        const dateMatch = String(cell ?? '').match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
        if (dateMatch) {
          statementYear = dateMatch[3]!;
          break;
        }
      }
      if (statementYear) break;
    }
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
    });

    if (rawRows.length < 2) continue;

    // Check if header row looks like BBVA
    const headerRow = rawRows[0] as string[];
    const headerText = headerRow.map(c => String(c ?? '').toLowerCase()).join('|');
    const isBBVA = headerText.includes('fecha') && (headerText.includes('cargo') || headerText.includes('saldo'));

    if (!isBBVA) continue;

    // Check if the second row has newline-packed data
    const dataRow = rawRows[1] as string[];
    const hasNewlines = dataRow.some(cell => {
      const s = String(cell ?? '');
      return s.includes('\n') && s.split('\n').length > 3;
    });

    if (!hasNewlines) continue;

    // Parse the BBVA format: split each column's cell by \n
    const columns: string[][] = dataRow.map(cell =>
      String(cell ?? '').split('\n').map(v => v.trim()),
    );

    // Find the longest column to know how many rows we have
    const maxRows = Math.max(...columns.map(col => col.length));

    // Reconstruct the header
    const cleanHeader = headerRow.map(h => String(h ?? '').trim());

    // Determine the year to append to short DD-MM dates
    const yearSuffix = statementYear ?? String(new Date().getFullYear());

    // Build rows by transposing: row i = [col0[i], col1[i], ...]
    const result: string[][] = [cleanHeader];

    for (let i = 0; i < maxRows; i++) {
      const row = columns.map((col, colIdx) => {
        let val = (col[i] ?? '').trim();
        // For date columns (0 = FECHA OPER, 1 = FECHA VALOR), append year to short DD-MM
        if ((colIdx === 0 || colIdx === 1) && val && /^\d{1,2}-\d{1,2}$/.test(val)) {
          val = `${val}-${yearSuffix}`;
        }
        return val;
      });
      // Skip empty rows
      if (row.every(cell => !cell)) continue;
      result.push(row);
    }

    return result;
  }

  return null;
}

// ─── Format Detection ────────────────────────────────────────────────

function detectFormat(rows: string[][]): {
  format: BankFormat;
  bankName: string | null;
  accountName: string | null;
  dataStartRow: number;
} {
  const flatText = rows
    .slice(0, 10)
    .map((r) => r.join(' '))
    .join(' ')
    .toLowerCase();

  // BCP patterns
  if (
    flatText.includes('banco de crédito') ||
    flatText.includes('bcp') ||
    flatText.includes('viabcp')
  ) {
    const dataStart = findDataStartRow(rows);
    return { format: 'bcp', bankName: 'BCP', accountName: extractAccountName(rows), dataStartRow: dataStart };
  }

  // Interbank patterns
  if (flatText.includes('interbank') || flatText.includes('interbancario')) {
    const dataStart = findDataStartRow(rows);
    return { format: 'interbank', bankName: 'Interbank', accountName: extractAccountName(rows), dataStartRow: dataStart };
  }

  // BBVA patterns
  if (
    flatText.includes('bbva') ||
    flatText.includes('continental') ||
    flatText.includes('banco continental')
  ) {
    const dataStart = findDataStartRow(rows);
    return { format: 'bbva', bankName: 'BBVA', accountName: extractAccountName(rows), dataStartRow: dataStart };
  }

  // Generic fallback
  const dataStart = findDataStartRow(rows);
  return { format: 'generic', bankName: null, accountName: null, dataStartRow: dataStart };
}

function findDataStartRow(rows: string[][]): number {
  // Look for the header row by finding common keywords
  const keywords = ['fecha', 'date', 'descripción', 'descripcion', 'monto', 'importe', 'cargo', 'abono', 'saldo'];

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const rowText = rows[i].join(' ').toLowerCase();
    const matchCount = keywords.filter((kw) => rowText.includes(kw)).length;
    if (matchCount >= 2) {
      return i + 1; // Data starts after header
    }
  }
  return 1; // Default: skip first row as header
}

function extractAccountName(rows: string[][]): string | null {
  // Look for account number patterns in the first few rows
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const text = rows[i].join(' ');
    const match = text.match(/\b(\d{3}[-\s]?\d{7,}[-\s]?\d{0,2})\b/);
    if (match) return match[1].replace(/\s/g, '');
  }
  return null;
}

// ─── Column Mapping ──────────────────────────────────────────────────

function mapColumns(headerRow: string[], format: BankFormat): ColumnMapping {
  const normalized = headerRow.map((h) => (h || '').toLowerCase().trim());

  const findCol = (...patterns: string[]): number | null => {
    for (const pattern of patterns) {
      const idx = normalized.findIndex((h) => h.includes(pattern));
      if (idx >= 0) return idx;
    }
    return null;
  };

  const dateCol = findCol('fecha oper', 'fecha', 'date', 'f. operación', 'f.operacion') ?? 0;
  const descriptionCol = findCol('descripci', 'descripcion', 'concepto', 'detalle', 'movimiento') ?? 1;
  const referenceCol = findCol('nro. operación', 'nro operacion', 'oper.', 'nro.');
  const balanceCol = findCol('saldo', 'balance');
  const valueDateCol = findCol('fecha valor', 'f. valor', 'value date');

  // BBVA uses "CARGO/ABONO" as a single signed column
  const cargoAbono = findCol('cargo/abono');

  // Try single amount column
  const amountCol = cargoAbono ?? findCol('monto', 'importe', 'amount');

  // Try separate credit/debit columns (only if no single amount column)
  let creditCol: number | null = null;
  let debitCol: number | null = null;
  if (amountCol == null) {
    creditCol = findCol('abono', 'haber', 'crédito', 'credito', 'credit', 'ingreso');
    debitCol = findCol('cargo', 'debe', 'débito', 'debito', 'debit', 'egreso');
  }

  return {
    dateCol,
    descriptionCol,
    amountCol: creditCol == null && debitCol == null ? (amountCol ?? 2) : null,
    creditCol,
    debitCol,
    balanceCol,
    referenceCol: referenceCol != null && referenceCol !== descriptionCol ? referenceCol : null,
    valueDateCol,
  };
}

// ─── Row Parser ──────────────────────────────────────────────────────

function parseRow(
  row: string[],
  mapping: ColumnMapping,
  _format: BankFormat,
): ParsedBankRow | null {
  const dateStr = row[mapping.dateCol] ?? '';
  const transactionDate = normalizeDate(dateStr);
  if (!transactionDate) return null; // Skip non-data rows

  const description = (row[mapping.descriptionCol] ?? '').trim();
  if (!description) return null;

  let amount = 0;
  if (mapping.amountCol != null) {
    amount = parseAmount(row[mapping.amountCol] ?? '');
  } else if (mapping.creditCol != null || mapping.debitCol != null) {
    const credit = parseAmount(row[mapping.creditCol ?? -1] ?? '');
    const debit = parseAmount(row[mapping.debitCol ?? -1] ?? '');
    if (credit && !debit) {
      amount = Math.abs(credit);
    } else if (debit && !credit) {
      amount = -Math.abs(debit);
    } else if (credit && debit) {
      // Both columns have values — take the non-zero one
      amount = credit > 0 ? credit : -debit;
    }
  }

  if (amount === 0) return null; // Skip zero-amount rows

  const balance =
    mapping.balanceCol != null ? parseAmount(row[mapping.balanceCol] ?? '') || null : null;
  const reference =
    mapping.referenceCol != null ? (row[mapping.referenceCol] ?? '').trim() || null : null;
  const valueDate =
    mapping.valueDateCol != null ? normalizeDate(row[mapping.valueDateCol] ?? '') : null;

  return {
    transactionDate,
    valueDate,
    description,
    reference,
    amount,
    balance,
  };
}

// ─── Utilities ───────────────────────────────────────────────────────

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();

  // Already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    return cleaned.slice(0, 10);
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = cleaned.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }

  // DD/MM/YY
  const dmy2 = cleaned.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/);
  if (dmy2) {
    const [, d, m, yy] = dmy2;
    const year = Number(yy) > 50 ? `19${yy}` : `20${yy}`;
    return `${year}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }

  // DD-MM (BBVA short format, no year — assume current year)
  const dmOnly = cleaned.match(/^(\d{1,2})[/\-.](\d{1,2})$/);
  if (dmOnly) {
    const [, d, m] = dmOnly;
    const year = new Date().getFullYear();
    return `${year}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }

  // Try native Date parse as last resort
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  let cleaned = raw.trim();

  // Remove currency symbols and whitespace (preserve dots and commas for separator handling)
  cleaned = cleaned.replace(/[S/$]/g, '').replace(/\s/g, '').replace(/^\/+|\/+$/g, '');

  // Handle (negative) format: (1,234.56) → -1234.56
  const isParenNeg = cleaned.startsWith('(') && cleaned.endsWith(')');
  if (isParenNeg) {
    cleaned = cleaned.slice(1, -1);
  }

  // Normalize separators: Peruvian format uses comma as thousands, dot as decimal
  // But some banks use comma as decimal (European style)
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Both present: comma is thousands separator
    cleaned = cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    // Only comma: could be decimal separator
    const parts = cleaned.split(',');
    if (parts.length === 2 && (parts[1]?.length ?? 0) <= 2) {
      // Likely decimal: 1234,56
      cleaned = cleaned.replace(',', '.');
    } else {
      // Likely thousands: 1,234,567
      cleaned = cleaned.replace(/,/g, '');
    }
  }

  const value = Number(cleaned);
  if (isNaN(value)) return 0;

  return isParenNeg ? -Math.abs(value) : value;
}
