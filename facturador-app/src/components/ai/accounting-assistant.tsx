'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import type { AIExpenseSummary, AIInvoiceSummary } from '@/lib/ai-context';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const QUICK_PROMPTS = [
  '¿Cuánto debo pagar de impuestos este mes?',
  '¿Qué cliente me debe más dinero?',
  '¿Tengo facturas por vencer esta semana?',
  'Muéstrame mis gastos de octubre en servicios de producción.',
];

interface AccountingAssistantProps {
  invoices: AIInvoiceSummary[];
  expenses: AIExpenseSummary[];
}

export function AccountingAssistant({ invoices, expenses }: AccountingAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hola, soy tu contador virtual. Pregúntame sobre impuestos, facturas o cómo optimizar tu flujo de caja.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!input.trim()) return;
    const question = input.trim();
    setInput('');
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(nextMessages);
    setIsSending(true);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'chat',
          question,
          invoices,
          expenses,
          messages: nextMessages.slice(-6),
        }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? 'No se pudo generar la respuesta.');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.message ?? '' }]);
    } catch (cause) {
      console.error(cause);
      setError('La IA contable no respondió. Intenta nuevamente en unos segundos.');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsSending(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    setInput(prompt);
  };

  return (
    <article className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400">
          Asistente contable
        </p>
        <h2 className="text-lg font-semibold text-slate-900">Pregúntale a tu contador virtual</h2>
        <p className="text-sm text-slate-500">
          Analizando {invoices.length} facturas y {expenses.length} egresos en tiempo real.
        </p>
      </header>
      <div className="mt-4 flex-1 space-y-3 overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
        <div className="h-64 space-y-3 overflow-y-auto pr-2 text-sm">
          {messages.map((message, index) => (
            <p
              key={`${message.role}-${index}`}
              className={`leading-relaxed ${
                message.role === 'assistant'
                  ? 'text-slate-700'
                  : 'text-slate-900 font-semibold'
              }`}
            >
              <span className="block text-[11px] uppercase tracking-[0.3em] text-slate-400">
                {message.role === 'assistant' ? 'Carbon AI' : 'Tú'}
              </span>
              {message.content}
            </p>
          ))}
          <div ref={chatEndRef} />
        </div>
        {error && (
          <p className="rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
            {error}
          </p>
        )}
      </div>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ej. ¿Cuánto debo pagar de impuestos este mes?"
            className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            disabled={isSending}
          />
          <button
            type="submit"
            disabled={isSending}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSending ? 'Analizando…' : 'Preguntar'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handleQuickPrompt(prompt)}
              className="rounded-2xl border border-slate-200 px-3 py-1 text-xs text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
            >
              {prompt}
            </button>
          ))}
        </div>
      </form>
    </article>
  );
}
