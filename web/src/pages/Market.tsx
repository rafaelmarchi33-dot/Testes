import { useState } from "react";
import { Telescope, Search, Sparkles, ExternalLink, Info } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, PageHeader, Spinner, ErrorBox, Badge, Empty, Button, Input, Notice, Tabs, Thumb, Textarea, Select, Table } from "../components/ui.tsx";
import { brl, int, pct, dateTime } from "../lib/format.ts";
import { useUser, canOperate } from "../components/Layout.tsx";

const potTone = (p: string) => (p === "alto" ? "good" : p === "médio" ? "warn" : "neutral") as any;
const difTone = (d: string) => (d === "baixa" ? "good" : d === "média" ? "warn" : "bad") as any;

function Opportunities() {
  const user = useUser();
  const { data, error, loading, reload } = useApi<any[]>("/market/opportunities");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [ctx, setCtx] = useState("Loja de produtos fabricados por impressão 3D (FDM), produção própria.");
  const [open, setOpen] = useState<number | null>(null);
  const discover = async () => {
    setErr(null);
    try {
      setBusy("Pesquisando o mercado de impressão 3D (12 buscas)…");
      const r = await api("/market/discover", { body: {} });
      setBusy("A IA está avaliando as oportunidades…");
      await api("/market/opportunities", { body: { research_ids: r.research_ids, context: ctx } });
      await reload();
    } catch (e) { setErr(e as Error); } finally { setBusy(null); }
  };
  const rows = (data ?? []).filter((o) => o.status !== "discarded");
  return (
    <div className="space-y-6">
      {canOperate(user) && (
        <Card title="Descobrir oportunidades" subtitle="Pesquisa produtos populares de impressão 3D no Mercado Livre e pede à IA uma análise com custos e margens estimados.">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Textarea value={ctx} onChange={(e) => setCtx(e.target.value)} className="min-h-14 flex-1" aria-label="Contexto da loja" />
            <Button variant="primary" icon={<Sparkles className="size-4" />} loading={!!busy} onClick={discover}>Descobrir</Button>
          </div>
          {busy && <p className="mt-2 text-xs text-ink-3">{busy}</p>}
          <ErrorBox error={err} />
        </Card>
      )}
      <Notice title="Sobre os números:">Preços e concorrentes vêm de dados públicos do Mercado Livre. Quantidade de anúncios, avaliações e vendidos visíveis <b>não</b> representam a demanda completa. Custos de fabricação e margens são <b>estimativas</b> e estão identificados como tal.</Notice>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : !rows.length ? <Card><Empty icon={<Telescope className="size-5" />} title="Nenhuma oportunidade ainda">Use "Descobrir" ou faça pesquisas na aba Pesquisa e gere oportunidades a partir delas.</Empty></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((o) => (
            <Card key={o.id} pad className="flex flex-col">
              <div className="flex gap-3">
                <Thumb src={o.image} size={64} />
                <div className="min-w-0">
                  <h3 className="font-semibold leading-snug">{o.name}</h3>
                  <p className="text-[11px] text-ink-3">{o.category_name ?? "Categoria não identificada"}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1"><Badge tone={potTone(o.potential)}>potencial {o.potential}</Badge><Badge tone={difTone(o.difficulty)}>produção {o.difficulty}</Badge></div>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <dt className="text-ink-3">Faixa de preço</dt><dd className="text-right num">{brl(o.price_min)} – {brl(o.price_max)}</dd>
                <dt className="text-ink-3">Preço mediano</dt><dd className="text-right num font-medium">{brl(o.price_median)}</dd>
                <dt className="text-ink-3">Concorrência</dt><dd className="text-right num">{int(o.competitors)} vendedores</dd>
                <dt className="text-ink-3">Vendidos visíveis</dt><dd className="text-right num">{o.sold_signal === null ? "não informado" : int(o.sold_signal)}</dd>
                <dt className="text-ink-3">Custo estimado <Badge>estimativa</Badge></dt><dd className="text-right num">{brl(o.est_cost)}</dd>
                <dt className="text-ink-3">Margem potencial <Badge>estimativa</Badge></dt><dd className="text-right num font-medium">{pct(o.margin_pct)}</dd>
              </dl>
              <p className="mt-3 text-xs text-ink-2"><b>Demanda:</b> {o.demand_note}</p>
              {open === o.id && (
                <div className="mt-3 space-y-2 border-t border-line pt-3 text-xs text-ink-2">
                  <p className="whitespace-pre-line">{o.rationale}</p>
                  {o.evidence?.cost_assumptions && <p><b>Premissas de custo:</b> {o.evidence.cost_assumptions}</p>}
                  {o.evidence?.margin_note && <p className="text-ink-3">{o.evidence.margin_note}</p>}
                  {o.evidence?.limitations?.map((l: string) => <p key={l} className="text-ink-3">⚠ {l}</p>)}
                  <p className="text-ink-3">Pesquisa: "{o.evidence?.query}" · {dateTime(o.created_at)}</p>
                </div>
              )}
              <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                <button className="flex items-center gap-1 text-xs text-brand hover:underline" onClick={() => setOpen(open === o.id ? null : o.id)}><Info className="size-3" />{open === o.id ? "Ocultar análise" : "Ver análise e evidências"}</button>
                {canOperate(user) && (
                  <Select value={o.status} onChange={async (e) => { await api(`/market/opportunities/${o.id}`, { method: "PATCH", body: { status: e.target.value } }); reload(); }} className="h-8 w-32 text-xs">
                    <option value="new">Nova</option><option value="watching">Acompanhar</option><option value="planned">Vou produzir</option><option value="discarded">Descartar</option>
                  </Select>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Research() {
  const user = useUser();
  const list = useApi<any[]>("/market/research");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const run = async () => {
    setBusy(true); setErr(null);
    try { const r = await api("/market/research", { body: { query } }); await list.reload(); setSel(r.id); } catch (e) { setErr(e as Error); } finally { setBusy(false); }
  };
  const current = list.data?.find((r) => r.id === sel) ?? list.data?.[0];
  return (
    <div className="space-y-6">
      {canOperate(user) && (
        <Card>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar produto no Mercado Livre, ex.: suporte headset 3d" />
            <Button variant="primary" icon={<Search className="size-4" />} loading={busy} disabled={query.trim().length < 2}>Pesquisar</Button>
          </form>
          <ErrorBox error={err} />
        </Card>
      )}
      <ErrorBox error={list.error} />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card title="Pesquisas" pad={false}>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {!list.data?.length && <Empty title="Nenhuma pesquisa" />}
            {list.data?.map((r) => (
              <button key={r.id} onClick={() => setSel(r.id)} className={`w-full rounded-lg p-2 text-left text-xs hover:bg-surface-2 ${current?.id === r.id ? "bg-brand-soft" : ""}`}>
                <div className="font-medium">{r.query}</div><div className="text-ink-3">{r.stats?.count ?? 0} anúncios · {dateTime(r.created_at)}</div>
              </button>
            ))}
          </div>
        </Card>
        {current && (
          <div className="space-y-4">
            <Card title={`"${current.query}"`} subtitle={`${current.category?.name ?? "categoria não identificada"} · fonte: ${current.source} · ${current.total_results !== null ? `${int(current.total_results)} resultados` : ""}`}
              action={canOperate(user) && <Button size="sm" icon={<Sparkles className="size-3.5" />} loading={genBusy} onClick={async () => { setGenBusy(true); setErr(null); try { await api("/market/opportunities", { body: { research_ids: [current.id] } }); } catch (e) { setErr(e as Error); } finally { setGenBusy(false); } }}>Gerar oportunidades</Button>}>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><div className="text-[11px] text-ink-3">Preço mín. – máx.</div><div className="num font-medium">{brl(current.stats?.price_min)} – {brl(current.stats?.price_max)}</div></div>
                <div><div className="text-[11px] text-ink-3">Mediana (P25–P75)</div><div className="num font-medium">{brl(current.stats?.price_median)} <span className="text-ink-3 text-xs">({brl(current.stats?.price_p25)}–{brl(current.stats?.price_p75)})</span></div></div>
                <div><div className="text-[11px] text-ink-3">Vendedores / lojas oficiais</div><div className="num font-medium">{int(current.stats?.sellers)} / {int(current.stats?.official_stores)}</div></div>
                <div><div className="text-[11px] text-ink-3">Frete grátis</div><div className="num font-medium">{pct(current.stats?.free_shipping_pct, 0)}</div></div>
              </div>
              {current.trends?.length > 0 && <div className="mt-4 flex flex-wrap gap-1"><span className="text-[11px] text-ink-3 mr-1">Buscas em alta na categoria:</span>{current.trends.map((t: string) => <Badge key={t} tone="brand">{t}</Badge>)}</div>}
              {current.limitations?.map((l: string) => <div key={l} className="mt-3"><Notice tone="warn">{l}</Notice></div>)}
            </Card>
            <Card title="Concorrentes encontrados">
              <Table rows={current.items ?? []} rowKey={(r: any) => r.id}
                cols={[
                  { key: "title", header: "Anúncio", render: (r: any) => <div className="flex items-center gap-2"><Thumb src={r.thumbnail} size={32} /><span className="max-w-[320px] truncate">{r.title}</span>{r.permalink && <a href={r.permalink} target="_blank" rel="noreferrer" aria-label="Abrir"><ExternalLink className="size-3 text-ink-3" /></a>}</div> },
                  { key: "price", header: "Preço", align: "right", render: (r: any) => brl(r.price) },
                  { key: "sold", header: "Vendidos", align: "right", render: (r: any) => (r.sold_quantity === null ? "—" : int(r.sold_quantity)) },
                  { key: "reviews", header: "Avaliações", align: "right", render: (r: any) => (r.reviews_total == null ? "—" : `${int(r.reviews_total)}${r.rating ? ` · ${r.rating.toFixed(1)}★` : ""}`) },
                  { key: "flags", header: "", render: (r: any) => <div className="flex gap-1">{r.official_store && <Badge tone="info">loja oficial</Badge>}{r.free_shipping && <Badge>frete grátis</Badge>}</div> },
                ]} />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Market() {
  const [tab, setTab] = useState<"opps" | "research">("opps");
  return (
    <>
      <PageHeader title="Oportunidades de mercado" subtitle="Inteligência de mercado e concorrência com dados oficiais do Mercado Livre, com foco em produtos de impressão 3D."
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: "opps", label: "Oportunidades" }, { value: "research", label: "Pesquisa e concorrência" }]} />} />
      {tab === "opps" ? <Opportunities /> : <Research />}
    </>
  );
}
