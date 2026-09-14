/**
 * Servidor MCP de solo lectura para el Facturador — pensado para conectar
 * Claude (app de celular/escritorio) como "custom connector" y poder
 * preguntar por el estado financiero real de la empresa.
 *
 * Mismo dato, mismo alcance que la API REST (/api/resumen, /api/ingresos,
 * /api/egresos, /api/impuestos): solo lectura, protegido con REPORT_API_TOKEN.
 *
 * URL a agregar en Claude → Configuración → Conectores → Agregar conector:
 *   https://<tu-dominio>/api/mcp?token=<REPORT_API_TOKEN>
 */
import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { checkApiToken, unauthorizedResponse } from '@/lib/api-auth';
import { getResumen, getIngresos, getEgresos, getImpuestos } from '@/lib/reports';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PERIODO_SCHEMA = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Formato YYYY-MM, ej. 2026-07')
  .optional()
  .describe('Período a filtrar en formato YYYY-MM. Si se omite, trae todos los registros.');

function jsonContent(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

// Un servidor nuevo por request: no hay estado compartido entre invocaciones
// serverless de Vercel, así que no tiene sentido mantenerlo vivo entre pedidos.
function buildServer() {
  const server = new McpServer({ name: 'facturador-cerezo', version: '1.0.0' });

  server.registerTool(
    'resumen_financiero',
    {
      title: 'Resumen financiero del año',
      description:
        'Resumen financiero del año en curso: facturado, cobrado, gastos, utilidad devengada, ' +
        'caja real (ya descuenta IGV por pagar y el pago a cuenta de renta del 1%), IGV ventas/compras ' +
        'y el listado de facturas actualmente vencidas.',
      inputSchema: {},
    },
    async () => jsonContent(await getResumen()),
  );

  server.registerTool(
    'listar_ingresos',
    {
      title: 'Listar facturas de ingresos',
      description:
        'Lista las facturas de venta (ingresos) con su estado de cobro, opcionalmente filtradas por período.',
      inputSchema: { periodo: PERIODO_SCHEMA },
    },
    async ({ periodo }) => jsonContent(await getIngresos(periodo ?? null)),
  );

  server.registerTool(
    'listar_egresos',
    {
      title: 'Listar egresos',
      description:
        'Lista los egresos (gastos, honorarios, compras) con su estado de pago, opcionalmente filtrados por período.',
      inputSchema: { periodo: PERIODO_SCHEMA },
    },
    async ({ periodo }) => jsonContent(await getEgresos(periodo ?? null)),
  );

  server.registerTool(
    'obligaciones_tributarias',
    {
      title: 'Obligaciones tributarias mensuales',
      description:
        'Histórico mensual de IGV ventas, IGV compras, IGV por pagar y retenciones de IR sobre honorarios.',
      inputSchema: {},
    },
    async () => jsonContent(await getImpuestos()),
  );

  return server;
}

async function handle(req: NextRequest): Promise<Response> {
  if (!checkApiToken(req)) return unauthorizedResponse();

  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Sin sesiones: cada invocación serverless es independiente.
    sessionIdGenerator: undefined,
    // Respuesta JSON directa — nuestras herramientas son lecturas rápidas,
    // no necesitamos streaming SSE.
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
