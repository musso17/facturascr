import { NextRequest, NextResponse } from 'next/server';

const MONTHS: Record<string, string> = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
    'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
    'setiembre': '09', 'septiembre': '09', 'octubre': '10',
    'noviembre': '11', 'diciembre': '12',
};

function parseMoney(raw: string): number {
    const clean = raw.replace(/[()S\/\s]/g, '').trim();
    if (/^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(clean)) return parseFloat(clean.replace(/,/g, ''));
    if (/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(clean)) return parseFloat(clean.replace(/\./g, '').replace(',', '.'));
    return parseFloat(clean.replace(/,/g, '')) || 0;
}

// Find the first money-looking number after a label in text
function findAmountAfter(text: string, labelRe: RegExp): number | null {
    const match = text.match(labelRe);
    if (!match) return null;
    const rest = text.slice(match.index! + match[0].length);
    const numMatch = rest.match(/[\d]{1,3}(?:[,.][\d]{3})*[.,][\d]{2}/);
    if (!numMatch) return null;
    return parseMoney(numMatch[0]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractData(rawText: string): any {
    const norm = rawText.replace(/\s+/g, ' ').trim();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
        documentType: 'recibo',
        currency: 'PEN',
        category: 'servicios',
        description: 'Servicios profesionales',
        igvAmount: 0,
    };

    // === PROVIDER RUC ===
    const personalRucMatch = norm.match(/\b(10\d{9})\b/);
    if (personalRucMatch) {
        data.ruc = personalRucMatch[1];
    } else {
        const labeledRuc = norm.match(/R\.?U\.?C\.?\s+(\d{11})/i);
        if (labeledRuc) data.ruc = labeledRuc[1];
    }

    // === DOCUMENT SERIES & NUMBER ===
    const nroMatch = norm.match(/(E\d{3})\s*[-]?\s*(\d+)/i);
    if (nroMatch) {
        data.documentSeries = nroMatch[1].toUpperCase();
        data.documentNumber = nroMatch[2];
    } else {
        data.documentNumber = `RHE-${Date.now().toString().slice(-5)}`;
    }

    // === PROVIDER NAME ===
    const nameMatch = norm.match(/(?:E\d{3}\s*[-]?\s*\d+)\s+([A-ZÁÉÍÓÚÑ\s]+?)\s+(?:CAL\.|JR\.|AV\.|PROV\.|URB\.|NRO\.|TEL[EÉ]FONO)/i);
    if (nameMatch) {
        data.providerName = nameMatch[1].trim();
    } else {
        data.providerName = 'Proveedor Desconocido';
    }

    // === AMOUNTS ===
    // unpdf extracts PDF text in stream order, so labels and values end up separated.
    // SUNAT recibos always render the amount table as: BASE (RETENTION) NET SOLES — match it positionally.
    const amountBlockMatch = norm.match(
        /([\d]{1,3}(?:,[\d]{3})*\.[\d]{2})\s+\(([\d]{1,3}(?:,[\d]{3})*\.[\d]{2})\)\s+([\d]{1,3}(?:,[\d]{3})*\.[\d]{2})\s+(?:SOLES|D[OÓ]LARES)/i
    );
    if (amountBlockMatch) {
        data.baseAmount = parseMoney(amountBlockMatch[1]);
        data.irRetentionAmount = parseMoney(amountBlockMatch[2]);
        data.totalAmount = parseMoney(amountBlockMatch[3]);
    } else {
        const base = findAmountAfter(norm, /Total\s+por\s+honorarios\s*:?/i);
        if (base !== null) data.baseAmount = base;
        const total = findAmountAfter(norm, /Total\s+Neto\s+Recibido\s*:?/i);
        if (total !== null) data.totalAmount = total;
        if ((data.totalAmount == null || data.totalAmount === 0) && data.baseAmount != null) {
            data.totalAmount = data.baseAmount;
        }
    }

    // === CONCEPT AND DATE ===
    const conceptAndDateMatch = norm.match(/(?:SOLES|D[OÓ]LARES)\s+(.+?)\s+-\s+[A-Z]\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
    if (conceptAndDateMatch) {
        data.description = conceptAndDateMatch[1].trim();
        const day = conceptAndDateMatch[2];
        const monthStr = conceptAndDateMatch[3];
        const year = conceptAndDateMatch[4];
        const month = MONTHS[monthStr.toLowerCase()] || '01';
        data.issueDate = `${year}-${month}-${day.padStart(2, '0')}`;
        data.dueDate = data.issueDate;
    } else {
        const fallbackDate = norm.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
        if (fallbackDate) {
            const day = fallbackDate[1];
            const monthStr = fallbackDate[2];
            const year = fallbackDate[3];
            const month = MONTHS[monthStr.toLowerCase()] || '01';
            data.issueDate = `${year}-${month}-${day.padStart(2, '0')}`;
            data.dueDate = data.issueDate;
        }
    }

    return data;
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No se envió ningún archivo' }, { status: 400 });
        }

        const mimeType = file.type || 'application/pdf';
        if (!mimeType.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
            return NextResponse.json({
                error: 'Solo se admiten archivos PDF. Para imágenes, ingresa los datos manualmente.',
            }, { status: 400 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const { extractText, getDocumentProxy } = await import('unpdf');
        const pdfBuffer = new Uint8Array(buffer);
        const pdf = await getDocumentProxy(pdfBuffer);
        const { text } = await extractText(pdf, { mergePages: true });

        console.log('[scan-invoice] === RAW TEXT ===\n', text, '\n=== END RAW TEXT ===');

        const data = extractData(text);
        console.log('[scan-invoice] Extracted:', JSON.stringify(data));

        return NextResponse.json({ data, _rawText: text });

    } catch (error) {
        console.error('[scan-invoice] Error:', error);
        // @ts-ignore
        const message = error?.message || 'Error desconocido';
        return NextResponse.json(
            { error: `Error durante el procesamiento: ${message}` },
            { status: 500 }
        );
    }
}
