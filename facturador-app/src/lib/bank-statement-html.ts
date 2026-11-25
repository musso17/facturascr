/**
 * Estados de cuenta que el banco exporta como "Excel" pero son una página HTML
 * con tablas (BBVA "Movimiento y saldo a la fecha", y otros bancos peruanos).
 * Empiezan con BOM + espacios antes de <html>, por eso SheetJS no los reconoce.
 *
 * Es una función pura sobre el texto (sin DOM) para poder probarla fuera del
 * navegador. Lee la tabla cuya cabecera tiene FECHA + (CARGO/ABONO | CARGO y
 * ABONO | MONTO) y valida el saldo fila por fila.
 */

export interface HtmlStatementRow {
  transactionDate: string; // YYYY-MM-DD
  valueDate: string | null;
  description: string;
  /** N° de operación del banco */
  reference: string | null;
  /** + abono, − cargo */
  amount: number;
  /** ITF cobrado por este movimiento (se descuenta aparte del saldo) */
  itf: number;
  balance: number | null;
  office: string | null;
  channel: string | null;
}

export interface HtmlStatement {
  rows: HtmlStatementRow[];
  bankName: string | null;
  accountType: string | null;
  holder: string | null;
  currency: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  period: { from: string; to: string } | null;
  /** Filas cuyo saldo no cuadra con saldo anterior + movimiento − ITF */
  balanceMismatches: { index: number; expected: number; actual: number }[];
  /** De dónde salió el año de las fechas DD-MM */
  yearSource: 'fecha_completa' | 'fecha_generacion' | 'nombre_archivo' | 'glosa' | 'hoy';
  warnings: string[];
}

export function looksLikeHtml(text: string) {
  return /^\s*(<!doctype html|<html|<table|<\?xml[^>]*>\s*<html)/i.test(text.replace(/^﻿/, ''));
}

type Cell = { text: string; colspan: number };

