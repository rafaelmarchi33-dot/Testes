import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router";
import { ExternalLink, Package, PauseCircle, PlayCircle, Tag, Boxes } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, PageHeader, Spinner, ErrorBox, Table, Badge, Thumb, Input, Select, Modal, Button, Field, Empty, Notice, ConfirmDialog, useToast } from "../components/ui.tsx";
import { SmallLine } from "../components/charts.tsx";
import { brl, int, LISTING_STATUS, LISTING_TYPE, dateTime, pct } from "../lib/format.ts";
import { useUser, canOperate } from "../components/Layout.tsx";

const statusTone = (s: string) => (s === "active" ? "good" : s === "paused" ? "warn" : s === "under_review" ? "info" : "neutral") as any;

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const user = useUser();
  const { data, error, loading } = useApi<any>(`/listings/${id}`);
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [confirm, setConfirm] = useState<null | { type: string; payload: any; title: string; text: string }>(null);
  const { toast, node } = useToast();
  useEffect(() => { if (data) { setPrice(String(data.price)); setStock(String(data.available_quantity)); } }, [data]);
  const series = (() => {
    if (!data) return [];
    const m = new Map<string, any>();
    for (const s of data.sales) m.set(s.date, { date: s.date, units: s.units, visits: 0 });
    for (const v of data.visits) m.set(v.date, { ...(m.get(v.date) ?? { date: v.date, units: 0 }), visits: v.visits });
    return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
  })();
  const request = (type: string, payload: any, title: string, text: string) => setConfirm({ type, payload, title, text });
  return (
    <Modal open onClose={onClose} title="Detalhes do anúncio" wide>
      {node}
      {loading && <Spinner />}
      <ErrorBox error={error} />
      {data && (
        <div className="space-y-5">
          <div className="flex gap-4">
            <Thumb src={data.pictures?.[0] ?? data.thumbnail} size={88} />
            <div className="min-w-0">
              <h3 className="font-semibold leading-snug">{data.title}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span>{data.id}</span><Badge tone={statusTone(data.status)}>{LISTING_STATUS[data.status] ?? data.status}</Badge>
                <span>{LISTING_TYPE[data.listing_type_id] ?? data.listing_type_id}</span>{data.sku && <span>SKU {data.sku}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <span><span className="text-ink-3 text-xs">Preço </span><b className="num">{brl(data.price)}</b></span>
                <span><span className="text-ink-3 text-xs">Disponível </span><b className="num">{int(data.available_quantity)}</b></span>
                <span><span className="text-ink-3 text-xs">Vendidos (ML) </span><b className="num">{int(data.sold_quantity)}</b></span>
                {data.health !== null && <span><span className="text-ink-3 text-xs">Qualidade </span><b className="num">{pct(data.health * 100, 0)}</b></span>}
              </div>
              {data.permalink && <a href={data.permalink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline">Ver no Mercado Livre <ExternalLink className="size-3" /></a>}
            </div>
          </div>
          <Card title="Vendas e visitas (90 dias)" pad>{series.length ? <SmallLine data={series} keys={[{ key: "units", name: "Unidades", color: "var(--color-brand)" }, { key: "visits", name: "Visitas", color: "var(--color-info)" }]} /> : <Empty title="Sem vendas ou visitas registradas" />}</Card>
          {canOperate(user) && (
            <Card title="Ações (exigem aprovação)" subtitle="Nada é alterado no Mercado Livre até um administrador aprovar na Central de Aprovações.">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Novo preço (R$)">
                  <div className="flex gap-2"><Input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
                    <Button disabled={!price || Number(price) === data.price} onClick={() => request("update_price", { listing_id: data.id, price: Number(price) }, "Solicitar alteração de preço", `Alterar preço de ${brl(data.price)} para ${brl(Number(price))}.`)} icon={<Tag className="size-4" />} /></div>
                </Field>
                <Field label="Estoque no Mercado Livre">
                  <div className="flex gap-2"><Input type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} />
                    <Button disabled={stock === "" || Number(stock) === data.available_quantity} onClick={() => request("update_ml_stock", { listing_id: data.id, available_quantity: Number(stock) }, "Solicitar atualização de estoque", `Alterar quantidade disponível de ${data.available_quantity} para ${stock}.`)} icon={<Boxes className="size-4" />} /></div>
                </Field>
                <Field label="Status">
                  {data.status === "active"
                    ? <Button className="w-full" icon={<PauseCircle className="size-4" />} onClick={() => request("update_status", { listing_id: data.id, status: "paused" }, "Solicitar pausa", "Pausar este anúncio.")}>Pausar anúncio</Button>
                    : data.status === "paused"
                      ? <Button className="w-full" icon={<PlayCircle className="size-4" />} onClick={() => request("update_status", { listing_id: data.id, status: "active" }, "Solicitar reativação", "Reativar este anúncio.")}>Reativar anúncio</Button>
                      : <span className="text-xs text-ink-3">Indisponível para este status</span>}
                </Field>
              </div>
            </Card>
          )}
          <p className="text-[11px] text-ink-3">Atualizado no ML em {dateTime(data.last_updated)} · Sincronizado em {dateTime(data.synced_at)}</p>
        </div>
      )}
      {confirm && (
        <ConfirmDialog open title={confirm.title} confirmLabel="Enviar para aprovação" onClose={() => setConfirm(null)} onConfirm={async () => {
          await api("/actions", { body: { type: confirm.type, payload: confirm.payload } });
          toast("Solicitação criada. Aprove em Aprovações.");
          onChanged();
        }}>
          <p>{confirm.text}</p>
          <Notice>A solicitação ficará pendente na <Link to="/aprovacoes" className="text-brand underline">Central de Aprovações</Link>. Somente após a aprovação ela é enviada ao Mercado Livre.</Notice>
        </ConfirmDialog>
      )}
    </Modal>
  );
}

export default function Listings() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search), 250); return () => clearTimeout(t); }, [search]);
  const { data, error, loading, reload } = useApi<any[]>(`/listings?status=${status}&search=${encodeURIComponent(debounced)}`);
  const open = params.get("id");
  const counts: Record<string, number> = {};
  for (const l of data ?? []) counts[l.status] = (counts[l.status] ?? 0) + 1;

  return (
    <>
      <PageHeader title="Anúncios" subtitle="Todos os anúncios importados do Mercado Livre: ativos, pausados, encerrados e em revisão."
        actions={<Link to="/criar"><Button variant="primary" icon={<Package className="size-4" />}>Criar anúncio com IA</Button></Link>} />
      <Card pad>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Buscar por título, ID ou SKU" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
            <option value="all">Todos os status</option>
            {Object.entries(LISTING_STATUS).map(([k, v]) => <option key={k} value={k}>{v}{status === "all" && counts[k] ? ` (${counts[k]})` : ""}</option>)}
          </Select>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Spinner /> : (
          <Table rows={data ?? []} rowKey={(r) => r.id} onRowClick={(r) => setParams({ id: r.id })}
            empty={<Empty icon={<Package className="size-5" />} title="Nenhum anúncio">Conecte o Mercado Livre em Integrações para importar seus anúncios.</Empty>}
            cols={[
              { key: "title", header: "Anúncio", render: (r) => (
                <div className="flex items-center gap-3 min-w-[260px]"><Thumb src={r.thumbnail} />
                  <div className="min-w-0"><div className="truncate font-medium max-w-[380px]">{r.title}</div><div className="text-[11px] text-ink-3">{r.id}{r.sku ? ` · SKU ${r.sku}` : ""}{r.category_name ? ` · ${r.category_name}` : ""}</div></div></div>
              ) },
              { key: "status", header: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{LISTING_STATUS[r.status] ?? r.status}</Badge> },
              { key: "price", header: "Preço", align: "right", render: (r) => brl(r.price) },
              { key: "available_quantity", header: "Disponível", align: "right", render: (r) => <span className={r.available_quantity <= 0 ? "text-bad font-medium" : ""}>{int(r.available_quantity)}</span> },
              { key: "units_30d", header: "Vendas 30d", align: "right", render: (r) => int(r.units_30d) },
              { key: "visits_30d", header: "Visitas 30d", align: "right", render: (r) => int(r.visits_30d) },
              { key: "conv", header: "Conversão", align: "right", render: (r) => (r.visits_30d ? pct((r.units_30d / r.visits_30d) * 100, 1) : "—") },
              { key: "has_costs", header: "Custos", render: (r) => (r.has_costs ? <Badge tone="good">ok</Badge> : <Badge tone="warn">pendente</Badge>) },
            ]} />
        )}
      </Card>
      {open && <Detail id={open} onClose={() => setParams({})} onChanged={reload} />}
    </>
  );
}
