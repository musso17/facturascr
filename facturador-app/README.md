## Facturador Inteligente · Sistema Contable

Aplicación Next.js que se conecta a Supabase para centralizar ingresos y egresos, calcular impuestos SUNAT y generar tableros financieros.  
Este README documenta la nueva capa de datos preparada para la versión contable.

## Inteligencia artificial contable

El dashboard ahora incluye:

1. **Asistente contable conversacional** – formula preguntas en lenguaje natural y Carbon AI responderá con cálculos, normativa SUNAT y acciones sugeridas.

### Configuración de Gemini

1. Crea un archivo `.env.local` (o actualiza el existente) con tu API key:

```bash
GEMINI_API_KEY=AIzaSyDms8BT4Uxb03C46ejRHz5t7-BNsQPmr7o
# Opcional: GEMINI_MODEL=gemini-2.0-flash (u otro modelo habilitado en tu cuenta)
```

2. Reinicia `npm run dev`. El backend expone `/api/ai` y el dashboard enviará las facturas/egresos para que la IA genere respuestas y recomendaciones.

## Requisitos

- Node.js 18+
- Supabase CLI (o acceso al panel web)

## Instalación

```bash
npm install
npm run dev
```

## Esquema de datos (Supabase)

1. Crea el directorio de migraciones si aún no existe en tu proyecto Supabase local.
2. Ejecuta la migración incluida:

```bash
supabase db push               # usando el CLI
# o, si trabajas directo con psql:
psql "$SUPABASE_DB_URL" -f supabase/migrations/20250217-001-accounting-schema.sql
```

### Nuevas entidades

- **partners**: catálogo de clientes/proveedores/profesionales (nombre, documento, contacto, metadata).
- **expenses**: egresos con tipo de comprobante, fechas, proveedor, montos base/IGV/IR, categoría, estado y método de pago.
- **expense_payments**: pagos parciales para egresos.
- **Enums**: `accounting_status`, `expense_document_type`, `expense_category`, `partner_role`, `document_type`, `payment_method`.
- **Vista `v_monthly_tax_liabilities`**: resume IGV ventas/compras, pagos a cuenta IR y retenciones por mes.
- **Tabla `invoices`**: ahora incluye referencias a `partners`, métodos de pago, retención IR, ITF, metadata y un `status` persistido.

### Índices y triggers

Todas las tablas críticas incluyen índices por fecha/estado y un trigger `set_updated_at` para mantener `updated_at` sincronizado.

## Tipos y utilidades en el frontend

- `src/lib/accounting-types.ts` define los enums y modelos (`InvoiceRecord`, `ExpenseRecord`, `PartnerRecord`, etc.) que usará el UI.
- `src/app/page.tsx` ya consume estos tipos para garantizar compatibilidad con los nuevos campos (método de pago, retenciones, etc.).

## Flujo recomendado de desarrollo

1. Aplicar la migración.
2. Configurar las variables Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
3. Levantar el entorno local con `npm run dev`.
4. Iterar sobre las nuevas vistas (dashboard, ingresos, egresos, reportes) usando los modelos compartidos.

## Scripts útiles

- `npm run dev` – servidor local con Turbopack.
- `npm run lint` – ESLint.

## Próximos pasos

- Conectar las nuevas tablas al UI (gestión de egresos, reportes, impuestos).
- Añadir exportaciones (PDF/Excel/CSV) usando los modelos definidos.
- Construir las vistas mensual/anual/proyecciones aprovechando la vista `v_monthly_tax_liabilities`.