/** Tokenizador mínimo de tablas: respeta tablas anidadas (cada celda guarda solo su propio texto) */
export function extractTables(html: string): string[][][] {
  const tables: Cell[][][] = [];
  const stack: { rows: Cell[][]; row: Cell[] | null; cell: Cell | null }[] = [];
  const tagRe = /<(\/?)(table|tr|td|th|br|p|div)\b([^>]*)>|<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\4>/gi;
  let last = 0;
  let match: RegExpExecArray | null;

  const appendText = (raw: string) => {
    const top = stack[stack.length - 1];
    if (top?.cell) top.cell.text += raw;
  };

  while ((match = tagRe.exec(html))) {
    appendText(stripTags(html.slice(last, match.index)));
    last = tagRe.lastIndex;
    const [, closing, rawName, attrs] = match;
    if (!rawName) continue; // comentario o script/style
    const name = rawName.toLowerCase();
    const top = stack[stack.length - 1];

    if (name === 'br' || name === 'p' || name === 'div') {
      appendText(' ');
      continue;
    }
    if (name === 'table') {
      if (!closing) {
        stack.push({ rows: [], row: null, cell: null });
      } else if (stack.length > 0) {
        const done = stack.pop()!;
        if (done.cell && done.row) done.row.push(done.cell);
        if (done.row) done.rows.push(done.row);
        tables.push(done.rows);
      }
      continue;
    }
    if (!top) continue;
    if (name === 'tr') {
      if (top.cell && top.row) top.row.push(top.cell);
      top.cell = null;
      if (top.row) top.rows.push(top.row);
      top.row = closing ? null : [];
      continue;
    }
    // td / th
    if (top.cell && top.row) top.row.push(top.cell);
    top.cell = null;
    if (!closing) {
      if (!top.row) top.row = [];
      const colspan = Number(/colspan\s*=\s*["']?(\d+)/i.exec(attrs ?? '')?.[1] ?? 1) || 1;
      top.cell = { text: '', colspan };
    }
  }
  // Tablas sin cerrar
  while (stack.length > 0) {
    const done = stack.pop()!;
    if (done.cell && done.row) done.row.push(done.cell);
    if (done.row) done.rows.push(done.row);
    tables.push(done.rows);
  }

  return tables.map((rows) =>
    rows.map((cells) => {
      const out: string[] = [];
      for (const cell of cells) {
        out.push(cleanText(cell.text));
        for (let i = 1; i < cell.colspan; i += 1) out.push('');
      }
      return out;
    }),
  );
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

export function parseHtmlStatement(
  html: string,
  options: { fileName?: string; today?: Date } = {},
): HtmlStatement {
  const warnings: string[] = [];
  const tables = extractTables(html);

  // Tablas de movimientos: las que tienen la cabecera con FECHA y montos. Se leen todas
  // las que repiten la misma cabecera, por si el banco pagina el extracto.
  const isHeaderRow = (row: string[]) => {
    const text = norm(row.join(' | '));
    return text.includes('FECHA') && (text.includes('CARGO') || text.includes('ABONO') || text.includes('MONTO') || text.includes('IMPORTE'));
  };
  let header: string[] | null = null;
  const bodyRows: string[][] = [];
  for (const table of tables) {
    const idx = table.findIndex(isHeaderRow);
    if (idx < 0) continue;
    const signature = norm(table[idx].join('|'));
    if (!header) header = table[idx];
    else if (norm(header.join('|')) !== signature) continue;
    // Una cabecera repetida dentro de la misma tabla (salto de página) se salta abajo
    bodyRows.push(...table.slice(idx + 1));
  }

  const flat = norm(tables.flat().flat().join(' '));
  const bankName =
    /BBVA|CONTINENTAL/.test(flat) || /BBVA/i.test(html.slice(0, 20000))
      ? 'BBVA'
      : /INTERBANK/.test(flat)
        ? 'Interbank'
        : /BCP|CREDITO DEL PERU/.test(flat)
          ? 'BCP'
          : null;

  if (!header) {
    return {
      rows: [],
      bankName,
      accountType: null,
      holder: null,
      currency: null,
      openingBalance: null,
      closingBalance: null,
      period: null,
      balanceMismatches: [],
      yearSource: 'hoy',
      warnings: ['No se encontró la tabla de movimientos (cabecera con FECHA y CARGO/ABONO).'],
    };
  }

  const h = header.map(norm);
  const col = (...patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const index = h.findIndex((name) => pattern.test(name));
      if (index >= 0) return index;
    }
    return -1;
  };
  const dateCol = col(/FECHA OPER/, /^FECHA$/, /FECHA/);
  const valueDateCol = col(/FECHA VALOR/, /F\. ?VALOR/);
  const descCol = col(/DESCRIPCI/, /CONCEPTO/, /DETALLE/, /GLOSA/);
  const officeCol = col(/OFICINA/, /SUCURSAL/);
  const channelCol = col(/^CAN/, /CANAL/);
  const opCol = col(/N\S* ?OPER/, /NRO\.? ?OPER/, /OPERACION/, /REFERENCIA/);
  const signedCol = col(/CARGO\s*\/\s*ABONO/, /^MONTO/, /IMPORTE/);
  const debitCol = signedCol >= 0 ? -1 : col(/^CARGO/, /DEBITO/, /DEBE/);
  const creditCol = signedCol >= 0 ? -1 : col(/^ABONO/, /CREDITO/, /HABER/);
  const itfCol = col(/^ITF/);
  const balanceCol = col(/SALDO/);

  // ── Año de las fechas DD-MM ──
  // 1) El mes del extracto si se conoce (glosa "EMPRESAS YYYY-MM" o nombre "EC_Setiembre 2026"):
  //    un extracto viejo descargado hoy no debe quedar con el año de hoy.
  // 2) Si no, la fecha de descarga que trae el HTML. 3) Si no, hoy.
  const fullDates = Array.from(html.matchAll(/\b(\d{4})[/-](\d{2})[/-](\d{2})\s+\d{2}:\d{2}(?::\d{2})?\b/g));
  const generatedAt = fullDates.length > 0 ? new Date(Number(fullDates[0][1]), Number(fullDates[0][2]) - 1, Number(fullDates[0][3])) : null;
  let periodEnd: Date | null = null;
  let yearSource: HtmlStatement['yearSource'] = generatedAt ? 'fecha_generacion' : 'hoy';
  const tag = /EMPRESAS (20\d{2})-(\d{2})/.exec(flat);
  if (tag) {
    periodEnd = new Date(Number(tag[1]), Number(tag[2]), 0); // último día del mes
    yearSource = 'glosa';
  } else if (options.fileName) {
    const name = norm(options.fileName).toLowerCase();
    const year = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/.exec(name)?.[1];
    const monthWord = Object.keys(MONTHS)
      .sort((a, b) => b.length - a.length)
      .find((word) => new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(name));
    if (year && monthWord) {
      periodEnd = new Date(Number(year), MONTHS[monthWord], 0);
      yearSource = 'nombre_archivo';
    }
  }
  let ref: Date;
  if (periodEnd) {
    // Margen para fechas valor del mes siguiente; si se descargó antes de fin de mes, esa fecha manda
    const withMargin = new Date(periodEnd.getTime() + 10 * 86_400_000);
    ref = generatedAt && generatedAt < withMargin && generatedAt >= new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1)
      ? generatedAt
      : withMargin;
    if (generatedAt && Math.abs(generatedAt.getTime() - periodEnd.getTime()) > 330 * 86_400_000) {
      warnings.push(
        `El archivo se descargó el ${generatedAt.toLocaleDateString('es-PE')}, lejos del mes del extracto: se usó el mes del extracto para el año.`,
      );
    }
  } else {
    ref = generatedAt ?? options.today ?? new Date();
  }

  const toIso = (raw: string): string | null => {
    const text = raw.trim();
    let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
    if (m) {
      yearSource = 'fecha_completa';
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(text);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    // El año más reciente en el que la fecha no queda después de la fecha de referencia
    let year = ref.getFullYear();
    if (new Date(year, month - 1, day) > ref) year -= 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  /** La fecha valor sin año va junto a la de operación (± 6 meses), no contra la fecha de referencia */
  const valueDateFor = (raw: string, operation: string): string | null => {
    const iso = toIso(raw);
    if (!iso || !/^\d{1,2}[/.-]\d{1,2}$/.test(raw.trim())) return iso;
    const op = new Date(`${operation}T00:00:00`).getTime();
    const candidates = [-1, 0, 1].map((offset) => `${Number(operation.slice(0, 4)) + offset}${iso.slice(4)}`);
    return candidates.sort(
      (a, b) =>
        Math.abs(new Date(`${a}T00:00:00`).getTime() - op) - Math.abs(new Date(`${b}T00:00:00`).getTime() - op),
    )[0];
  };

  const rows: HtmlStatementRow[] = [];
  let openingBalance: number | null = null;
  let unreadable = 0;
  for (const raw of bodyRows) {
    if (isHeaderRow(raw)) continue; // cabecera repetida (salto de página)
    const description = cleanText(raw[descCol] ?? '');
    const descNorm = norm(description);
    if (/^SALDO ANTERIOR/.test(descNorm)) {
      const value = parseAmount(raw[balanceCol] ?? '') ?? parseAmount(raw[signedCol] ?? '');
      if (value !== null && openingBalance === null) openingBalance = value;
      continue;
    }
    if (/^TOTALES|^SALDO (FINAL|ACTUAL)/.test(descNorm)) continue;
    const rawDate = (raw[dateCol] ?? '').trim();
    const transactionDate = toIso(rawDate);
    if (!transactionDate) {
      // Fila con fecha pero en un formato que no se reconoce: se cuenta para avisar
      if (rawDate && /\d/.test(rawDate) && description) unreadable += 1;
      continue;
    }

    let amount: number | null = null;
    if (signedCol >= 0) {
      amount = parseAmount(raw[signedCol] ?? '');
    } else {
      const debit = parseAmount(raw[debitCol] ?? '');
      const credit = parseAmount(raw[creditCol] ?? '');
      if (credit) amount = Math.abs(credit);
      else if (debit) amount = -Math.abs(debit);
    }
    if (amount === null || amount === 0) continue;

    rows.push({
      transactionDate,
      valueDate: valueDateCol >= 0 ? valueDateFor(raw[valueDateCol] ?? '', transactionDate) : null,
      description,
      reference: opCol >= 0 ? cleanText(raw[opCol] ?? '') || null : null,
      amount,
      itf: itfCol >= 0 ? Math.abs(parseAmount(raw[itfCol] ?? '') ?? 0) : 0,
      balance: balanceCol >= 0 ? parseAmount(raw[balanceCol] ?? '') : null,
      office: officeCol >= 0 ? cleanText(raw[officeCol] ?? '') || null : null,
      channel: channelCol >= 0 ? cleanText(raw[channelCol] ?? '') || null : null,
    });
  }

  if (unreadable > 0) {
    warnings.push(`${unreadable} fila(s) tienen una fecha en un formato que no se pudo leer y no se importaron.`);
  }
  if (rows.length === 0) {
    // Exportación antigua de BBVA ("Movimientos"): todas las fechas apiladas en una sola celda
    const packed = bodyRows.some((row) => ((row[dateCol] ?? '').match(/\d{1,2}-\d{1,2}/g)?.length ?? 0) > 2);
    warnings.push(
      packed
        ? 'Este archivo es la exportación antigua de BBVA ("Movimientos", con todos los movimientos en una sola celda) y no se puede leer con seguridad. Descarga el "Estado de cuenta" del mes (EC_Mes Año.xls) desde la banca por internet.'
        : 'Se encontró la tabla de movimientos pero ninguna fila tenía una fecha y un monto reconocibles.',
    );
  }

  // Saldo anterior: si no viene, se deduce de la primera fila
  if (openingBalance === null && rows[0]?.balance != null) {
    openingBalance = round2(rows[0].balance - rows[0].amount + rows[0].itf);
  }

  // Validación: saldo = saldo anterior + movimiento − ITF
  const balanceMismatches: HtmlStatement['balanceMismatches'] = [];
  let running = openingBalance;
  rows.forEach((row, index) => {
    if (running === null || row.balance === null) {
      running = row.balance;
      return;
    }
    const expected = round2(running + row.amount - row.itf);
    if (Math.abs(expected - row.balance) > 0.011) {
      balanceMismatches.push({ index, expected, actual: row.balance });
    }
    running = row.balance;
  });
  if (balanceMismatches.length > 0) {
    warnings.push(
      `${balanceMismatches.length} fila(s) no cuadran con el saldo contable: puede faltar algún movimiento en el archivo.`,
    );
  }

  const dates = rows.map((row) => row.transactionDate).sort();
  const accountType = /CUENTA CORRIENTE/.test(flat)
    ? 'Cuenta corriente'
    : /CUENTA DE AHORRO|AHORROS/.test(flat)
      ? 'Cuenta de ahorros'
      : null;
  const currency = /MONEDA:?\s*(SOLES|DOLARES|DÓLARES)/.exec(flat)?.[1] ?? null;
  const holderIdx = tables.flat().findIndex((row) => norm(row.join(' ')) === 'TITULARES');
  const holder = holderIdx >= 0 ? cleanText(tables.flat()[holderIdx + 1]?.join(' ') ?? '') || null : null;

  return {
    rows,
    bankName,
    accountType,
    holder,
    currency,
    openingBalance,
    closingBalance: rows.length > 0 ? rows[rows.length - 1].balance : openingBalance,
    period: dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
    balanceMismatches,
    yearSource,
    warnings,
  };
}

// ── utilidades ──

function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, ' ');
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', deg: '°', ordm: 'º',
};

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

function cleanText(value: string) {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

/** Mayúsculas sin tildes, para comparar cabeceras y glosas */
function norm(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function parseAmount(raw: string): number | null {
  let text = raw.replace(/[^\d.,()\-]/g, '');
  if (!text || !/\d/.test(text)) return null;
  const negative = /^\(.*\)$/.test(text) || text.startsWith('-') || text.endsWith('-');
  text = text.replace(/[()\-]/g, '');
  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.') // 1.234,56
      : text.replace(/,/g, ''); // 1,234.56
  } else if (text.includes(',')) {
    const [, decimals = ''] = text.split(',');
    text = text.split(',').length === 2 && decimals.length <= 2 ? text.replace(',', '.') : text.replace(/,/g, '');
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -Math.abs(value) : value;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
