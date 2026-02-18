import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.GEMINI_API_KEY;

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const SYSTEM_PROMPT = `
Eres un asistente experto en contabilidad peruana. Tu tarea es extraer información de facturas, boletas o recibos por honorarios.
Analiza la imagen o documento proporcionado y extrae los siguientes datos en formato JSON estricto:

- documentType: "factura" | "boleta" | "recibo" (Infiere por el contenido. Si dice "Factura Electrónica" es factura. Si dice "Recibo por Honorarios" es recibo).
- documentSeries: Serie del documento (ej: F001, E001).
- documentNumber: Número correlativo del documento.
- ruc: RUC del proveedor (11 dígitos).
- providerName: Nombre o Razón Social del proveedor.
- issueDate: Fecha de emisión en formato YYYY-MM-DD.
- dueDate: Fecha de vencimiento en formato YYYY-MM-DD (si no existe, usa la fecha de emisión).
- currency: "PEN" o "USD".
- baseAmount: Monto subtotal o base imponible (numérico).
- igvAmount: Monto del IGV (numérico). Si no está explícito pero es factura, calcula el 18% de la base.
- totalAmount: Monto total (numérico).
- description: Breve descripción del concepto principal.
- category: Sugiere una categoría entre: "servicios", "materiales", "personal", "marketing", "administrativos", "equipos".

Si algún campo no se encuentra, usa null o una cadena vacía, pero trata de inferir lo más posible.
Devuelve SOLO el JSON sin bloques de código markdown.
`;

export async function POST(req: NextRequest) {
    if (!genAI) {
        return NextResponse.json({ error: 'GEMINI_API_KEY no configurada' }, { status: 500 });
    }

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No se envió ningún archivo' }, { status: 400 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const base64Data = buffer.toString('base64');

        // Determine mime type
        const mimeType = file.type || 'image/jpeg';

        const modelsToTry = [
            'gemini-2.0-flash-exp', // 2.0 Flash
            'gemini-exp-1206',      // 2.0 Flash updated
            'gemini-1.5-flash',
            'gemini-1.5-flash-latest',
            'gemini-1.5-flash-001',
            'gemini-1.5-flash-002',
            'gemini-1.5-flash-8b',
            'gemini-1.5-pro',
            'gemini-1.5-pro-latest',
            'gemini-1.5-pro-001',
            'gemini-1.5-pro-002',
            'gemini-exp-1121',      // 1.5 Pro experimental
            'gemini-pro-vision',    // Legacy
        ];

        let lastError = null;
        let successfulData = null;
        const errors: any[] = [];

        for (const modelName of modelsToTry) {
            try {
                console.log(`Trying model: ${modelName}`);
                const model = genAI.getGenerativeModel({ model: modelName });

                const result = await model.generateContent([
                    SYSTEM_PROMPT,
                    {
                        inlineData: {
                            data: base64Data,
                            mimeType: mimeType,
                        },
                    },
                ]);

                const responseText = result.response.text();
                console.log(`Success with ${modelName}`);

                const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                successfulData = JSON.parse(cleanJson);
                break; // Exit loop on success
            } catch (error: any) {
                console.warn(`Failed with ${modelName}:`, error);
                lastError = error;
                errors.push(`${modelName}: ${error?.message || error}`);
            }
        }

        if (successfulData) {
            return NextResponse.json({ data: successfulData });
        }

        const errorReport = errors.join('\n');
        throw new Error(`Todos los modelos fallaron:\n${errorReport}`);
    } catch (error) {
        console.error('Error scanning invoice:', error);
        // @ts-ignore
        const message = error.message || 'Error desconocido';
        return NextResponse.json(
            { error: `Error durante el procesamiento: ${message}` },
            { status: 500 }
        );
    }
}
