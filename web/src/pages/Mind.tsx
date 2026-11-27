import { useEffect, useRef, useState } from "react";
import { Brain, Crown, Send, Plus, Trash2, Stethoscope, Loader2, Eye } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, PageHeader, Button, Textarea, ErrorBox, Spinner, Badge, Tabs, Empty, Modal, Notice, cx } from "../components/ui.tsx";
import { Markdown } from "../lib/markdown.tsx";
import { dateTime } from "../lib/format.ts";

const CAPABILITIES = [
  "Analise os resultados comerciais do último relatório e explique o que mudou.",
  "Quais anúncios têm baixa conversão e o que fazer em cada um?",
  "Quais produtos são mais rentáveis por hora de máquina?",
  "Recomende ajustes de preço com base nos custos cadastrados.",
  "Onde estão as maiores oportunidades de crescimento agora?",
  "Crie 3 títulos otimizados para o ímã de reposição Hollyland Lark M2.",
  "Escreva uma descrição comercial para o produto campeão.",
  "Sugira uma sequência de fotografias para o anúncio principal.",
  "Sugira kits que aumentem o ticket médio.",
  "Calcule o preço mínimo e recomendado de uma peça de 60 g e 2 h de impressão.",
  "Planeje a produção da próxima semana.",
  "Onde estamos desperdiçando filamento, tempo ou dinheiro?",
  "Analise os concorrentes cadastrados.",
  "Devo investir em publicidade agora? Quanto?",
  "Quando devo comprar outra impressora?",
  "Crie um relatório executivo da semana.",
];
const CEO_QUESTIONS = [
  "O que precisamos fazer hoje?", "Onde estamos perdendo dinheiro?", "Quais produtos devemos fabricar?", "Quais anúncios precisam de melhorias?",
  "Qual produto merece mais investimento?", "O que está impedindo o crescimento?", "Como chegar aos R$ 20 mil mensais?",
];
const TAG_TONE: Record<string, any> = { REAL: "good", ESTIMATIVA: "warn", "HIPÓTESE": "info", "RECOMENDAÇÃO": "brand" };

export default function Mind() {
  const [tab, setTab] = useState<"chat" | "ceo">("chat");
  return (
    <>
      <PageHeader title="Mind AI" subtitle="Inteligência artificial treinada no contexto da Mind2Matter — consulta os dados da empresa antes de responder e separa real, estimativa, hipótese e recomendação"
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: "chat", label: <span className="flex items-center gap-1.5"><Brain className="size-3.5" />Conversas</span> }, { value: "ceo", label: <span className="flex items-center gap-1.5"><Crown className="size-3.5" />CEO Mind2Matter</span> }]} />} />
      {tab === "chat" ? <Chat /> : <Ceo />}
    </>
  );
}

