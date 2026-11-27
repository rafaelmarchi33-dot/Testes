import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Store, PlugZap, CheckCircle2, AlertTriangle, Clock, KeyRound, ExternalLink, Search } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { useGlobal } from "../lib/global.tsx";
import { useUser, canOperate } from "../components/Layout.tsx";
import { Card, PageHeader, Spinner, ErrorBox, Table, Thumb, Badge, Button, Input, Select, Tabs, Modal, Pending, SourceTag, ExportButtons, NumInput, Field, ConfirmDialog, useToast, Notice } from "../components/ui.tsx";
import { SmallLine } from "../components/charts.tsx";
import { brl, int, pct, dateTime, relative, LISTING_STATUS } from "../lib/format.ts";

const CLASS_TONE: Record<string, any> = { campeao: "good", oportunidade: "info", escalavel: "brand", subperformer: "neutral", critico: "bad", sem_dados: "neutral" };
const STATE: Record<string, { label: string; tone: any; icon: any; text: string }> = {
  not_configured: { label: "Não configurado", tone: "neutral", icon: KeyRound, text: "Defina ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI nas variáveis de ambiente do servidor." },
  not_connected: { label: "Não conectado", tone: "neutral", icon: PlugZap, text: "Credenciais configuradas. Conecte a conta da loja pelo OAuth oficial." },
  awaiting_authorization: { label: "Aguardando autorização", tone: "warn", icon: Clock, text: "Fluxo OAuth iniciado. Conclua a autorização na página do Mercado Livre." },
  connected: { label: "Conectado", tone: "good", icon: CheckCircle2, text: "Tokens criptografados no servidor e renovados automaticamente." },
  auth_error: { label: "Erro de autenticação", tone: "bad", icon: AlertTriangle, text: "A autorização foi recusada ou revogada. Reconecte a conta." },
  token_expired: { label: "Token expirado", tone: "bad", icon: AlertTriangle, text: "Não foi possível renovar o token. Reconecte a conta." },
};

