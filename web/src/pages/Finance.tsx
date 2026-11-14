import { useEffect, useState } from "react";
import { Calculator, Wallet } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, PageHeader, Spinner, ErrorBox, Table, Badge, Tabs, Modal, Field, Input, Select, Button, Empty, Notice, Stat, PeriodFilter, periodQuery, Thumb, cx, type PeriodValue } from "../components/ui.tsx";
import { brl, pct, int } from "../lib/format.ts";
import { useUser, canOperate } from "../components/Layout.tsx";

const COST_FIELDS: [string, string, string?][] = [
  ["material_cost", "Matéria-prima (R$/un.)", "filamento, resina, insumos"],
  ["manufacturing_cost", "Fabricação (R$/un.)", "desgaste de máquina, peças"],
  ["energy_cost", "Energia (R$/un.)"],
  ["production_minutes", "Tempo de produção (min)", "impressão + acabamento"],
  ["labor_cost_per_hour", "Mão de obra (R$/hora)"],
  ["packaging_cost", "Embalagem (R$/un.)"],
  ["operational_cost", "Custos operacionais (R$/un.)", "rateio de aluguel, software etc."],
  ["shipping_cost_seller", "Frete pago pelo vendedor (R$/un.)", "usado quando o custo real do envio não está disponível"],
  ["ads_cost_per_unit", "Publicidade (R$/un.)", "usado quando não há dados do Product Ads"],
  ["tax_rate_pct", "Impostos (% da venda)", "ex.: Simples Nacional"],
  ["other_cost", "Outros encargos (R$/un.)"],
];

function CostEditor({ product, onClose, onSaved }: { product: any; onClose: () => void; onSaved: () => void }) {
  const { data, error, loading } = useApi<any>(`/products/${product.id}/costs`);
  const [c, setC] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  useEffect(() => { if (data) setC(Object.fromEntries(Object.entries(data.costs).map(([k, v]) => [k, String(v)]))); }, [data]);
  const n = (k: string) => Number((c[k] ?? "0").replace(",", ".")) || 0;
  const prod = n("material_cost") + n("manufacturing_cost") + n("energy_cost") + (n("production_minutes") / 60) * n("labor_cost_per_hour") + n("packaging_cost") + n("operational_cost") + n("other_cost");
  return (
    <Modal open onClose={onClose} title={`Ficha de custos · ${product.name}`} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try { await api(`/products/${product.id}/costs`, { method: "PUT", body: Object.fromEntries(COST_FIELDS.map(([k]) => [k, n(k)])) }); onSaved(); onClose(); } catch (e) { setErr(e as Error); } finally { setBusy(false); }
      }}>Salvar custos</Button></>}>
      {loading ? <Spinner /> : (
        <div className="space-y-4">
          <ErrorBox error={error ?? err} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COST_FIELDS.map(([k, label, hint]) => <Field key={k} label={label} hint={hint}><Input inputMode="decimal" value={c[k] ?? ""} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></Field>)}
          </div>
          <div className="rounded-lg bg-surface-2 p-3 text-sm">Custo de produção por unidade: <b className="num">{brl(prod)}</b> <span className="text-xs text-ink-3">(sem tarifas, frete, publicidade e impostos)</span></div>
        </div>
      )}
    </Modal>
  );
}

function Profitability() {
  const [period, setPeriod] = useState<PeriodValue>({ period: "30d" });
  const { data, error, loading, reload } = useApi<any>(`/finance/profitability?${periodQuery(period)}`);
  const t = data?.totals;
  return (
    <div className="space-y-6">
      <PeriodFilter value={period} onChange={setPeriod} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Receita bruta" value={brl(t.revenue)} />
            <Stat label="Tarifas do ML" value={brl(t.sale_fees)} hint={t.revenue ? pct((t.sale_fees / t.revenue) * 100) + " da receita" : undefined} />
            <Stat label="Frete do vendedor" value={brl(t.shipping)} />
            <Stat label="Custo de produção" value={brl(t.production_cost)} />
            <Stat label="Lucro líquido estimado" value={brl(t.profit)} tone={t.profit < 0 ? "bad" : "good"} />
            <Stat label="Margem" value={t.revenue_with_costs ? pct((t.profit / t.revenue_with_costs) * 100) : "—"} hint={t.products_without_costs ? `${t.products_without_costs} produto(s) sem custos` : undefined} />
          </div>
          {t.products_without_costs > 0 && <Notice tone="warn">Produtos sem ficha de custos aparecem com lucro "—": cadastre os custos na aba "Fichas de custo" para calcular lucro e margem.</Notice>}
          <Card title="Lucratividade por produto" subtitle="Pedidos pagos no período">
            <Table rows={data.rows} rowKey={(r: any) => r.listing_id} empty={<Empty icon={<Wallet className="size-5" />} title="Sem vendas no período" />}
              cols={[
                { key: "title", header: "Produto", render: (r: any) => <span className="block max-w-[300px] truncate font-medium">{r.title}</span> },
                { key: "units", header: "Un.", align: "right", render: (r: any) => int(r.units) },
                { key: "revenue", header: "Receita", align: "right", render: (r: any) => brl(r.revenue) },
                { key: "sale_fees", header: "Tarifas", align: "right", render: (r: any) => brl(r.sale_fees) },
                { key: "shipping", header: "Frete", align: "right", render: (r: any) => brl(r.shipping) },
                { key: "production_cost", header: "Produção", align: "right", render: (r: any) => brl(r.production_cost) },
                { key: "taxes", header: "Impostos", align: "right", render: (r: any) => brl(r.taxes) },
                { key: "ads", header: "Ads", align: "right", render: (r: any) => brl(r.ads) },
                { key: "profit", header: "Lucro", align: "right", render: (r: any) => <span className={cx("font-medium", r.profit < 0 && "text-bad")}>{brl(r.profit)}</span> },
                { key: "margin_pct", header: "Margem", align: "right", render: (r: any) => r.margin_pct === null ? <Badge tone="warn">sem custos</Badge> : <span className={r.margin_pct < 10 ? "text-bad" : ""}>{pct(r.margin_pct)}</span> },
              ]} />
          </Card>
        </>
      )}
    </div>
  );
}

