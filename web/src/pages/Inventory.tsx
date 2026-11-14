import { useState } from "react";
import { Boxes, Factory, History, Settings2 } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, PageHeader, Spinner, ErrorBox, Table, Badge, Tabs, Modal, Field, Input, Select, Button, Empty, Notice, Stat, useToast } from "../components/ui.tsx";
import { int, dateTime, date } from "../lib/format.ts";
import { useUser, canOperate } from "../components/Layout.tsx";

const prioTone = { urgente: "bad", alta: "warn", normal: "info", baixa: "neutral" } as const;
const MOV: Record<string, string> = { in: "Entrada", out: "Saída", adjust: "Ajuste", sale: "Venda", sale_reversal: "Estorno", production: "Produção" };

function ProductSettings({ product, onClose, onSaved }: { product: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ min_stock: String(product.min_stock), lead_time_days: String(product.lead_time_days), made_to_order: !!product.made_to_order, sku: product.sku ?? "" });
  const [mov, setMov] = useState({ type: "in", qty: "", reason: "" });
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, node } = useToast();
  return (
    <Modal open onClose={onClose} title={product.name}
      footer={<><Button variant="ghost" onClick={onClose}>Fechar</Button><Button variant="primary" loading={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try { await api(`/products/${product.product_id ?? product.id}`, { method: "PATCH", body: { min_stock: Number(f.min_stock), lead_time_days: Number(f.lead_time_days), made_to_order: f.made_to_order, sku: f.sku || null } }); onSaved(); onClose(); } catch (e) { setErr(e as Error); } finally { setBusy(false); }
      }}>Salvar parâmetros</Button></>}>
      {node}
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Estoque mínimo"><Input type="number" min="0" value={f.min_stock} onChange={(e) => setF({ ...f, min_stock: e.target.value })} /></Field>
          <Field label="Prazo de produção (dias)"><Input type="number" min="0" value={f.lead_time_days} onChange={(e) => setF({ ...f, lead_time_days: e.target.value })} /></Field>
          <Field label="SKU"><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.made_to_order} onChange={(e) => setF({ ...f, made_to_order: e.target.checked })} /> Produto fabricado sob demanda (sem baixa de estoque físico)</label>
        <div className="rounded-lg border border-line p-4">
          <p className="mb-3 text-xs font-medium">Movimentação manual (exige aprovação)</p>
          <div className="grid gap-3 sm:grid-cols-[140px_100px_1fr]">
            <Select value={mov.type} onChange={(e) => setMov({ ...mov, type: e.target.value })}>
              <option value="in">Entrada</option><option value="production">Produção</option><option value="out">Saída</option><option value="adjust">Ajuste (+/−)</option>
            </Select>
            <Input type="number" placeholder="Qtd." value={mov.qty} onChange={(e) => setMov({ ...mov, qty: e.target.value })} />
            <Input placeholder="Motivo" value={mov.reason} onChange={(e) => setMov({ ...mov, reason: e.target.value })} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" disabled={!mov.qty || Number(mov.qty) === 0} onClick={async () => {
              setErr(null);
              try { await api("/actions", { body: { type: "stock_adjust", payload: { product_id: product.product_id ?? product.id, type: mov.type, qty: Number(mov.qty), reason: mov.reason || undefined } } }); toast("Movimentação enviada para aprovação"); setMov({ type: "in", qty: "", reason: "" }); } catch (e) { setErr(e as Error); }
            }}>Solicitar movimentação</Button>
          </div>
          <p className="mt-2 text-[11px] text-ink-3">Este é o estoque interno. Para mudar a quantidade disponível no Mercado Livre, use a tela do anúncio.</p>
        </div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

