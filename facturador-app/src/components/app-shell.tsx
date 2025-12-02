'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import {
  BarChart2,
  BrainCircuit,
  DollarSign,
  Home,
  Landmark,
  Loader2,
  LogOut,
  Menu,
  Settings,
  Wallet,
} from 'lucide-react';
import { useAuth } from './auth-provider';

const NAV_ITEMS = [
  { label: 'Dashboard', hint: 'Resumen general', href: '/', icon: Home, color: 'text-blue-400' },
  { label: 'Ingresos', hint: 'Facturas e ingresos', href: '/ingresos', icon: DollarSign, color: 'text-green-400' },
  { label: 'Egresos', hint: 'Gastos y proveedores', href: '/egresos', icon: Wallet, color: 'text-orange-400' },
  { label: 'Reportes', hint: 'Estados y métricas', href: '/reportes', icon: BarChart2, color: 'text-purple-400' },
  { label: 'Impuestos', hint: 'Obligaciones SUNAT', href: '/impuestos', icon: Landmark, color: 'text-red-400' },
  {
    label: 'Proyección',
    hint: 'Análisis con IA',
    href: '/proyeccion',
    icon: BrainCircuit,
    color: 'text-teal-400',
  },
  { label: 'Configuración', hint: 'Catálogos y ajustes', href: '/configuracion', icon: Settings, color: 'text-slate-400' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, signOut } = useAuth();
  const currentPath = pathname || '/';
  const isAuthPage = currentPath === '/login';

  useEffect(() => {
    if (isAuthPage) return;
    if (!isLoading && !user) {
      const target = currentPath === '/' ? '' : `?redirect=${encodeURIComponent(currentPath)}`;
      router.replace(`/login${target}`);
    }
  }, [isAuthPage, isLoading, user, currentPath, router]);

  useEffect(() => {
    if (!isAuthPage || !user) return;
    router.replace('/');
  }, [isAuthPage, user, router]);

  if (isAuthPage) {
    return <>{children}</>;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-700">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <p className="text-sm font-medium">Preparando tu sesión...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-gray-900">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[18rem_1fr]">
        <aside className="col-span-1 flex min-h-full w-full lg:w-72 shrink-0 flex-col border-r border-slate-700 bg-slate-800 px-6 py-8 text-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.45em] text-slate-400">Fi</p>
              <h1 className="mt-2 text-xl font-bold text-white">Facturador</h1>
              <p className="text-sm text-slate-300">Control contable 360°</p>
            </div>
            <span className="rounded-full border border-slate-600 p-2 text-slate-300">
              <Menu className="h-4 w-4" />
            </span>
          </div>
          <nav className="mt-8 space-y-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const baseClasses =
                'group flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition';
              const activeClasses = isActive
                ? 'bg-slate-700 text-white border-l-4 border-blue-500 pl-2'
                : 'text-slate-300 hover:bg-slate-700 hover:text-white';
              const iconClasses = isActive
                ? `h-4 w-4 text-white`
                : `h-4 w-4 ${item.color} group-hover:text-white`;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${baseClasses} ${activeClasses}`}
                >
                  <Icon className={iconClasses} />
                  <div>
                    <p className={isActive ? 'text-white' : 'text-inherit'}>{item.label}</p>
                    <p
                      className={`text-xs uppercase tracking-wide ${
                        isActive ? 'text-slate-200' : 'text-slate-400'
                      }`}
                    >
                      {item.hint}
                    </p>
                  </div>
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto space-y-3">
            <button className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500">
              Nueva factura
            </button>
            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/40 p-4 text-white">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Sesión</p>
              <p className="truncate text-sm font-semibold">{user.email}</p>
              <button
                type="button"
                onClick={() => {
                  void signOut();
                  router.replace('/login');
                }}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                Cerrar sesión
              </button>
            </div>
          </div>
        </aside>
        <main className="col-span-1 min-w-0 px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl min-w-0">{children}</div>
        </main>
      </div>
    </div>
  );
}