export default function Seller() {
  const g = useGlobal();
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<"central" | "ranking" | "conexao">("central");
  const [search, setSearch] = useState("");
  const [cls, setCls] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "revenue_period", dir: -1 });
  const [page, setPage] = useState(0);
  const days = g.period.period === "7d" ? 7 : g.period.period === "90d" ? 90 : g.period.period === "today" ? 1 : 30;
  const center = useApi<any>(`/listings-center?days=${days}&channel=${g.channel}&status=${status}&search=${encodeURIComponent(search)}`);
  const ml = useApi<any>("/ml/status");
  const openId = params.get("id");

  const rows = useMemo(() => {
    const r = (center.data?.rows ?? []).filter((l: any) => cls === "all" || l.class === cls);
    return [...r].sort((a: any, b: any) => ((a[sort.key] ?? -Infinity) > (b[sort.key] ?? -Infinity) ? 1 : -1) * sort.dir);
  }, [center.data, cls, sort]);
  useEffect(() => setPage(0), [cls, search, status]);
  const PER = 25;
  const sortH = (key: string, label: string) => (
    <button className="uppercase hover:text-ink" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}>{label}{sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}</button>
  );
  const st = STATE[ml.data?.state ?? "not_connected"]!;

  const cols = [
    { key: "img", header: "", render: (l: any) => <Thumb src={l.thumbnail} /> },
    { key: "title", header: sortH("title", "Título"), render: (l: any) => <div className="max-w-[300px]"><div className="truncate font-medium">{l.title}</div><div className="flex gap-1.5 text-[11px] text-ink-3"><span className="font-mono">{l.id}</span>{l.source !== "api" && <SourceTag kind={l.source} />}</div></div> },
    { key: "sku", header: "SKU", render: (l: any) => <span className="font-mono text-xs">{l.sku ?? "—"}</span> },
    { key: "price", header: sortH("price", "Preço"), align: "right" as const, render: (l: any) => <>{brl(l.price)}{l.original_price > l.price && <div className="text-[10px] text-ink-3 line-through">{brl(l.original_price)}</div>}</> },
    { key: "stock", header: sortH("available_quantity", "Estoque"), align: "right" as const, render: (l: any) => int(l.available_quantity) },
    { key: "visits", header: sortH("visits", "Visitas"), align: "right" as const, render: (l: any) => int(l.visits) },
    { key: "sales", header: sortH("units_period", "Vendas"), align: "right" as const, render: (l: any) => int(l.units_period) },
    { key: "conv", header: sortH("conversion_pct", "Conversão"), align: "right" as const, render: (l: any) => pct(l.conversion_pct) },
    { key: "q", header: sortH("quality_score", "Qualidade"), align: "right" as const, render: (l: any) => (l.quality_score ?? (l.health !== null ? Math.round(l.health * 100) : null)) ?? "—" },
    { key: "st", header: "Situação", render: (l: any) => <div><Badge tone={l.status === "active" ? "good" : "neutral"}>{LISTING_STATUS[l.status] ?? l.status}</Badge>{l.competition_status && <div className="mt-0.5 max-w-[140px] truncate text-[10px] text-ink-3" title={l.competition_status}>{l.competition_status}</div>}</div> },
    { key: "margin", header: sortH("margin_pct", "Margem"), align: "right" as const, render: (l: any) => (l.margin_pct === null ? <span className="text-[11px] text-ink-3" title={l.unit_missing.join(", ")}>pendente</span> : <span className={l.margin_pct < 0 ? "text-bad" : ""}>{pct(l.margin_pct)}</span>) },
    { key: "profit", header: sortH("unit_profit", "Lucro/un."), align: "right" as const, render: (l: any) => (l.unit_profit === null ? "—" : brl(l.unit_profit)) },
    { key: "class", header: "Classe", render: (l: any) => <Badge tone={CLASS_TONE[l.class]}>{l.class_label}</Badge> },
  ];

  return (
    <>
      <PageHeader title="Mercado Livre Seller" subtitle="Central de anúncios, classificação de desempenho, ranking de prioridades e conexão oficial"
        actions={<><Badge tone={st.tone}><st.icon className="size-3" /> {st.label}</Badge><ExportButtons path={`/listings-center/export?days=${days}&channel=${g.channel}${tab === "ranking" ? "&list=priority" : ""}`} /></>} />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[{ value: "central", label: "Central de anúncios" }, { value: "ranking", label: "Ranking — 20 prioritários" }, { value: "conexao", label: "Conexão e sincronização" }]} /></div>
      <ErrorBox error={center.error} onRetry={center.reload} />

      {tab !== "conexao" && center.data && (
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {[["campeao", "Campeões"], ["oportunidade", "Oportunidades"], ["escalavel", "Escaláveis"], ["subperformer", "Subperformers"], ["critico", "Críticos"], ["sem_dados", "Sem dados"]].map(([k, l]) => (
            <button key={k} onClick={() => { setCls(cls === k ? "all" : k); setTab("central"); }} className={`rounded-xl border p-3 text-left transition ${cls === k ? "border-brand/60 bg-brand-soft" : "border-line bg-surface hover:border-brand/30"}`}>
              <div className="text-lg font-semibold num">{center.data.counts[k] ?? 0}</div><div className="text-[11px] text-ink-3">{l}</div>
            </button>
          ))}
        </div>
      )}

      {tab === "central" && (
        <Card pad={false}>
          <div className="grid gap-2 border-b border-line p-4 sm:grid-cols-[1fr_170px_180px] sm:items-center">
            <div className="relative"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" /><Input className="w-full pl-8" placeholder="Título, SKU ou ID…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Todas situações</option><option value="active">Ativos</option><option value="paused">Pausados</option><option value="closed">Encerrados</option></Select>
            <Select value={cls} onChange={(e) => setCls(e.target.value)}><option value="all">Todas classes</option><option value="campeao">Campeões</option><option value="oportunidade">Oportunidades</option><option value="escalavel">Escaláveis</option><option value="subperformer">Subperformers</option><option value="critico">Críticos</option><option value="sem_dados">Sem dados</option></Select>
            <span className="text-xs text-ink-3 sm:col-span-3">{rows.length} anúncio(s) · conversão da loja {pct(center.data?.store_conversion_pct)} · últimos {days} dias</span>
          </div>
          <div className="p-5">
            {center.loading && !center.data ? <Spinner /> : (
              <Table rows={rows.slice(page * PER, page * PER + PER)} cols={cols} rowKey={(l: any) => l.id} onRowClick={(l: any) => setParams({ id: l.id })}
                empty={<Pending title="Nenhum anúncio">Conecte o Mercado Livre ou importe a lista de anúncios (Importação › Anúncios).</Pending>} />
            )}
            {rows.length > PER && (
              <div className="mt-3 flex items-center justify-end gap-2 text-xs">
                <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
                <span className="text-ink-3">Página {page + 1} de {Math.ceil(rows.length / PER)}</span>
                <Button size="sm" disabled={(page + 1) * PER >= rows.length} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === "ranking" && center.data && (
        <Card title="Ranking dos 20 anúncios prioritários" subtitle="Pontuação = receita em jogo + vendas perdidas por conversão abaixo da loja + urgência (críticos) + potencial (escaláveis)">
          {center.data.priority.length === 0 ? <Pending>Sem anúncios ativos.</Pending> : (
            <ol className="space-y-2">
              {center.data.priority.map((l: any, i: number) => (
                <li key={l.id} onClick={() => setParams({ id: l.id })} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-3 hover:border-brand/40">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold num">{i + 1}</span>
                  <Thumb src={l.thumbnail} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{l.title}</div><div className="truncate text-[11px] text-ink-3">{l.reasons.join(" · ")}</div></div>
                  <Badge tone={CLASS_TONE[l.class]}>{l.class_label}</Badge>
                  <span className="hidden text-xs text-ink-3 num sm:block">{l.priority_score} pts</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {tab === "conexao" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Status da integração oficial (OAuth 2.0 + PKCE)">
            {ml.loading && !ml.data ? <Spinner /> : ml.data && (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3 rounded-lg border border-line p-3"><st.icon className={`size-5 ${({ good: "text-good", bad: "text-bad", warn: "text-warn", neutral: "text-ink-3" } as Record<string, string>)[st.tone]}`} /><div><div className="font-semibold">{st.label}</div><div className="text-xs text-ink-3">{st.text}</div></div></div>
                {ml.data.account && <div className="text-xs text-ink-2">Conta <b>{ml.data.account.nickname}</b> (ID {ml.data.account.id}) · conectada em {dateTime(ml.data.account.connected_at)} · token de acesso válido até {dateTime(ml.data.account.access_token_expires_at)}{ml.data.account.last_error && <div className="mt-1 text-bad">Último erro: {ml.data.account.last_error}</div>}</div>}
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  {[["Client ID", ml.data.configured.client_id], ["Client Secret", ml.data.configured.client_secret], ["Redirect URI", !!ml.data.configured.redirect_uri]].map(([l, ok]) => <div key={l as string} className="rounded-md bg-surface-2 p-2"><div className="text-ink-3">{l}</div><div className={ok ? "text-good" : "text-bad"}>{ok ? "configurado" : "ausente"}</div></div>)}
                </div>
                <Link to="/integracoes"><Button variant="primary" size="sm">{ml.data.state === "connected" ? "Gerenciar conexão" : "Conectar / reconectar"}</Button></Link>
                <Notice>Tokens ficam somente no servidor, criptografados (AES-256-GCM). O frontend nunca recebe credenciais. Renovação automática, paginação, limite de requisições e logs ficam no backend.</Notice>
              </div>
            )}
          </Card>
          <Card title="Sincronização por recurso">
            {(ml.data?.sync ?? []).length === 0 ? <Pending>Nenhuma sincronização executada.</Pending> : (
              <Table rows={ml.data.sync} rowKey={(r: any) => r.resource} cols={[
                { key: "resource", header: "Recurso" },
                { key: "status", header: "Status", render: (r: any) => <Badge tone={r.status === "ok" ? "good" : r.status === "error" ? "bad" : "neutral"}>{r.status}</Badge> },
                { key: "last", header: "Último sucesso", render: (r: any) => relative(r.last_success_at) },
                { key: "processed", header: "Itens", align: "right", render: (r: any) => int(r.processed) },
              ]} />
            )}
            {(ml.data?.recent_api_errors ?? []).length > 0 && (
              <div className="mt-4"><div className="mb-1 text-xs font-semibold">Erros recentes da API</div>
                {ml.data.recent_api_errors.map((e: any, i: number) => <div key={i} className="truncate text-[11px] text-ink-3">{dateTime(e.at)} · {e.status} · {e.path} {e.error}</div>)}</div>
            )}
          </Card>
          <Card title="Outras integrações" className="lg:col-span-2">
            <div className="grid gap-2 sm:grid-cols-2">
              {(ml.data?.other_integrations ?? []).map((o: any) => <div key={o.name} className="rounded-lg border border-line p-3 text-xs"><div className="flex items-center justify-between"><b className="text-sm">{o.name}</b><Badge>Não integrado</Badge></div><p className="mt-1 text-ink-3">{o.note}</p></div>)}
              <div className="rounded-lg border border-line p-3 text-xs"><div className="flex items-center justify-between"><b className="text-sm">Inteligência artificial</b><Badge tone={ml.data?.ai.configured ? "good" : "neutral"}>{ml.data?.ai.configured ? "Configurada" : "Não configurada"}</Badge></div><p className="mt-1 text-ink-3">{ml.data?.ai.configured ? `Modelo ${ml.data.ai.model}, chamado apenas pelo backend.` : "Defina ANTHROPIC_API_KEY no servidor para habilitar o Mind AI."}</p></div>
            </div>
          </Card>
        </div>
      )}

      <ListingModal id={openId} onClose={() => setParams({})} canEdit={canOperate(user)} onSaved={center.reload} />
    </>
  );
}

function ListingModal({ id, onClose, canEdit, onSaved }: { id: string | null; onClose: () => void; canEdit: boolean; onSaved: () => void }) {
  const d = useApi<any>(id ? `/listings-center/${encodeURIComponent(id)}` : null, [id]);
  const [fees, setFees] = useState<any>({ fee_pct: null, fixed_fee: null, shipping_cost: null, ads_pct: null });
  const [specs, setSpecs] = useState<any>({ weight_g: null, print_minutes: null, material: "PLA" });
  const [price, setPrice] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { toast, node } = useToast();
  useEffect(() => {
    if (!d.data) return;
    setFees({ fee_pct: d.data.fee_override?.fee_pct ?? null, fixed_fee: d.data.fee_override?.fixed_fee ?? null, shipping_cost: d.data.fee_override?.shipping_cost ?? null, ads_pct: d.data.fee_override?.ads_pct ?? null });
    setSpecs({ weight_g: d.data.weight_g ?? null, print_minutes: d.data.print_minutes ?? null, material: d.data.material ?? "PLA" });
    setPrice(d.data.price ?? null);
  }, [d.data]);
  const l = d.data;
  const isApi = l && l.source === "api";
  return (
    <Modal open={!!id} onClose={onClose} title={l?.title ?? "Anúncio"} wide>
      {node}
      <ErrorBox error={d.error} />
      {d.loading && !l && <Spinner />}
      {l && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono">{l.id}</span><SourceTag kind={l.source} /><Badge tone={CLASS_TONE[l.class]}>{l.class_label}</Badge>
            {l.permalink && <a href={l.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">Ver no Mercado Livre <ExternalLink className="size-3" /></a>}
          </div>
          {l.source === "initial_import" && <Notice>Anúncio identificado na importação inicial. O ID oficial do Mercado Livre não foi informado; ao conectar a conta, o anúncio real será sincronizado. Estoque exibido ({int(l.available_quantity)}) é o do anúncio, não o estoque físico.</Notice>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Preço", brl(l.price)], ["Estoque exibido", int(l.available_quantity)], ["Visitas (30d)", int(l.visits)], ["Vendas (30d)", int(l.units_period)], ["Conversão", pct(l.conversion_pct)], ["Qualidade", l.quality_score ?? "—"], ["Margem", l.margin_pct === null ? "pendente" : pct(l.margin_pct)], ["Lucro/un.", l.unit_profit === null ? "—" : brl(l.unit_profit)]].map(([a, b]) => (
              <div key={a as string} className="rounded-lg bg-surface-2 p-2.5"><div className="text-[11px] text-ink-3">{a}</div><div className="font-semibold num">{b}</div></div>
            ))}
          </div>
          <div className="text-xs text-ink-2"><b>Diagnóstico:</b> {l.reasons.join(" · ")}{l.unit_missing?.length ? <> · <span className="text-warn">para calcular margem falta: {l.unit_missing.join(", ")}</span></> : null}</div>
          {l.sales.length > 0 ? <SmallLine data={l.sales} keys={[{ key: "revenue", name: "Receita", color: "var(--color-brand)", money: true }]} /> : <Pending title="Sem histórico de vendas por dia" />}
          {canEdit && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card title="Tarifas deste anúncio" subtitle="Sobrepõem as tarifas do canal">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Taxa (%)"><NumInput value={fees.fee_pct} onChange={(v) => setFees({ ...fees, fee_pct: v })} /></Field>
                  <Field label="Tarifa fixa (R$)"><NumInput value={fees.fixed_fee} onChange={(v) => setFees({ ...fees, fixed_fee: v })} /></Field>
                  <Field label="Frete vendedor (R$)"><NumInput value={fees.shipping_cost} onChange={(v) => setFees({ ...fees, shipping_cost: v })} /></Field>
                  <Field label="Publicidade (%)"><NumInput value={fees.ads_pct} onChange={(v) => setFees({ ...fees, ads_pct: v })} /></Field>
                </div>
                <Button size="sm" className="mt-3" onClick={async () => { try { await api(`/listings/${encodeURIComponent(l.id)}/fees`, { method: "PUT", body: fees }); toast("Tarifas salvas"); d.reload(); onSaved(); } catch (e) { toast((e as Error).message, "bad"); } }}>Salvar tarifas</Button>
              </Card>
              <Card title="Ficha técnica do produto" subtitle={l.product_id ? `Produto #${l.product_id}` : "Anúncio sem produto vinculado"}>
                {l.product_id ? <>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Peso (g)"><NumInput value={specs.weight_g} onChange={(v) => setSpecs({ ...specs, weight_g: v })} /></Field>
                    <Field label="Tempo (min)"><NumInput value={specs.print_minutes} onChange={(v) => setSpecs({ ...specs, print_minutes: v })} /></Field>
                    <Field label="Material"><Select value={specs.material} onChange={(e) => setSpecs({ ...specs, material: e.target.value })}><option>PLA</option><option>PETG</option></Select></Field>
                  </div>
                  <Button size="sm" className="mt-3" onClick={async () => { try { await api(`/products/${l.product_id}/specs`, { method: "PATCH", body: specs }); toast("Ficha salva"); d.reload(); onSaved(); } catch (e) { toast((e as Error).message, "bad"); } }}>Salvar ficha</Button>
                </> : <p className="text-xs text-ink-3">Vincule o anúncio a um produto em Estoque para calcular custos.</p>}
              </Card>
              <Card title="Preço" subtitle="Alteração de preço exige aprovação do administrador" className="md:col-span-2">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Novo preço (R$)"><NumInput value={price} onChange={setPrice} className="w-40" /></Field>
                  <Button disabled={!isApi || !price || price === l.price} onClick={() => setConfirm(true)}>Solicitar alteração</Button>
                  {!isApi && <span className="text-[11px] text-ink-3">Disponível apenas para anúncios sincronizados pela API.</span>}
                </div>
              </Card>
            </div>
          )}
          {l.competitors?.length > 0 && <div className="text-xs"><b>Concorrentes vinculados:</b> {l.competitors.map((c: any) => `${c.name} (${brl(c.price)})`).join(" · ")}</div>}
        </div>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Solicitar alteração de preço" confirmLabel="Enviar para aprovação"
        onConfirm={async () => { await api("/actions", { body: { type: "update_price", payload: { listing_id: l.id, price }, rationale: "Solicitado pela central de anúncios" } }); toast("Solicitação enviada para a Central de Aprovações"); }}>
        Alterar o preço de {brl(l?.price)} para {brl(price)}. Nada muda no Mercado Livre até um administrador aprovar.
      </ConfirmDialog>
    </Modal>
  );
}

void Store;