function Chat() {
  const convs = useApi<any[]>("/mind/conversations");
  const [active, setActive] = useState<number | null>(null);
  const [agent, setAgent] = useState<"mind" | "ceo">("mind");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const [ctx, setCtx] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);
  const open = async (id: number) => {
    setErr(null);
    try { const c = await api(`/mind/conversations/${id}`); setActive(id); setAgent(c.agent); setMessages(c.messages); } catch (e) { setErr(e as Error); }
  };
  const send = async (msg = text) => {
    if (msg.trim().length < 2 || busy) return;
    setBusy(true); setErr(null); setText("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    try {
      const r = await api("/mind/chat", { body: { conversation_id: active ?? undefined, agent, message: msg } });
      setActive(r.conversation_id);
      setMessages((m) => [...m, { role: "assistant", content: r.answer }]);
      convs.reload();
    } catch (e) { setErr(e as Error); setMessages((m) => m.slice(0, -1)); setText(msg); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card pad={false} className="h-fit">
        <div className="flex items-center justify-between border-b border-line p-3">
          <span className="text-xs font-semibold">Histórico</span>
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => { setActive(null); setMessages([]); }}>Nova</Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {(convs.data ?? []).length === 0 && <p className="p-3 text-xs text-ink-3">Nenhuma conversa ainda.</p>}
          {(convs.data ?? []).map((c) => (
            <div key={c.id} className={cx("group flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs", active === c.id ? "bg-brand-soft text-brand" : "hover:bg-surface-2")}>
              <button className="min-w-0 flex-1 text-left" onClick={() => open(c.id)}>
                <div className="truncate font-medium">{c.agent === "ceo" && <span className="mr-1 text-[10px] font-semibold text-warn">CEO</span>}{c.title}</div><div className="text-[10px] text-ink-3">{dateTime(c.updated_at)} · {c.messages} msgs</div>
              </button>
              <button aria-label="Excluir conversa" className="opacity-0 group-hover:opacity-100" onClick={async () => { await api(`/mind/conversations/${c.id}`, { method: "DELETE" }); if (active === c.id) { setActive(null); setMessages([]); } convs.reload(); }}><Trash2 className="size-3.5 text-ink-3" /></button>
            </div>
          ))}
        </div>
      </Card>
      <Card pad={false} className="flex min-h-[70vh] flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <span className="text-xs text-ink-3">Agente:</span>
          <Tabs value={agent} onChange={(v) => { if (!active) setAgent(v); }} items={[{ value: "mind", label: "Mind AI (analista)" }, { value: "ceo", label: "CEO Mind2Matter" }]} />
          <div className="ml-auto flex gap-1.5">{Object.keys(TAG_TONE).map((t) => <Badge key={t} tone={TAG_TONE[t]}>{t}</Badge>)}</div>
          <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => setCtx(true)}>Dados que a IA vê</Button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div>
              <Empty icon={<Brain className="size-5" />} title={agent === "ceo" ? "CEO Mind2Matter" : "Pergunte ao Mind AI"}>As respostas usam os dados da empresa registrados no sistema. Quando faltar informação, a IA diz o que precisa ser cadastrado.</Empty>
              <div className="grid gap-2 sm:grid-cols-2">
                {(agent === "ceo" ? CEO_QUESTIONS : CAPABILITIES).map((c) => <button key={c} onClick={() => send(c)} className="rounded-lg border border-line p-2.5 text-left text-xs text-ink-2 transition hover:border-brand/40 hover:text-ink">{c}</button>)}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cx("max-w-[92%] rounded-2xl px-4 py-3 text-sm", m.role === "user" ? "bg-brand text-white dark:text-[#04130d]" : "border border-line bg-surface-2")}>
                {m.role === "user" ? m.content : <div className="prose-ai"><Markdown text={m.content} /></div>}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-ink-3"><Loader2 className="size-4 animate-spin" /> Consultando os dados da Mind2Matter…</div>}
          <div ref={end} />
        </div>
        <ErrorBox error={err} />
        <div className="flex gap-2 border-t border-line p-3">
          <Textarea className="min-h-12 flex-1 resize-none" rows={2} placeholder="Pergunte sobre vendas, preços, produção, produtos, metas…" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <Button variant="primary" loading={busy} onClick={() => send()} icon={<Send className="size-4" />} aria-label="Enviar">Enviar</Button>
        </div>
      </Card>
      <ContextModal open={ctx} onClose={() => setCtx(false)} />
    </div>
  );
}

function ContextModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = useApi<any>(open ? "/mind/context" : null, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Contexto enviado à IA" wide>
      <Notice>Este é exatamente o snapshot que o Mind AI recebe. Não inclui dados pessoais de compradores.</Notice>
      {d.loading ? <Spinner /> : <pre className="mt-3 max-h-[60vh] overflow-auto rounded-lg bg-surface-2 p-3 text-[11px]">{JSON.stringify(d.data, null, 2)}</pre>}
    </Modal>
  );
}

