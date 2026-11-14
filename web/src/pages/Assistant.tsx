import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, FileText, TrendingDown, TrendingUp, Lightbulb, PackageX, Tag, Rocket, ListChecks, AlertCircle } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, Button, PageHeader, Tabs, Spinner, ErrorBox, Empty, Badge, Notice, Textarea, useToast, cx } from "../components/ui.tsx";
import { Markdown } from "../lib/markdown.tsx";
import { brl, dateTime } from "../lib/format.ts";
import { useUser, canOperate } from "../components/Layout.tsx";

const SUGGESTIONS = [
  "Qual produto devo anunciar mais?", "Quais produtos estão vendendo melhor?", "Qual produto possui maior margem de lucro?",
  "Quais anúncios precisam ser melhorados?", "Quais produtos estão perdendo vendas?", "Quais produtos possuem potencial de crescimento?",
  "Quais produtos devo produzir novamente?", "Quais preços precisam ser ajustados?", "Quais produtos estão com estoque baixo?",
  "Como aumentar meu faturamento?", "Quais produtos devo lançar esta semana?",
];

const conf = (c: string) => <Badge tone={c === "alta" ? "good" : c === "média" ? "warn" : "neutral"}>confiança {c}</Badge>;

function Section({ icon, title, children, count }: { icon: React.ReactNode; title: string; children: React.ReactNode; count: number }) {
  return (
    <Card title={<span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-brand">{icon}{title} <span className="text-ink-3 font-normal">({count})</span></span>}>
      {count ? <div className="space-y-3">{children}</div> : <p className="text-xs text-ink-3">Nada relevante identificado nos dados.</p>}
    </Card>
  );
}

function Report() {
  const user = useUser();
  const { data, error, loading, reload } = useApi<any>("/ai/daily-report");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const { toast, node } = useToast();
  const gen = async () => {
    setBusy(true); setErr(null);
    try { await api("/ai/daily-report", { body: {} }); await reload(); } catch (e) { setErr(e as Error); } finally { setBusy(false); }
  };
  const propose = async (r: any) => {
    try {
      await api("/actions", { body: { type: "update_price", payload: { listing_id: r.listing_id, price: r.preco_sugerido }, source: "ai", rationale: `${r.motivo}\n\nEvidência: ${r.evidencia}\nImpacto estimado: ${r.impacto_estimado}` } });
      toast("Enviado para a Central de Aprovações");
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  if (loading) return <Spinner />;
  const rep = data?.report;
  return (
    <div className="space-y-6">
      {node}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">{data ? <>Relatório gerado em <b>{dateTime(data.created_at)}</b>. Um novo é gerado automaticamente todo dia às 7h.</> : "Nenhum relatório gerado ainda."}</p>
        {canOperate(user) && <Button variant="primary" icon={<Sparkles className="size-4" />} loading={busy} onClick={gen}>{busy ? "Analisando a loja…" : "Gerar relatório agora"}</Button>}
      </div>
      <ErrorBox error={err ?? error} />
      {data?.data_gaps?.length > 0 && <Notice tone="warn" title="Limitações dos dados:">{data.data_gaps.join(" · ")}</Notice>}
      {!rep && !busy && <Card><Empty icon={<FileText className="size-5" />} title="Gere o primeiro relatório">A IA analisa vendas, margens, estoque e tendências reais da loja e explica cada recomendação.</Empty></Card>}
      {rep && (
        <>
          <Card title="1. Resumo das vendas"><p className="text-sm leading-relaxed text-ink-2 whitespace-pre-line">{rep.resumo_vendas}</p></Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section icon={<TrendingUp />} title="2. Produtos que mais venderam" count={rep.mais_vendidos.length}>
              {rep.mais_vendidos.map((p: any, i: number) => (
                <div key={i} className="text-sm"><div className="font-medium">{p.titulo}</div><div className="text-ink-2">{p.destaque}</div><div className="text-xs text-ink-3 mt-0.5">Dados: {p.evidencia}</div></div>
              ))}
            </Section>
            <Section icon={<TrendingDown />} title="3. Produtos com queda de desempenho" count={rep.queda_desempenho.length}>
              {rep.queda_desempenho.map((p: any, i: number) => (
                <div key={i} className="text-sm"><div className="font-medium">{p.titulo}</div><div className="text-ink-2">{p.diagnostico}</div><div className="text-xs text-ink-3 mt-0.5">Dados: {p.evidencia}</div><div className="text-xs mt-1"><b>Ação:</b> {p.acao_sugerida}</div></div>
              ))}
            </Section>
            <Section icon={<Lightbulb />} title="4. Oportunidades identificadas" count={rep.oportunidades.length}>
              {rep.oportunidades.map((p: any, i: number) => (
                <div key={i} className="text-sm"><div className="flex flex-wrap items-center gap-2 font-medium">{p.titulo} {conf(p.confianca)}</div><div className="text-ink-2">{p.descricao}</div><div className="text-xs text-ink-3 mt-0.5">Dados: {p.evidencia} · Impacto: {p.impacto_estimado}</div></div>
              ))}
            </Section>
            <Section icon={<PackageX />} title="5. Alertas de estoque" count={rep.alertas_estoque.length}>
              {rep.alertas_estoque.map((p: any, i: number) => (
                <div key={i} className="text-sm"><div className="font-medium">{p.titulo}</div><div className="text-ink-2">{p.situacao}</div><div className="text-xs text-ink-3 mt-0.5">Dados: {p.evidencia}</div><div className="text-xs mt-1"><b>Ação:</b> {p.acao}</div></div>
              ))}
            </Section>
          </div>
          <Section icon={<Tag />} title="6. Recomendações de preços" count={rep.recomendacoes_preco.length}>
            {rep.recomendacoes_preco.map((p: any, i: number) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-line p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="text-sm">
                  <div className="flex flex-wrap items-center gap-2 font-medium">{p.titulo} {conf(p.confianca)}</div>
                  <div className="num mt-0.5">{brl(p.preco_atual)} → <b>{brl(p.preco_sugerido)}</b> <span className={cx("text-xs", p.preco_sugerido >= p.preco_atual ? "text-good" : "text-bad")}>({(((p.preco_sugerido - p.preco_atual) / p.preco_atual) * 100).toFixed(1)}%)</span></div>
                  <div className="text-ink-2 mt-1">{p.motivo}</div>
                  <div className="text-xs text-ink-3 mt-0.5">Dados: {p.evidencia} · Impacto estimado: {p.impacto_estimado}</div>
                </div>
                {canOperate(user) && <Button size="sm" onClick={() => propose(p)}>Enviar para aprovação</Button>}
              </div>
            ))}
          </Section>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section icon={<Rocket />} title="7. Sugestões de novos produtos" count={rep.sugestoes_novos_produtos.length}>
              {rep.sugestoes_novos_produtos.map((p: any, i: number) => (
                <div key={i} className="text-sm"><div className="font-medium">{p.ideia}</div><div className="text-ink-2">{p.motivo}</div><div className="text-xs text-ink-3 mt-0.5">Base: {p.base_nos_dados}</div></div>
              ))}
            </Section>
            <Section icon={<ListChecks />} title="8. Ações prioritárias" count={rep.acoes_prioritarias.length}>
              {[...rep.acoes_prioritarias].sort((a: any, b: any) => a.prioridade - b.prioridade).map((p: any, i: number) => (
                <div key={i} className="flex gap-3 text-sm">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{p.prioridade}</span>
                  <div><div className="font-medium">{p.acao} {p.requer_aprovacao && <Badge tone="warn">requer aprovação</Badge>}</div><div className="text-ink-2">{p.motivo}</div><div className="text-xs text-ink-3 mt-0.5">Dados: {p.evidencia} · Impacto: {p.impacto_estimado}</div></div>
                </div>
              ))}
            </Section>
          </div>
          {rep.limitacoes?.length > 0 && <Notice tone="warn" title="Limitações apontadas pela IA:">{rep.limitacoes.join(" · ")}</Notice>}
        </>
      )}
    </div>
  );
}

function Chat() {
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);
  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    const history = msgs;
    setMsgs([...history, { role: "user", content: question }]);
    setInput(""); setBusy(true); setErr(null);
    try {
      const r = await api("/ai/ask", { body: { question, history } });
      setMsgs((m) => [...m, { role: "assistant", content: r.answer }]);
      setGaps(r.data_gaps ?? []);
    } catch (e) { setErr(e as Error); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <Card pad={false} className="flex min-h-[60vh] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {!msgs.length && <Empty icon={<Bot className="size-5" />} title="Pergunte ao gerente de IA">Ele responde com base nos dados reais da sua loja, mostra os números que justificam cada recomendação e indica quando faltam dados.</Empty>}
          {msgs.map((m, i) => (
            <div key={i} className={cx("flex gap-3", m.role === "user" && "justify-end")}>
              {m.role === "assistant" && <div className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Bot className="size-4" /></div>}
              <div className={cx("max-w-[85%] rounded-2xl px-4 py-2.5", m.role === "user" ? "bg-brand text-white dark:text-[#0b0b10] text-sm" : "bg-surface-2")}>
                {m.role === "user" ? m.content : <Markdown text={m.content} />}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-ink-3"><Sparkles className="size-3.5 animate-pulse" /> Analisando os dados da loja…</div>}
          <ErrorBox error={err} />
          <div ref={end} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex items-end gap-2 border-t border-line p-3">
          <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ex.: Quais preços precisam ser ajustados?" className="min-h-10 max-h-40 resize-none"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }} rows={1} />
          <Button variant="primary" loading={busy} icon={<Send className="size-4" />} aria-label="Enviar" />
        </form>
      </Card>
      <div className="space-y-3">
        <p className="text-xs font-medium text-ink-3">Perguntas frequentes</p>
        <div className="flex flex-wrap gap-1.5 lg:flex-col">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy} className="rounded-lg border border-line bg-surface px-3 py-2 text-left text-xs text-ink-2 hover:border-brand/40 hover:text-ink disabled:opacity-50">{s}</button>
          ))}
        </div>
        {gaps.length > 0 && <div className="flex gap-2 rounded-lg bg-warn-soft p-3 text-[11px] text-ink-2"><AlertCircle className="size-3.5 shrink-0 text-warn" /><div>{gaps.join(" · ")}</div></div>}
      </div>
    </div>
  );
}

export default function Assistant() {
  const [tab, setTab] = useState<"report" | "chat">("report");
  return (
    <>
      <PageHeader title="Gerente da loja (IA)" subtitle="Análises e recomendações baseadas exclusivamente nos dados reais da sua loja."
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: "report", label: "Relatório diário" }, { value: "chat", label: "Conversar" }]} />} />
      {tab === "report" ? <Report /> : <Chat />}
    </>
  );
}
