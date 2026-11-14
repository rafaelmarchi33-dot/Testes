import { useState } from "react";
import { api } from "../lib/api.ts";
import { Button, Field, Input, ErrorBox } from "../components/ui.tsx";

export default function Login({ needsSetup, onDone }: { needsSetup: boolean; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api(needsSetup ? "/auth/setup" : "/auth/login", { body: needsSetup ? form : { email: form.email, password: form.password } });
      onDone();
    } catch (e) { setErr(e as Error); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-[#14143a] p-12 text-white">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-lg bg-white/10">
            <svg viewBox="0 0 32 32" className="size-5"><path d="M7 23V9l9 8 9-8v14" stroke="currentColor" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <span className="text-sm font-semibold tracking-wide">MERCADO LIVRE INTELLIGENCE</span>
        </div>
        <div>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Vendas, margens e oportunidades<br />da sua loja em um só lugar.</h2>
          <p className="mt-4 max-w-md text-sm text-white/60">Dados reais da sua conta, inteligência artificial que explica cada recomendação e nenhuma alteração na loja sem a sua aprovação.</p>
        </div>
        <p className="text-xs text-white/40">Integração oficial via API do Mercado Livre · OAuth 2.0</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <h1 className="text-xl font-semibold">{needsSetup ? "Configuração inicial" : "Entrar"}</h1>
            <p className="mt-1 text-sm text-ink-2">{needsSetup ? "Crie a conta de administrador da plataforma." : "Acesse o painel da sua loja."}</p>
          </div>
          {needsSetup && <Field label="Nome"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></Field>}
          <Field label="E-mail"><Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></Field>
          <Field label="Senha" hint={needsSetup ? "Mínimo de 10 caracteres." : undefined}>
            <Input required type="password" minLength={needsSetup ? 10 : 1} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete={needsSetup ? "new-password" : "current-password"} />
          </Field>
          <ErrorBox error={err} />
          <Button variant="primary" className="w-full" loading={busy}>{needsSetup ? "Criar administrador" : "Entrar"}</Button>
        </form>
      </div>
    </div>
  );
}