function Ceo() {
  const latest = useApi<any>("/mind/diagnosis");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const run = async () => { setBusy(true); setErr(null); try { latest.setData(await api("/mind/diagnosis", { body: {} })); } catch (e) { setErr(e as Error); } finally { setBusy(false); } };
  const r = latest.data?.report;
  const Items = ({ items }: { items: any[] }) => items.length ? (
    <ul className="space-y-2">{items.map((x, i) => <li key={i} className="text-sm"><Badge tone={TAG_TONE[x.tipo]} className="mr-1.5">{x.tipo}</Badge>{x.texto}{x.evidencia && <div className="ml-1 mt-0.5 text-[11px] text-ink-3">Evidência: {x.evidencia}</div>}</li>)}</ul>
  ) : <p className="text-xs text-ink-3">Sem evidência suficiente nos dados.</p>;
  return (
    <div className="space-y-4">
      <Card className="glow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand"><Crown className="size-5" /></div>
            <div><div className="font-semibold">CEO Mind2Matter</div><div className="text-xs text-ink-3">Avalia a empresa inteira e define as prioridades estratégicas. {latest.data && `Último diagnóstico: ${dateTime(latest.data.created_at)}`}</div></div></div>
          <Button variant="primary" loading={busy} onClick={run} icon={<Stethoscope className="size-4" />}>Gerar diagnóstico completo</Button>
        </div>
      </Card>
      <ErrorBox error={err} />
      {busy && <Spinner label="O CEO está analisando vendas, anúncios, custos, produção e metas…" />}
      {!r && !busy && !latest.loading && <Card><Empty icon={<Crown className="size-5" />} title="Nenhum diagnóstico gerado">Clique em “Gerar diagnóstico completo”. Requer a IA configurada no servidor.</Empty></Card>}
      {r && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2" title="Resumo executivo" action={<Badge tone={r.nota_saude_empresa >= 70 ? "good" : r.nota_saude_empresa >= 40 ? "warn" : "bad"}>Saúde {Math.round(r.nota_saude_empresa)}/100</Badge>}>
            <p className="text-sm leading-relaxed">{r.resumo_executivo}</p>
          </Card>
          <Card title="O que precisamos fazer hoje?">
            <ol className="space-y-2.5">{r.o_que_fazer_hoje.map((a: any, i: number) => <li key={i} className="flex gap-2.5 text-sm"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{a.prioridade}</span><div><div className="font-medium">{a.acao}{a.requer_aprovacao && <Badge tone="warn" className="ml-1.5">requer aprovação</Badge>}</div><div className="text-xs text-ink-3">{a.motivo} · impacto: {a.impacto}</div></div></li>)}</ol>
          </Card>
          <Card title="Onde estamos perdendo dinheiro?"><Items items={r.onde_perdemos_dinheiro} /></Card>
          <Card title="Quais produtos devemos fabricar?"><Items items={r.produtos_para_fabricar} /></Card>
          <Card title="O que deixar de fabricar ou rever"><Items items={r.produtos_para_parar_ou_rever} /></Card>
          <Card title="Quais anúncios precisam de melhorias?">
            {r.anuncios_para_melhorar.length ? <ul className="space-y-2">{r.anuncios_para_melhorar.map((a: any, i: number) => <li key={i} className="text-sm"><Badge tone={TAG_TONE[a.tipo]} className="mr-1.5">{a.tipo}</Badge><b>{a.anuncio}</b>: {a.problema} → {a.acao}</li>)}</ul> : <p className="text-xs text-ink-3">Sem evidência suficiente.</p>}
          </Card>
          <Card title="Qual produto merece mais investimento?"><Items items={r.produto_para_investir} /></Card>
          <Card title="Quanto investir em publicidade?"><Items items={r.investimento_publicidade} /></Card>
          <Card title="Quando comprar outra impressora?"><p className="text-sm"><Badge tone={TAG_TONE[r.quando_comprar_impressora.tipo]} className="mr-1.5">{r.quando_comprar_impressora.tipo}</Badge>{r.quando_comprar_impressora.texto}</p><p className="mt-1 text-xs text-ink-3">Gatilho: {r.quando_comprar_impressora.gatilho}</p></Card>
          <Card title="O que está impedindo o crescimento?"><Items items={r.bloqueios_crescimento} /></Card>
          <Card title="Como chegar aos R$ 20 mil mensais?" className="lg:col-span-2">
            <ol className="grid gap-2 sm:grid-cols-2">{r.plano_20k.map((s: any, i: number) => <li key={i} className="rounded-lg border border-line p-3 text-sm"><div className="flex items-center justify-between gap-2"><b>{i + 1}. {s.etapa}</b><Badge tone={TAG_TONE[s.tipo]}>{s.tipo}</Badge></div><div className="mt-1 text-xs text-ink-3">Meta: {s.meta} · Prazo: {s.prazo}</div></li>)}</ol>
          </Card>
          {r.dados_faltantes.length > 0 && <Card title="Dados que faltam para um diagnóstico melhor" className="lg:col-span-2"><ul className="list-disc space-y-1 pl-5 text-xs text-ink-2">{r.dados_faltantes.map((x: string) => <li key={x}>{x}</li>)}</ul></Card>}
        </div>
      )}
    </div>
  );
}