export default function Inventory() {
  const user = useUser();
  const [tab, setTab] = useState<"plan" | "turnover" | "moves">("plan");
  const inv = useApi<any>("/inventory");
  const moves = useApi<any[]>(tab === "moves" ? "/inventory/movements" : null, [tab]);
  const [edit, setEdit] = useState<any>(null);
  const plan: any[] = inv.data?.plan ?? [];

  return (
    <>
      <PageHeader title="Estoque e produção" subtitle="Saldo interno com baixa automática por venda confirmada, alertas de reposição e plano de produção pela velocidade de vendas."
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: "plan", label: "Plano de produção" }, { value: "turnover", label: "Giro e parados" }, { value: "moves", label: "Movimentações" }]} />} />
      <ErrorBox error={inv.error} onRetry={inv.reload} />
      {inv.loading && !inv.data ? <Spinner /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Produtos" value={int(plan.length)} icon={<Boxes className="size-4" />} />
            <Stat label="Produção urgente" value={int(plan.filter((p) => p.priority === "urgente").length)} tone="bad" icon={<Factory className="size-4" />} />
            <Stat label="Abaixo do mínimo" value={int(plan.filter((p) => !p.made_to_order && p.min_stock > 0 && p.stock <= p.min_stock).length)} tone="warn" />
            <Stat label="Unidades a produzir" value={int(plan.reduce((s, p) => s + p.suggested_production, 0))} hint="cobertura de prazo + 14 dias" />
          </div>
          {tab === "plan" && (
            <Card title="Planejamento de produção" subtitle="Velocidade = vendas pagas dos últimos 30 dias. Meta: estoque para o prazo de produção + 14 dias.">
              <Table rows={plan} rowKey={(r) => r.product_id} onRowClick={canOperate(user) ? setEdit : undefined}
                empty={<Empty icon={<Boxes className="size-5" />} title="Nenhum produto">Os produtos são criados automaticamente ao importar os anúncios.</Empty>}
                cols={[
                  { key: "name", header: "Produto", render: (r) => <div className="min-w-[220px]"><div className="font-medium truncate max-w-[340px]">{r.name}</div><div className="text-[11px] text-ink-3">{r.sku ?? "sem SKU"}{r.made_to_order ? " · sob demanda" : ""}</div></div> },
                  { key: "priority", header: "Prioridade", render: (r) => <Badge tone={prioTone[r.priority as keyof typeof prioTone]}>{r.priority}</Badge> },
                  { key: "stock", header: "Estoque", align: "right", render: (r) => <span className={r.stock <= 0 && !r.made_to_order ? "text-bad font-medium" : ""}>{r.made_to_order ? "—" : int(r.stock)}</span> },
                  { key: "min_stock", header: "Mínimo", align: "right", render: (r) => int(r.min_stock) },
                  { key: "units_30d", header: "Vendas 30d", align: "right", render: (r) => int(r.units_30d) },
                  { key: "daily_velocity", header: "Un./dia", align: "right", render: (r) => r.daily_velocity.toLocaleString("pt-BR") },
                  { key: "days_of_cover", header: "Cobertura", align: "right", render: (r) => (r.days_of_cover === null ? "—" : `${r.days_of_cover} d`) },
                  { key: "suggested_production", header: "Produzir", align: "right", render: (r) => (r.suggested_production ? <b className="text-brand">{int(r.suggested_production)}</b> : "—") },
                  { key: "reason", header: "Motivo", render: (r) => <span className="text-xs text-ink-2">{r.reason}</span> },
                ]} />
              {canOperate(user) && <p className="mt-3 text-[11px] text-ink-3 flex items-center gap-1"><Settings2 className="size-3" />Clique em um produto para definir estoque mínimo, prazo, produção sob demanda ou registrar movimentações.</p>}
            </Card>
          )}
          {tab === "turnover" && (
            <Card title="Giro de estoque e produtos parados" subtitle="Giro = unidades vendidas em 30 dias ÷ estoque atual">
              <Table rows={inv.data.turnover} rowKey={(r: any) => r.id}
                cols={[
                  { key: "name", header: "Produto", render: (r: any) => <span className="font-medium">{r.name}</span> },
                  { key: "stock_qty", header: "Estoque", align: "right", render: (r: any) => int(r.stock_qty) },
                  { key: "units", header: "Vendas 30d", align: "right", render: (r: any) => int(r.units) },
                  { key: "turnover", header: "Giro", align: "right", render: (r: any) => r.turnover ?? "—" },
                  { key: "last_sale", header: "Última venda", render: (r: any) => date(r.last_sale) },
                  { key: "days_without_sale", header: "Situação", render: (r: any) => r.days_without_sale === null ? <Badge>nunca vendeu</Badge> : r.days_without_sale > 30 ? <Badge tone="warn">parado há {r.days_without_sale} d</Badge> : <Badge tone="good">girando</Badge> },
                ]} />
            </Card>
          )}
          {tab === "moves" && (
            <Card title="Histórico de movimentações" subtitle="Vendas e estornos são registrados automaticamente; ajustes manuais passam por aprovação.">
              {moves.loading && !moves.data ? <Spinner /> : (
                <Table rows={moves.data ?? []} rowKey={(r) => r.id} empty={<Empty icon={<History className="size-5" />} title="Sem movimentações" />}
                  cols={[
                    { key: "created_at", header: "Data", render: (r) => <span className="text-xs">{dateTime(r.created_at)}</span> },
                    { key: "product_name", header: "Produto", render: (r) => <span className="truncate block max-w-[300px]">{r.product_name}</span> },
                    { key: "type", header: "Tipo", render: (r) => <Badge tone={r.qty > 0 ? "good" : "bad"}>{MOV[r.type] ?? r.type}</Badge> },
                    { key: "qty", header: "Qtd.", align: "right", render: (r) => <span className={r.qty > 0 ? "text-good" : "text-bad"}>{r.qty > 0 ? "+" : ""}{r.qty}</span> },
                    { key: "reason", header: "Motivo", render: (r) => <span className="text-xs text-ink-2">{r.reason ?? "—"}</span> },
                    { key: "user_name", header: "Por", render: (r) => <span className="text-xs">{r.user_name ?? "sistema"}</span> },
                  ]} />
              )}
            </Card>
          )}
          <div className="mt-4"><Notice>A baixa automática acontece quando o pedido é confirmado como pago e é estornada em cancelamentos, sem duplicidade. Produtos sob demanda não têm estoque físico baixado.</Notice></div>
        </>
      )}
      {edit && <ProductSettings product={edit} onClose={() => setEdit(null)} onSaved={inv.reload} />}
    </>
  );
}
