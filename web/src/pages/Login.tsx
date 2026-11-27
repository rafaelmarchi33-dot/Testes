import { useState } from "react";
import { api } from "../lib/api.ts";
import { Button, Field, Input, ErrorBox } from "../components/ui.tsx";
import { M2Mark } from "../components/Brand.tsx";

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
      <div className="command-bg relative hidden overflow-hidden lg:flex flex-col items-center justify-center gap-10 p-12 text-cream">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.22),transparent_60%)]" />
        <M2Mark large className="relative w-full max-w-[380px] drop-shadow-[0_20px_60px_rgba(16,185,129,0.35)]" />
        <div className="relative max-w-md text-center">
          <div className="filament mx-auto mb-5 w-40" />
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Central de comando da Mind2Matter.</h2>
          <p className="mt-3 text-sm text-cream/70">Vendas, lucro, produção, produtos e crescimento em um só lugar — com dados reais, inteligência artificial e nenhuma alteração sem a sua aprovação.</p>
          <p className="mt-6 text-[11px] tracking-[0.2em] text-[#34d399]">MIND2MATTER INTELLIGENCE</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div className="lg:hidden mb-2 flex justify-center"><M2Mark large className="size-36" /></div>
          <div>
            <h1 className="text-2xl font-semibold">{needsSetup ? "Configuração inicial" : "Entrar"}</h1>
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
