'use client';

import { useAuth } from '@/components/auth-provider';
import { Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const { user, isLoading: isAuthLoading, signIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  const redirectTo = useMemo(() => {
    const target = searchParams.get('redirect') || '/';
    return target.startsWith('/') ? target : '/';
  }, [searchParams]);

  useEffect(() => {
    if (!isAuthLoading && user) {
      router.replace(redirectTo);
    }
  }, [isAuthLoading, user, redirectTo, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus('loading');
    const { error: signInError } = await signIn(email, password);
    if (signInError) {
      setError(signInError);
      setStatus('idle');
      return;
    }
    setStatus('success');
    router.replace(redirectTo);
  };

  const isSubmitting = status === 'loading';

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-50">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute left-10 top-20 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />
      </div>
      <div className="relative grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden flex-col justify-between bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-12 lg:flex">
          <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.4em] text-blue-200">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-blue-500/60 bg-blue-500/20 text-lg">
              Fi
            </span>
            Facturador Inteligente
          </div>
          <div className="space-y-6">
            <p className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-blue-100">
              <ShieldCheck className="h-4 w-4" />
              Acceso seguro
            </p>
            <h1 className="text-4xl font-semibold leading-tight text-white">
              Centraliza tus facturas, gastos y reportes en un panel inteligente.
            </h1>
            <p className="text-lg text-slate-200/90">
              Ingresa con tus credenciales para seguir gestionando el flujo de caja, estados de pago
              y obligaciones tributarias desde cualquier dispositivo.
            </p>
            <div className="grid grid-cols-2 gap-4 text-sm text-slate-200/80">
              <FeatureBadge title="Métricas vivas" description="Dashboard con cobranza, egresos y alertas." />
              <FeatureBadge title="Sincronizado" description="Datos actualizados con Supabase en tiempo real." />
              <FeatureBadge title="Control de riesgos" description="Visibilidad de vencidos y próximos pagos." />
              <FeatureBadge title="Equipo listo" description="Comparte el panel sin perder el control." />
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-emerald-500" />
            <div>
              <p className="text-sm font-semibold text-white">Seguridad de nivel empresa</p>
              <p className="text-xs text-slate-300/80">Cifrado de sesión y control de acceso por usuario.</p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-10 sm:px-8 lg:px-12">
          <div className="w-full max-w-md space-y-8 rounded-2xl border border-slate-800/60 bg-slate-900/70 p-8 shadow-2xl backdrop-blur">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-200">Bienvenido</p>
              <h2 className="text-3xl font-semibold text-white">Inicia sesión</h2>
              <p className="text-sm text-slate-300">
                Usa tu correo y contraseña para acceder al panel. Mantén tus credenciales seguras.
              </p>
            </div>

            <form className="space-y-6" onSubmit={handleSubmit}>
              {error && (
                <div className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-slate-200">
                  Correo electrónico
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 focus-within:border-blue-500 focus-within:ring focus-within:ring-blue-500/30">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full bg-transparent py-2 text-sm text-slate-50 outline-none placeholder:text-slate-500"
                    placeholder="tu-correo@empresa.com"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-slate-200">
                  Contraseña
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 focus-within:border-blue-500 focus-within:ring focus-within:ring-blue-500/30">
                  <Lock className="h-4 w-4 text-slate-400" />
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full bg-transparent py-2 text-sm text-slate-50 outline-none placeholder:text-slate-500"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {status === 'success' ? 'Bienvenido' : isSubmitting ? 'Ingresando...' : 'Entrar al panel'}
              </button>

              <p className="text-center text-xs text-slate-400">
                Aún no tienes credenciales? Solicita acceso al administrador de tu cuenta.
              </p>
            </form>

            {isAuthLoading && !user && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Verificando sesión...
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function FeatureBadge({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="text-xs text-slate-200/80">{description}</p>
    </div>
  );
}
