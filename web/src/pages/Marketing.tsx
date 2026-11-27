import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Sparkles, Camera, Copy, Trash2, CheckCircle2, Circle } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { useGlobal } from "../lib/global.tsx";
import { useUser, canOperate } from "../components/Layout.tsx";
import { Card, PageHeader, Button, Input, Select, Field, NumInput, Textarea, ErrorBox, Spinner, Badge, Tabs, Table, Pending, ConfirmDialog, useToast, Notice, cx } from "../components/ui.tsx";
import { AdsReturn } from "../components/charts.tsx";
import { brl, int, pct, dateTime } from "../lib/format.ts";

export default function Marketing() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"gen" | "ads">("gen");
  return (
    <>
      <PageHeader title="Anúncios e marketing" subtitle="Gerador inteligente de anúncios, planejador de fotografias e análise de publicidade (somente leitura)"
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: "gen", label: "Gerador e fotografias" }, { value: "ads", label: "Análise de publicidade" }]} />} />
      {tab === "gen" ? <Generator labId={params.get("lab")} /> : <AdsAnalysis />}
    </>
  );
}

function Generator({ labId }: { labId: string | null }) {
  const user = useUser();
  const list = useApi<any[]>("/marketing");
  const products = useApi<any[]>("/products");
  const lab = useApi<any>("/lab");
  const [src, setSrc] = useState<"product" | "lab" | "custom">(labId ? "lab" : "product");
  const [f, setF] = useState<any>({ product_id: "", lab_product_id: labId ?? "", name: "", details: "", material: "PLA", weight_g: null, print_minutes: null, reference_price: null, channel: "mercadolivre" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { if (list.data?.length && open === null) setOpen(list.data[0].id); }, [list.data, open]);
  const gen = async () => {
    setBusy(true); setErr(null);
    const body: any = { channel: f.channel, reference_price: f.reference_price ?? undefined, details: f.details || undefined, weight_g: f.weight_g ?? undefined, print_minutes: f.print_minutes ?? undefined, material: f.material };
    if (src === "product") body.product_id = Number(f.product_id);
    else if (src === "lab") body.lab_product_id = Number(f.lab_product_id);
    else body.name = f.name;
    try { const r = await api("/marketing/generate", { body }); list.reload(); setOpen(r.id); } catch (e) { setErr(e as Error); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        {canOperate(user) && (
          <Card title="Gerar anúncio com IA" subtitle="3 títulos, descrição, palavras-chave, ficha técnica, diferenciais, FAQ, kits, posicionamento e plano de fotos">
            <Tabs value={src} onChange={setSrc} items={[{ value: "product", label: "Produto" }, { value: "lab", label: "Laboratório" }, { value: "custom", label: "Avulso" }]} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              {src === "product" && <Field label="Produto" className="col-span-2"><Select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}><option value="">Selecione…</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
              {src === "lab" && <Field label="Produto do laboratório" className="col-span-2"><Select value={f.lab_product_id} onChange={(e) => setF({ ...f, lab_product_id: e.target.value })}><option value="">Selecione…</option>{(lab.data?.items ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
              {src === "custom" && <Field label="Nome do produto" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>}
              <Field label="Detalhes (medidas, compatibilidade, cores)" className="col-span-2"><Textarea className="min-h-16" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
              <Field label="Peso (g)"><NumInput value={f.weight_g} onChange={(v) => setF({ ...f, weight_g: v })} placeholder="do cadastro" /></Field>
              <Field label="Tempo (min)"><NumInput value={f.print_minutes} onChange={(v) => setF({ ...f, print_minutes: v })} placeholder="do cadastro" /></Field>
              <Field label="Preço de referência (R$)"><NumInput value={f.reference_price} onChange={(v) => setF({ ...f, reference_price: v })} /></Field>
              <Field label="Canal"><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="mercadolivre">Mercado Livre</option><option value="shopee">Shopee</option></Select></Field>
            </div>
            <Button variant="primary" className="mt-3 w-full" loading={busy} icon={<Sparkles className="size-4" />} disabled={(src === "product" && !f.product_id) || (src === "lab" && !f.lab_product_id) || (src === "custom" && !f.name)} onClick={gen}>Gerar pacote do anúncio</Button>
            <ErrorBox error={err} />
            <p className="mt-2 text-[11px] text-ink-3">O preço sugerido é calculado pelo sistema com seus custos (não pela IA). Nada é publicado: use “Criar anúncio (ML)” e a Central de Aprovações para publicar.</p>
          </Card>
        )}
        <Card title="Conteúdos gerados" pad={false}>
          <div className="max-h-[50vh] overflow-y-auto p-1.5">
            {(list.data ?? []).length === 0 && <p className="p-3 text-xs text-ink-3">Nenhum conteúdo gerado.</p>}
            {(list.data ?? []).map((m) => {
              const done = m.photo_plan.filter((p: any) => p.done).length;
              return <button key={m.id} onClick={() => setOpen(m.id)} className={cx("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs", open === m.id ? "bg-brand-soft" : "hover:bg-surface-2")}>
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{m.name}</div><div className="text-[10px] text-ink-3">{dateTime(m.created_at)}</div></div>
                <Badge tone={done === m.photo_plan.length ? "good" : "neutral"}><Camera className="size-3" />{done}/{m.photo_plan.length}</Badge></button>;
            })}
          </div>
        </Card>
      </div>
      {open ? <ContentView id={open} onDeleted={() => { setOpen(null); list.reload(); }} onChanged={list.reload} /> : <Card><Pending title="Selecione ou gere um anúncio" /></Card>}
    </div>
  );
}

function ContentView({ id, onDeleted, onChanged }: { id: number; onDeleted: () => void; onChanged: () => void }) {
  const d = useApi<any>(`/marketing/${id}`, [id]);
  const user = useUser();
  const [del, setDel] = useState(false);
  const { toast, node } = useToast();
  if (d.loading && !d.data) return <Spinner />;
  if (!d.data) return <ErrorBox error={d.error} />;
  const c = d.data.content;
  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast("Copiado")).catch(() => toast("Não foi possível copiar", "bad")); };
  return (
    <div className="space-y-4">
      {node}
      <Card title={d.data.name} subtitle={`Gerado em ${dateTime(d.data.created_at)} · ${d.data.model ?? ""}`} action={canOperate(user) && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(true)}>Excluir</Button>}>
        <div className="space-y-2">
          <div className="text-xs font-semibold text-ink-3">Títulos (3 opções)</div>
          {c.titulos.map((t: string, i: number) => <div key={i} className="flex items-center gap-2 rounded-lg border border-line p-2.5 text-sm"><span className="flex-1">{t}</span><span className={cx("text-[10px] num", t.length > 60 ? "text-bad" : "text-ink-3")}>{t.length}/60</span><button onClick={() => copy(t)} aria-label="Copiar"><Copy className="size-3.5 text-ink-3" /></button></div>)}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Descrição comercial" action={<Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => copy(c.descricao)}>Copiar</Button>}><p className="whitespace-pre-wrap text-sm text-ink-2">{c.descricao}</p></Card>
        <div className="space-y-4">
          <Card title="Preço sugerido (calculado pelo sistema)">
            {c.pricing?.preco_recomendado !== undefined ? (
              <div className="grid grid-cols-3 gap-2 text-center">{[["Mínimo", c.pricing.preco_minimo], ["Recomendado", c.pricing.preco_recomendado], ["Promocional", c.pricing.preco_promocional]].map(([l, v]) => <div key={l as string} className="rounded-lg bg-surface-2 p-2"><div className="text-[11px] text-ink-3">{l}</div><div className="font-semibold num">{brl(v as number)}</div></div>)}</div>
            ) : <p className="text-xs text-ink-3">{c.pricing?.nota}</p>}
            {c.pricing?.itens_de_custo_faltando?.length > 0 && <p className="mt-2 text-[11px] text-warn">Custos não informados: {c.pricing.itens_de_custo_faltando.join(", ")}</p>}
            {c.pricing?.precos_concorrentes_cadastrados?.length > 0 && <p className="mt-1 text-[11px] text-ink-3">Concorrentes cadastrados: {c.pricing.precos_concorrentes_cadastrados.map(brl).join(", ")}</p>}
            <p className="mt-2 text-xs text-ink-2">{c.observacoes_preco}</p>
          </Card>
          <Card title="Palavras-chave"><div className="flex flex-wrap gap-1.5">{c.palavras_chave.map((k: string) => <Badge key={k}>{k}</Badge>)}</div></Card>
        </div>
        <Card title="Ficha técnica"><table className="w-full text-xs">{c.ficha_tecnica.map((a: any, i: number) => <tr key={i} className="border-b border-line/50"><td className="py-1.5 text-ink-3">{a.atributo}</td><td className="py-1.5">{a.valor}{a.confirmar && <Badge tone="warn" className="ml-1.5">confirmar</Badge>}</td></tr>)}</table></Card>
        <Card title="Diferenciais e posicionamento"><ul className="list-disc space-y-1 pl-5 text-sm">{c.diferenciais.map((x: string) => <li key={x}>{x}</li>)}</ul><p className="mt-3 text-xs text-ink-2"><b>Estratégia:</b> {c.estrategia_posicionamento}</p></Card>
        <Card title="Perguntas frequentes">{c.perguntas_frequentes.map((q: any, i: number) => <div key={i} className="mb-2 text-sm"><b>{q.pergunta}</b><p className="text-ink-2">{q.resposta}</p></div>)}</Card>
        <Card title="Sugestões de kits">{c.sugestao_kits.length ? c.sugestao_kits.map((k: any, i: number) => <div key={i} className="mb-2 text-sm"><b>{k.kit}</b> — {k.composicao}<div className="text-xs text-ink-3">{k.motivo}</div></div>) : <p className="text-xs text-ink-3">Nenhum kit sugerido.</p>}</Card>
      </div>
      <Card title="Planejador de fotografias" subtitle="Sequência sugerida — marque conforme produzir">
        <ol className="grid gap-2 sm:grid-cols-2">
          {d.data.photo_plan.map((p: any, i: number) => (
            <li key={i}>
              <button disabled={!canOperate(user)} onClick={async () => { await api(`/marketing/${id}/photos`, { method: "PATCH", body: { index: i, done: !p.done } }); d.reload(); onChanged(); }}
                className={cx("flex w-full gap-2.5 rounded-lg border p-3 text-left text-sm transition", p.done ? "border-brand/40 bg-brand-soft" : "border-line hover:border-brand/30")}>
                {p.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" /> : <Circle className="mt-0.5 size-4 shrink-0 text-ink-3" />}
                <div><div className="font-medium">{i + 1}. {p.title}</div>{p.description && <div className="text-xs text-ink-3">{p.description}</div>}</div>
              </button>
            </li>
          ))}
        </ol>
      </Card>
      <ConfirmDialog open={del} onClose={() => setDel(false)} danger title="Excluir conteúdo" confirmLabel="Excluir" onConfirm={async () => { await api(`/marketing/${id}`, { method: "DELETE", body: { confirm: true } }); onDeleted(); }}>Excluir este pacote de anúncio?</ConfirmDialog>
    </div>
  );
}

function AdsAnalysis() {
  const g = useGlobal();
  const d = useApi<any>(`/marketing/ads?${g.query}`);
  if (d.loading && !d.data) return <Spinner />;
  if (!d.data) return <ErrorBox error={d.error} />;
  const t = d.data.totals;
  return (
    <div className="space-y-4">
      <Notice>{d.data.note} Dados da API do Product Ads (quando autorizada) ou do relatório importado na Central de Importação.</Notice>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {[["Impressões", int(t.prints)], ["Cliques", int(t.clicks)], ["CTR", pct(t.ctr_pct, 2)], ["CPC", brl(t.cpc)], ["Investimento", brl(t.cost)], ["Receita atribuída", brl(t.revenue)], ["ACOS", pct(t.acos_pct)], ["ROAS", t.roas === null ? "—" : `${t.roas.toFixed(2)}x`]].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-line bg-surface p-3"><div className="text-[11px] text-ink-3">{l}</div><div className="text-base font-semibold num">{d.data.campaigns.length ? v : "—"}</div></div>
        ))}
      </div>
      <Card title="Investimento x receita atribuída">{d.data.daily.length ? <AdsReturn data={d.data.daily} /> : <Pending>Sem dados de publicidade no período. Importe o relatório de campanhas (Importação › Publicidade) ou conecte o Product Ads.</Pending>}</Card>
      <Card title="Campanhas" subtitle={d.data.avg_product_margin_pct !== null ? `Margem após ads estimada com a margem média dos produtos (${pct(d.data.avg_product_margin_pct)})` : "Margem após ads requer custos cadastrados"}>
        <Table rows={d.data.campaigns} rowKey={(r: any) => r.id} empty={<Pending title="Nenhuma campanha" />} cols={[
          { key: "name", header: "Campanha", render: (r: any) => <div><div className="font-medium">{r.name}</div><div className="text-[10px] text-ink-3">{r.source}</div></div> },
          { key: "prints", header: "Impressões", align: "right", render: (r: any) => int(r.prints) },
          { key: "clicks", header: "Cliques", align: "right", render: (r: any) => int(r.clicks) },
          { key: "cpc", header: "CPC", align: "right", render: (r: any) => brl(r.cpc) },
          { key: "cost", header: "Investimento", align: "right", render: (r: any) => brl(r.cost) },
          { key: "rev", header: "Receita", align: "right", render: (r: any) => brl(r.total_amount) },
          { key: "acos", header: "ACOS", align: "right", render: (r: any) => <span className={r.acos_pct > 35 ? "text-bad" : ""}>{pct(r.acos_pct)}</span> },
          { key: "roas", header: "ROAS", align: "right", render: (r: any) => (r.roas === null ? "—" : `${r.roas.toFixed(2)}x`) },
          { key: "m", header: "Margem após ads", align: "right", render: (r: any) => (r.margin_after_ads === null ? "—" : <span className={r.margin_after_ads < 0 ? "text-bad" : "text-good"}>{brl(r.margin_after_ads)}</span>) },
        ]} />
      </Card>
    </div>
  );
}
