import { NextRequest, NextResponse } from 'next/server';
import { parseReciboText } from '@/lib/recibo-parser';

// Fallback del escaneo de recibos: el cliente extrae el texto en el navegador
// (ver egresos/page.tsx); este endpoint queda para compatibilidad y pruebas.
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

        const { extractText, getDocumentProxy } = await import('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const { text } = await extractText(pdf, { mergePages: true });

        const data = parseReciboText(text);
        console.log('[scan-invoice] Extracted:', JSON.stringify(data));

        return NextResponse.json({ data });

    } catch (error) {
        console.error('[scan-invoice] Error:', error);
        const message = error instanceof Error ? error.message : 'Error desconocido';
        return NextResponse.json(
            { error: `Error durante el procesamiento: ${message}` },
            { status: 500 }
        );
    }
}
