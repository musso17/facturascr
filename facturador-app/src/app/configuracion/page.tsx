'use client';

import { FormEvent, KeyboardEvent, useState } from 'react';
import { X } from 'lucide-react';
import type { PartnerRecord } from '@/lib/accounting-types';
import { supabase } from '@/lib/supabase-client';
import { usePartners } from '@/hooks/use-partners';

const INITIAL_FORM = {
  name: '',
  tradeName: '',
  role: 'cliente' as 'cliente' | 'proveedor' | 'ambos',
  documentType: 'ruc' as 'ruc' | 'dni' | 'carnet_extranjeria' | 'pasaporte' | 'otros',
  documentNumber: '',
  email: '',
  phone: '',
};

export default function ConfiguracionPage() {
  const { partners, isLoading, refresh, collectionColumns, updatePartnerCollection } = usePartners();
  const [collectionError, setCollectionError] = useState<string | null>(null);

  const updateCollection = async (
    id: string,
    patch: { isRetentionAgent?: boolean; bankAliases?: string[] },
  ) => {
    const result = await updatePartnerCollection(id, patch);
    setCollectionError(result.error ?? null);
  };
  const [form, setForm] = useState(INITIAL_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim() || !form.documentNumber.trim()) {
      setFormError('Completa nombre y documento.');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    setSuccessMessage(null);
    const { error } = await supabase.from('partners').insert({
      name: form.name.trim(),
      trade_name: form.tradeName.trim() || null,
      role: form.role,
      document_type: form.documentType,
      document_number: form.documentNumber.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
    });
    if (error) {
      console.error(error);
      setFormError('No se pudo registrar el partner.');
    } else {
      setSuccessMessage('Partner registrado correctamente.');
      setForm(INITIAL_FORM);
      void refresh();
    }
    setIsSaving(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex w-full flex-col gap-8 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <section className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400">
          Configuración
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">Catálogos y preferencias</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Administra tus clientes y proveedores para reutilizarlos en ingresos y egresos.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-3">
        <article className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Registrar partner</h2>
          <p className="text-xs text-slate-500">Clientes, proveedores o profesionales.</p>
          <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
            <label className="text-sm font-medium text-slate-600">
              Nombre o razón social
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                required
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-200"
              />
            </label>
            <label className="text-sm font-medium text-slate-600">
              Nombre comercial (opcional)
              <input
                value={form.tradeName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, tradeName: event.target.value }))
                }
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-200"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-600">
                Rol
                <select
                  value={form.role}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, role: event.target.value as typeof prev.role }))
                  }
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none"
                >
                  <option value="cliente">Cliente</option>
                  <option value="proveedor">Proveedor</option>
                  <option value="ambos">Ambos</option>
                </select>
              </label>
              <label className="text-sm font-medium text-slate-600">
                Tipo de documento
                <select
                  value={form.documentType}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      documentType: event.target.value as typeof prev.documentType,
                    }))
                  }
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none"
                >
                  <option value="ruc">RUC</option>
                  <option value="dni">DNI</option>
                  <option value="carnet_extranjeria">Carnet Extranjería</option>
                  <option value="pasaporte">Pasaporte</option>
                  <option value="otros">Otros</option>
                </select>
              </label>
            </div>
            <label className="text-sm font-medium text-slate-600">
              N° Documento
              <input
                value={form.documentNumber}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, documentNumber: event.target.value }))
                }
                required
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-600">
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none"
                />
              </label>
              <label className="text-sm font-medium text-slate-600">
                Teléfono
                <input
                  value={form.phone}
                  onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none"
                />
              </label>
            </div>
            {formError && <p className="text-sm font-semibold text-rose-600">{formError}</p>}
            {successMessage && (
              <p className="text-sm font-semibold text-emerald-600">{successMessage}</p>
            )}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
              disabled={isSaving}
            >
              {isSaving ? 'Guardando...' : 'Registrar partner'}
            </button>
          </form>
        </article>
        <article className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Directorio</h2>
            <p className="text-xs text-slate-500">
              {isLoading ? 'Cargando...' : `${partners.length} registrados`}
            </p>
          </div>
          {!collectionColumns && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Para marcar agentes de retención y alias bancarios, ejecuta{' '}
              <code className="rounded bg-amber-100 px-1 font-mono">supabase/migration-cobranza.sql</code>{' '}
              en el SQL Editor de Supabase y recarga.
            </p>
          )}
          {collectionError && (
            <p className="mt-3 text-sm font-semibold text-rose-600">{collectionError}</p>
          )}
          <div className="mt-4 max-h-[560px] overflow-y-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.2em] text-slate-400">
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Documento</th>
                  <th className="px-3 py-2">Rol</th>
                  <th className="px-3 py-2">Contacto</th>
                  <th className="px-3 py-2" title="Retención IGV y cómo aparece en el extracto bancario">
                    Cobranza
                  </th>
                </tr>
              </thead>
              <tbody>
                {partners.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                      Aún no has registrado clientes ni proveedores.
                    </td>
                  </tr>
                ) : (
                  partners.map((partner) => (
                    <tr key={partner.id} className="border-b border-slate-100">
                      <td className="px-3 py-3">
                        <p className="font-semibold text-slate-900">{partner.name}</p>
                        <p className="text-xs text-slate-500">{partner.tradeName}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold">{partner.documentNumber}</p>
                        <p className="text-xs text-slate-500">{partner.documentType.toUpperCase()}</p>
                      </td>
                      <td className="px-3 py-3 capitalize">{partner.role}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {partner.email}
                        <br />
                        {partner.phone}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {partner.role !== 'proveedor' && (
                          <PartnerCollectionCell
                            partner={partner}
                            disabled={!collectionColumns}
                            onChange={(patch) => updateCollection(partner.id, patch)}
                          />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>
        </section>
      </div>
    </div>
  );
}

function PartnerCollectionCell({
  partner,
  disabled,
  onChange,
}: {
  partner: PartnerRecord;
  disabled: boolean;
  onChange: (patch: { isRetentionAgent?: boolean; bankAliases?: string[] }) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');

  const addAlias = () => {
    const value = draft.trim();
    if (!value) return;
    setDraft('');
    void onChange({ bankAliases: [...partner.bankAliases, value] });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addAlias();
    }
  };

  return (
    <div className="min-w-[220px] space-y-2">
      <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
        <input
          type="checkbox"
          checked={partner.isRetentionAgent}
          disabled={disabled}
          onChange={(event) => void onChange({ isRetentionAgent: event.target.checked })}
          className="h-3.5 w-3.5 rounded border-slate-300"
        />
        Agente de retención (3% IGV)
      </label>
      <div className="flex flex-wrap gap-1">
        {partner.bankAliases.map((alias) => (
          <span
            key={alias}
            className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
          >
            {alias}
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void onChange({ bankAliases: partner.bankAliases.filter((item) => item !== alias) })
              }
              className="rounded-full hover:text-rose-600"
              aria-label={`Quitar alias ${alias}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={addAlias}
        placeholder="Alias en el banco + Enter"
        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-blue-400 disabled:bg-slate-50"
      />
    </div>
  );
}
