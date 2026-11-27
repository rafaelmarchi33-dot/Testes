import { useState } from "react";
import { useNavigate } from "react-router";
import { Radar as RadarIcon, Globe, Store, Plus, FlaskConical, ExternalLink, Trash2 } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, PageHeader, Button, Input, Select, Field, NumInput, Textarea, ErrorBox, Spinner, Badge, Modal, Pending, ConfirmDialog, useToast, Notice, Thumb, cx } from "../components/ui.tsx";
import { brl, pct, dateTime } from "../lib/format.ts";

const empty = { name: "", category_name: "", links: "", competitor_prices: "", sold_signal: null as number | null, reviews: null as number | null, sellers: null as number | null, demand_note: "", demand_level: "", competition_level: "", differentiation: "", difficulty: "", weight_g: null as number | null, print_minutes: null as number | null, material: "PLA", fragile: false, rationale: "" };

export default function Radar() {
  const d = useApi<any>("/radar");
  const nav = useNavigate();
  const { toast, node } = useToast();
  const [cat, setCat] = useState("");
  const [term, setTerm] = useState("");
  const [ctx, setCtx] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [form, setForm] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const [filter, setFilter] = useState("all");
  const src = d.data?.sources;
  const items = (d.data?.items ?? []).filter((o: any) => filter === "all" || o.category_name === filter || o.status === filter);

  const run = async (kind: "ml" | "web") => {
    setBusy(kind); setErr(null);
    try {
      if (kind === "ml") await api("/radar/research/ml", { body: { term, category: cat || null } });
      else { const r = await api("/radar/research/web", { body: { category: cat, context: ctx } }); toast(`${r.created} candidato(s) encontrados em ${r.sources} fonte(s)`); }
      d.reload();
    } catch (e) { setErr(e as Error); } finally { setBusy(null); }
  };
  const save = async () => {
    const body = {
      ...form, links: String(form.links).split(/\s+/).filter(Boolean), competitor_prices: String(form.competitor_prices).split(/[;\s]+/).map((x: string) => Number(x.replace(",", "."))).filter((n: number) => n > 0),
      demand_level: form.demand_level || null, competition_level: form.competition_level || null, differentiation: form.differentiation || null, difficulty: form.difficulty || null,
    };
    try { if (form.id) await api(`/radar/${form.id}`, { method: "PUT", body }); else await api("/radar", { body }); setForm(null); d.reload(); toast("Oportunidade salva e pontuada"); } catch (e) { toast((e as Error).message, "bad"); }
  };
  const toLab = async (o: any) => { try { const r = await api(`/radar/${o.id}/to-lab`, { body: {} }); toast("Enviado ao Laboratório"); nav(`/laboratorio?id=${r.lab_product_id}`); } catch (e) { toast((e as Error).message, "bad"); } };
  const edit = (o: any) => setForm({ ...empty, ...o, links: (o.links ?? []).join("\n"), competitor_prices: (o.competitor_prices ?? []).join("; "), sold_signal: o.observed?.sold_signal ?? null, reviews: o.observed?.reviews ?? null, sellers: o.observed?.sellers ?? null,
    demand_level: o.evidence?.demand_level ?? "", competition_level: o.evidence?.competition_level ?? "", differentiation: o.estimates?.differentiation ?? "", difficulty: o.difficulty ?? "", material: o.estimates?.material ?? "PLA", fragile: !!o.evidence?.fragile });

  return (
    <>
      {node}
      <PageHeader title="Radar de produtos 3D" subtitle="Pesquisa de oportunidades fabricáveis em impressão 3D com boa margem — evidências observadas separadas de estimativas"
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ ...empty })}>Cadastrar oportunidade</Button>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Pesquisar oportunidades">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoria"><Select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Selecione…</option>{(d.data?.categories ?? []).map((c: string) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Termo de busca (Mercado Livre)"><Input placeholder="ex.: suporte headset mesa" value={term} onChange={(e) => setTerm(e.target.value)} /></Field>
            <Field label="Contexto para pesquisa web (opcional)" className="sm:col-span-2"><Input placeholder="ex.: foco em acessórios para microfones sem fio" value={ctx} onChange={(e) => setCtx(e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button icon={<Store className="size-4" />} loading={busy === "ml"} disabled={!term || !src?.mercadolivre} onClick={() => run("ml")}>Pesquisar no Mercado Livre</Button>
            <Button icon={<Globe className="size-4" />} loading={busy === "web"} disabled={!cat || !src?.web_research} onClick={() => run("web")}>Pesquisa web com IA (fontes públicas)</Button>
          </div>
          <ErrorBox error={err} />
        </Card>
        <Card title="Fontes de pesquisa">
          <ul className="space-y-2 text-xs">
            {[["Mercado Livre (API oficial)", src?.mercadolivre, "busca, preços, vendedores, vendidos visíveis, tendências"], ["Pesquisa web via IA", src?.web_research, "Shopee, marketplaces, blogs, tendências públicas — com links"], ["Google Trends", src?.google_trends, "sem API pública oficial: não integrado"]].map(([l, ok, t]) => (
              <li key={l as string} className="flex items-start gap-2"><span className={cx("mt-1 size-2 shrink-0 rounded-full", ok ? "bg-good" : "bg-ink-3")} /><div><b>{l}</b> — {ok ? "disponível" : "indisponível"}<div className="text-ink-3">{t}</div></div></li>
            ))}
          </ul>
          <Notice>Nota 0–100: demanda 25, margem 25, fabricação 15, concorrência 15, diferenciação 10, logística 10. Sem evidência, o critério recebe 0 — nada é presumido.</Notice>
        </Card>
      </div>

      <div className="mb-3 mt-6 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Ranking de oportunidades</span>
        <Select className="ml-auto w-48" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Todas</option><option value="new">Novas</option><option value="watching">Acompanhando</option><option value="planned">No laboratório</option><option value="discarded">Descartadas</option>
          {(d.data?.categories ?? []).map((c: string) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
      {d.loading && !d.data ? <Spinner /> : items.length === 0 ? <Card><Pending title="Nenhuma oportunidade">Pesquise por categoria ou cadastre manualmente com as evidências que você observou.</Pending></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((o: any) => (
            <Card key={o.id} className={cx(o.status === "discarded" && "opacity-60")}>
              <div className="flex gap-3">
                <Thumb src={o.image} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2"><div className="font-semibold leading-tight">{o.name}</div>
                    <div className={cx("grid size-11 shrink-0 place-items-center rounded-full border-2 text-sm font-bold num", (o.score ?? 0) >= 70 ? "border-brand text-brand" : (o.score ?? 0) >= 45 ? "border-warn text-warn" : "border-line text-ink-3")}>{o.score === null ? "—" : Math.round(o.score)}</div></div>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[11px]"><Badge>{o.category_name ?? "sem categoria"}</Badge><Badge tone="info">{o.source === "ml_research" ? "Mercado Livre" : o.source === "web_research" ? "Pesquisa web" : "Manual"}</Badge>{o.status === "planned" && <Badge tone="brand">no laboratório</Badge>}</div>
                </div>
              </div>
              {o.scores && <div className="mt-3 space-y-1">{o.scores.parts.map((p: any) => (
                <div key={p.key} className="grid grid-cols-[96px_1fr_42px] items-center gap-2 text-[11px]" title={p.basis}>
                  <span className="truncate text-ink-3">{p.label}</span><div className="h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${(p.points / p.max) * 100}%` }} /></div><span className="text-right num">{p.points}/{p.max}</span>
                </div>))}</div>}
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-md bg-surface-2 p-2"><div className="font-semibold text-good">Observado</div>
                  <div>Preços: {o.observed?.price_min ? `${brl(o.observed.price_min)} – ${brl(o.observed.price_max)} (mediana ${brl(o.observed.price_median)})` : "—"}</div>
                  <div>Vendidos visíveis: {o.observed?.sold_signal ?? "—"} · Vendedores: {o.observed?.sellers ?? "—"}</div>
                  <div className="line-clamp-2 text-ink-3">{o.demand_note ?? "Sem evidência de demanda registrada"}</div></div>
                <div className="rounded-md bg-surface-2 p-2"><div className="font-semibold text-warn">Estimativa</div>
                  <div>Peso: {o.weight_g ? `${Math.round(o.weight_g)} g` : "—"} · Tempo: {o.print_minutes ? `${Math.round(o.print_minutes)} min` : "—"}</div>
                  <div>Custo: {brl(o.est_cost)} · Margem: {pct(o.margin_pct)}</div>
                  <div>Dificuldade: {o.difficulty ?? "—"}</div>
                  {o.estimates?.missing_for_margin?.length > 0 && <div className="text-ink-3">margem requer: {o.estimates.missing_for_margin.slice(0, 2).join(", ")}</div>}</div>
              </div>
              {o.links?.length > 0 && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">{o.links.slice(0, 4).map((l: string) => <a key={l} href={l} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-[45%] items-center gap-1 truncate text-brand hover:underline"><ExternalLink className="size-3 shrink-0" />{new URL(l).hostname}</a>)}</div>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" icon={<FlaskConical className="size-3.5" />} onClick={() => toLab(o)} disabled={o.status === "planned"}>Adicionar ao laboratório de produtos</Button>
                <Button size="sm" onClick={() => edit(o)}>Editar / avaliar</Button>
                <Select className="h-8 w-32 text-xs" value={o.status} onChange={async (e) => { await api(`/radar/${o.id}/status`, { method: "PATCH", body: { status: e.target.value } }); d.reload(); }}>
                  <option value="new">Nova</option><option value="watching">Acompanhando</option><option value="planned">No laboratório</option><option value="discarded">Descartada</option></Select>
                <button aria-label="Excluir" className="ml-auto text-ink-3 hover:text-bad" onClick={() => setDel(o)}><Trash2 className="size-4" /></button>
              </div>
              <div className="mt-2 text-[10px] text-ink-3">{dateTime(o.created_at)}</div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Avaliar oportunidade" : "Nova oportunidade"} wide footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" disabled={!form?.name} onClick={save}>Salvar e pontuar</Button></>}>
        {form && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome do produto"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Categoria"><Select value={form.category_name ?? ""} onChange={(e) => setForm({ ...form, category_name: e.target.value })}><option value="">—</option>{(d.data?.categories ?? []).map((c: string) => <option key={c}>{c}</option>)}</Select></Field>
            </div>
            <div className="rounded-lg border border-good/30 p-3"><div className="mb-2 text-xs font-semibold text-good">Dados observados (informe só o que você viu)</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Preços dos concorrentes (R$, separados por ;)" className="sm:col-span-3"><Input value={form.competitor_prices} onChange={(e) => setForm({ ...form, competitor_prices: e.target.value })} placeholder="39,90; 49,90; 59" /></Field>
                <Field label="Links dos anúncios (um por linha)" className="sm:col-span-3"><Textarea className="min-h-16" value={form.links} onChange={(e) => setForm({ ...form, links: e.target.value })} /></Field>
                <Field label="Vendidos visíveis (soma)"><NumInput value={form.sold_signal} onChange={(v) => setForm({ ...form, sold_signal: v })} /></Field>
                <Field label="Avaliações (soma)"><NumInput value={form.reviews} onChange={(v) => setForm({ ...form, reviews: v })} /></Field>
                <Field label="Nº de vendedores"><NumInput value={form.sellers} onChange={(v) => setForm({ ...form, sellers: v })} /></Field>
                <Field label="Evidência de demanda" className="sm:col-span-2"><Input value={form.demand_note ?? ""} onChange={(e) => setForm({ ...form, demand_note: e.target.value })} placeholder="ex.: 'Mais vendido' na categoria em 26/11" /></Field>
                <Field label="Força da evidência"><Select value={form.demand_level} onChange={(e) => setForm({ ...form, demand_level: e.target.value })}><option value="">—</option><option>forte</option><option>média</option><option>fraca</option><option>sem evidência</option></Select></Field>
              </div></div>
            <div className="rounded-lg border border-warn/30 p-3"><div className="mb-2 text-xs font-semibold text-warn">Estimativas e avaliação</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Peso estimado (g)"><NumInput value={form.weight_g} onChange={(v) => setForm({ ...form, weight_g: v })} /></Field>
                <Field label="Tempo de impressão (min)"><NumInput value={form.print_minutes} onChange={(v) => setForm({ ...form, print_minutes: v })} /></Field>
                <Field label="Material"><Select value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })}><option>PLA</option><option>PETG</option></Select></Field>
                <Field label="Dificuldade"><Select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}><option value="">—</option><option>baixa</option><option>média</option><option>alta</option></Select></Field>
                <Field label="Concorrência (se não houver nº de vendedores)"><Select value={form.competition_level} onChange={(e) => setForm({ ...form, competition_level: e.target.value })}><option value="">—</option><option>baixa</option><option>média</option><option>alta</option></Select></Field>
                <Field label="Diferenciação possível"><Select value={form.differentiation} onChange={(e) => setForm({ ...form, differentiation: e.target.value })}><option value="">—</option><option>alta</option><option>média</option><option>baixa</option></Select></Field>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.fragile} onChange={(e) => setForm({ ...form, fragile: e.target.checked })} /> Produto frágil (logística)</label>
                <Field label="Observações" className="sm:col-span-3"><Textarea className="min-h-16" value={form.rationale ?? ""} onChange={(e) => setForm({ ...form, rationale: e.target.value })} /></Field>
              </div></div>
            <Notice>Margem potencial = preço mediano observado − custo variável calculado com a sua configuração de custos e tarifas (Financeiro). Sem configuração, a margem fica pendente.</Notice>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title="Excluir oportunidade" confirmLabel="Excluir" onConfirm={async () => { await api(`/radar/${del.id}`, { method: "DELETE", body: { confirm: true } }); d.reload(); }}>
        Excluir “{del?.name}” do radar? Esta ação não pode ser desfeita.
      </ConfirmDialog>
    </>
  );
}

void RadarIcon;
