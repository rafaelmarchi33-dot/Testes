import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Truck, AlertTriangle } from "lucide-react";
import { useApi } from "../lib/api.ts";
import { Card, PageHeader, PeriodFilter, periodQuery, Spinner, ErrorBox, Table, Badge, Input, Select, Empty, Stat, type PeriodValue } from "../components/ui.tsx";
import { brl, dateTime, ORDER_STATUS, SHIP_STATUS, int } from "../lib/format.ts";

const orderTone = (s: string) => (s === "paid" ? "good" : s === "cancelled" ? "bad" : "warn") as any;
const shipTone = (s: string) => (s === "delivered" ? "good" : s === "shipped" ? "info" : s === "ready_to_ship" || s === "handling" ? "warn" : s === "not_delivered" || s === "cancelled" ? "bad" : "neutral") as any;
const PAY: Record<string, string> = { approved: "Aprovado", pending: "Pendente", rejected: "Recusado", refunded: "Estornado", unknown: "—" };

export default function Orders() {
  const [params] = useSearchParams();
  const [period, setPeriod] = useState<PeriodValue>({ period: "30d" });
  const [status, setStatus] = useState("all");
  const [shipping, setShipping] = useState(params.get("shipping") ?? "all");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [q, setQ] = useState(search);
  useEffect(() => { const t = setTimeout(() => setQ(search), 250); return () => clearTimeout(t); }, [search]);
  const { data, error, loading, reload } = useApi<any[]>(`/orders?${periodQuery(period)}&status=${status}&shipping=${shipping}&search=${encodeURIComponent(q)}`);
  const rows = data ?? [];
  const attention = rows.filter((r) => r.attention.length);

  return (
    <>
      <PageHeader title="Pedidos e logística" subtitle="Pedidos sincronizados do Mercado Livre com status de pagamento, envio e rastreio." actions={<PeriodFilter value={period} onChange={setPeriod} />} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pedidos no filtro" value={int(rows.length)} />
        <Stat label="Pagos" value={int(rows.filter((r) => r.status === "paid").length)} />
        <Stat label="Aguardando envio" value={int(rows.filter((r) => r.status === "paid" && ["ready_to_ship", "handling"].includes(r.ship_status)).length)} />
        <Stat label="Precisam de atenção" value={int(attention.length)} tone={attention.length ? "bad" : undefined} icon={<AlertTriangle className="size-4" />} />
      </div>
      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Nº do pedido, comprador ou produto" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
            <option value="all">Todos os pedidos</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={shipping} onChange={(e) => setShipping(e.target.value)} className="sm:w-48">
            <option value="all">Todos os envios</option>{Object.entries(SHIP_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Spinner /> : (
          <Table rows={rows} rowKey={(r) => r.id} empty={<Empty icon={<Truck className="size-5" />} title="Nenhum pedido encontrado" />}
            cols={[
              { key: "id", header: "Pedido", render: (r) => <div><div className="font-medium num">{r.id}</div><div className="text-[11px] text-ink-3">{dateTime(r.date_created)}</div></div> },
              { key: "items", header: "Produto", render: (r) => (
                <div className="min-w-[220px] max-w-[340px]">
                  {r.items.map((i: any) => <div key={i.listing_id} className="truncate text-xs"><b className="num">{i.quantity}×</b> {i.title}</div>)}
                  {r.attention.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{r.attention.map((a: string) => <Badge key={a} tone="bad">{a}</Badge>)}</div>}
                </div>
              ) },
              { key: "qty", header: "Qtd.", align: "right", render: (r) => int(r.items.reduce((s: number, i: any) => s + i.quantity, 0)) },
              { key: "total_amount", header: "Valor", align: "right", render: (r) => brl(r.total_amount) },
              { key: "status", header: "Pedido", render: (r) => <Badge tone={orderTone(r.status)}>{ORDER_STATUS[r.status] ?? r.status}</Badge> },
              { key: "payment_status", header: "Pagamento", render: (r) => <span className="text-xs">{PAY[r.payment_status] ?? r.payment_status}</span> },
              { key: "ship", header: "Envio", render: (r) => r.ship_status ? <Badge tone={shipTone(r.ship_status)}>{SHIP_STATUS[r.ship_status] ?? r.ship_status}</Badge> : <span className="text-xs text-ink-3">—</span> },
              { key: "deadline", header: "Postar até", render: (r) => <span className="text-xs">{r.handling_limit && ["ready_to_ship", "handling"].includes(r.ship_status) ? dateTime(r.handling_limit) : "—"}</span> },
              { key: "tracking", header: "Rastreio", render: (r) => <span className="text-xs num">{r.tracking_number ?? "—"}</span> },
            ]} />
        )}
      </Card>
    </>
  );
}