function CostSheets() {
  const user = useUser();
  const { data, error, loading, reload } = useApi<any[]>("/products");
  const [edit, setEdit] = useState<any>(null);
  return (
    <Card title="Fichas de custo por produto" subtitle="Base para lucro, margem, ROI e preço recomendado.">
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : (
        <Table rows={data ?? []} rowKey={(r) => r.id} onRowClick={canOperate(user) ? setEdit : undefined}
          empty={<Empty title="Nenhum produto">Os produtos são criados ao importar os anúncios do Mercado Livre.</Empty>}
          cols={[
            { key: "name", header: "Produto", render: (r) => <div className="flex items-center gap-3"><Thumb src={r.thumbnail} /><div><div className="font-medium max-w-[360px] truncate">{r.name}</div><div className="text-[11px] text-ink-3">{r.sku ?? "sem SKU"} · {r.listing_ids?.split(",").length ?? 0} anúncio(s)</div></div></div> },
            { key: "has_costs", header: "Ficha", render: (r) => (r.has_costs ? <Badge tone="good">cadastrada</Badge> : <Badge tone="warn">pendente</Badge>) },
            { key: "act", header: "", render: (r) => canOperate(user) && <Button size="sm" onClick={(e) => { e.stopPropagation(); setEdit(r); }}>Editar custos</Button> },
          ]} />
      )}
      {edit && <CostEditor product={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Card>
  );
}

function Simulator() {
  const defaults = useApi<any>("/settings");
  const [c, setC] = useState<Record<string, string>>({ material_cost: "", manufacturing_cost: "", energy_cost: "", production_minutes: "", labor_cost_per_hour: "", packaging_cost: "", operational_cost: "", shipping_cost_seller: "", ads_cost_per_unit: "", tax_rate_pct: "", other_cost: "" });
  const [opt, setOpt] = useState({ target: "", category: "", listing_type: "gold_special", prices: "", feeMode: "ml", feePct: "", feeFixed: "", monthly: "" });
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (defaults.data) setOpt((o) => ({ ...o, target: o.target || String(defaults.data.target_margin_pct), monthly: o.monthly || String(defaults.data.monthly_fixed_costs) })); }, [defaults.data]);
  const n = (v: string) => Number((v || "0").replace(",", ".")) || 0;
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      setRes(await api("/finance/simulate", { body: {
        costs: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, n(v)])),
        prices: opt.prices.split(/[;\s]+/).map((p) => n(p)).filter((p) => p > 0),
        target_margin_pct: n(opt.target), category_id: opt.category || undefined, listing_type_id: opt.listing_type,
        manual_fee: opt.feeMode === "manual" ? { percentage: n(opt.feePct) / 100, fixed: n(opt.feeFixed) } : undefined,
        monthly_fixed: n(opt.monthly),
      } }));
    } catch (e) { setErr(e as Error); } finally { setBusy(false); }
  };
  const rec = res?.recommended;
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
      <Card title="Calculadora inteligente de preço e margem" subtitle="Simule preços com a tarifa oficial do Mercado Livre (por categoria e tipo de anúncio) ou com tarifa manual.">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {COST_FIELDS.map(([k, label]) => <Field key={k} label={label}><Input inputMode="decimal" value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></Field>)}
          </div>
          <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
            <Field label="Margem-alvo (%)"><Input inputMode="decimal" value={opt.target} onChange={(e) => setOpt({ ...opt, target: e.target.value })} /></Field>
            <Field label="Custos fixos mensais (R$)" hint="para o ponto de equilíbrio"><Input inputMode="decimal" value={opt.monthly} onChange={(e) => setOpt({ ...opt, monthly: e.target.value })} /></Field>
            <Field label="Tarifa"><Select value={opt.feeMode} onChange={(e) => setOpt({ ...opt, feeMode: e.target.value })}><option value="ml">Oficial do Mercado Livre</option><option value="manual">Manual</option></Select></Field>
            {opt.feeMode === "ml" ? (
              <>
                <Field label="Tipo de anúncio"><Select value={opt.listing_type} onChange={(e) => setOpt({ ...opt, listing_type: e.target.value })}><option value="gold_special">Clássico</option><option value="gold_pro">Premium</option></Select></Field>
                <Field label="ID da categoria (opcional)" hint="ex.: MLB1234 — melhora a precisão da tarifa"><Input value={opt.category} onChange={(e) => setOpt({ ...opt, category: e.target.value.trim() })} /></Field>
              </>
            ) : (
              <>
                <Field label="Comissão (%)"><Input inputMode="decimal" value={opt.feePct} onChange={(e) => setOpt({ ...opt, feePct: e.target.value })} /></Field>
                <Field label="Tarifa fixa (R$/un.)"><Input inputMode="decimal" value={opt.feeFixed} onChange={(e) => setOpt({ ...opt, feeFixed: e.target.value })} /></Field>
              </>
            )}
            <Field label="Preços para comparar (R$)" hint="separe por espaço, ex.: 49.90 59.90 69.90" className="sm:col-span-2"><Input value={opt.prices} onChange={(e) => setOpt({ ...opt, prices: e.target.value })} /></Field>
          </div>
          <ErrorBox error={err} />
          <div className="flex justify-end"><Button variant="primary" icon={<Calculator className="size-4" />} loading={busy} onClick={run}>Calcular</Button></div>
        </div>
      </Card>
      <div className="space-y-6">
        {!res && <Card><Empty icon={<Calculator className="size-5" />} title="Preencha os custos e calcule">Você verá custo total, preço mínimo, preço recomendado, lucro, margem, ROI e ponto de equilíbrio.</Empty></Card>}
        {res && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Custo de produção" value={brl(res.production_cost)} />
              <Stat label="Preço mínimo (lucro zero)" value={brl(res.min_price)} />
              <Stat label={`Preço recomendado (${opt.target}% margem)`} value={brl(rec?.price)} tone="good" hint={rec?.fee ? `tarifa ${(rec.fee.percentage * 100).toFixed(1)}% + ${brl(rec.fee.fixed)} (${rec.fee.source === "manual" ? "manual" : "oficial ML"})` : undefined} />
              <Stat label="Ponto de equilíbrio" value={res.break_even_units_month === null ? "—" : `${int(res.break_even_units_month)} un./mês`} hint={`custos fixos de ${brl(res.monthly_fixed)}`} />
            </div>
            <Card title="Simulações">
              <Table rows={[...(rec?.simulation ? [{ ...rec.simulation, _rec: true }] : []), ...res.simulations]} rowKey={(r: any) => `${r.price}-${r._rec ? "r" : ""}`}
                cols={[
                  { key: "price", header: "Preço", align: "right", render: (r: any) => <span className="font-medium">{brl(r.price)} {r._rec && <Badge tone="brand">recomendado</Badge>}</span> },
                  { key: "platform_fee", header: "Comissão", align: "right", render: (r: any) => brl(r.platform_fee) },
                  { key: "fixed_fee", header: "Tarifa fixa", align: "right", render: (r: any) => brl(r.fixed_fee) },
                  { key: "taxes", header: "Impostos", align: "right", render: (r: any) => brl(r.taxes) },
                  { key: "total_cost", header: "Custo total", align: "right", render: (r: any) => brl(r.total_cost) },
                  { key: "net_profit", header: "Lucro", align: "right", render: (r: any) => <span className={r.net_profit < 0 ? "text-bad font-medium" : "text-good font-medium"}>{brl(r.net_profit)}</span> },
                  { key: "margin_pct", header: "Margem", align: "right", render: (r: any) => pct(r.margin_pct) },
                  { key: "roi_pct", header: "ROI", align: "right", render: (r: any) => pct(r.roi_pct) },
                ]} />
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

export default function Finance() {
  const [tab, setTab] = useState<"profit" | "costs" | "calc">("profit");
  return (
    <>
      <PageHeader title="Financeiro e rentabilidade" subtitle="Quanto você ganha de verdade em cada venda, com tarifas reais do Mercado Livre."
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: "profit", label: "Rentabilidade" }, { value: "costs", label: "Fichas de custo" }, { value: "calc", label: "Calculadora" }]} />} />
      {tab === "profit" && <Profitability />}
      {tab === "costs" && <CostSheets />}
      {tab === "calc" && <Simulator />}
    </>
  );
}
