'use client';

import { supabase } from '@/lib/supabase-client';
import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error('No se pudo leer la sesión de Supabase', error);
        }
        setSession(data.session ?? null);
        setIsLoading(false);
      })
      .catch((error) => {
        if (!isMounted) return;
        console.error('Error inesperado al leer la sesión', error);
        setIsLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      subscription?.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error, data } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      console.error('Error al iniciar sesión', error);
      return { error: translateAuthError(error.message) };
    }

    setSession(data.session ?? null);
    return {};
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error al cerrar sesión', error);
    }
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      signIn,
      signOut,
    }),
    [session, isLoading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  }
  return context;
}

function translateAuthError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (normalized.includes('email not confirmed')) {
    return 'Debes confirmar tu correo antes de iniciar sesión.';
  }
  return message || 'No se pudo iniciar sesión.';
}
