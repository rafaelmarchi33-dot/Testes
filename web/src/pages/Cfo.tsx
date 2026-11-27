import { useEffect, useState } from "react";
import { Calculator, Save, AlertTriangle } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { useUser, isAdmin, canOperate } from "../components/Layout.tsx";
import { Card, PageHeader, Button, Input, Select, Field, NumInput, ErrorBox, Spinner, Badge, Tabs, Table, Pending, Notice, useToast, ConfirmDialog, ExportButtons } from "../components/ui.tsx";
import { brl, pct, int, date } from "../lib/format.ts";

export default function Cfo() {
  const [tab, setTab] = useState<"calc" | "config" | "ranking" | "dre">("calc");
  return (
    <>
      <PageHeader title="Financeiro — CFO" subtitle="Custos reais da operação 3D, precificação, simulação de volume, rentabilidade e DRE gerencial. Faturamento nunca é tratado como lucro."
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: "calc", label: "Calculadora e simulador" }, { value: "config", label: "Cadastro de custos" }, { value: "ranking", label: "Ranking de rentabilidade" }, { value: "dre", label: "DRE e despesas" }]} />} />
      {tab === "calc" && <CalcTab />}
      {tab === "config" && <ConfigTab />}
      {tab === "ranking" && <RankingTab />}
      {tab === "dre" && <DreTab />}
    </>
  );
}

function CalcTab() {
  const user = useUser();
  const cfg = useApi<any>("/finance/cost-config");
  const products = useApi<any[]>("/products");
  const [input, setInput] = useState<any>({ weight_g: 50, print_minutes: 120, material: "PLA", sale_price: 45, fee_pct: null, fixed_fee: null, packaging: null, other_costs: null, shipping: null, ads_pct: null, tax_pct: null });
  const [channel, setChannel] = useState("mercadolivre");
  const [volumes, setVolumes] = useState("1, 10, 50, 100, 500");
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveTo, setSaveTo] = useState("");
  const { toast, node } = useToast();
  const run = async () => {
    setBusy(true); setErr(null);
    try { setRes(await api("/finance/calc3d", { body: { input, channel, volumes: volumes.split(/[,;\s]+/).map(Number).filter((n) => n > 0).slice(0, 10) } })); } catch (e) { setErr(e as Error); } finally { setBusy(false); }
  };
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const c = res?.calc;
  const set = (k: string) => (v: number | null) => setInput({ ...input, [k]: v });
  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      {node}
      <Card title="Calculadora de produto" subtitle="Campos vazios usam o cadastro de custos/canal">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Peso (g)"><NumInput value={input.weight_g} onChange={set("weight_g")} /></Field>
          <Field label="Tempo de impressão (min)"><NumInput value={input.print_minutes} onChange={set("print_minutes")} /></Field>
          <Field label="Material"><Select value={input.material} onChange={(e) => setInput({ ...input, material: e.target.value })}>{Object.keys(cfg.data?.config.filament_price_per_kg ?? { PLA: 1, PETG: 1 }).map((m) => <option key={m}>{m}</option>)}</Select></Field>
          <Field label="Preço de venda (R$)"><NumInput value={input.sale_price} onChange={set("sale_price")} /></Field>
          <Field label="Canal (tarifas)"><Select value={channel} onChange={(e) => setChannel(e.target.value)}>{(cfg.data?.channels ?? []).map((ch: any) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}</Select></Field>
          <Field label="Taxa marketplace (%)"><NumInput value={input.fee_pct} onChange={set("fee_pct")} placeholder="do canal" /></Field>
          <Field label="Tarifa fixa (R$)"><NumInput value={input.fixed_fee} onChange={set("fixed_fee")} placeholder="do canal" /></Field>
          <Field label="Embalagem (R$)"><NumInput value={input.packaging} onChange={set("packaging")} placeholder="do cadastro" /></Field>
          <Field label="Frete vendedor (R$)"><NumInput value={input.shipping} onChange={set("shipping")} placeholder="do canal" /></Field>
          <Field label="Outros custos (R$)"><NumInput value={input.other_costs} onChange={set("other_costs")} /></Field>
          <Field label="Publicidade (%)"><NumInput value={input.ads_pct} onChange={set("ads_pct")} placeholder="do cadastro" /></Field>
          <Field label="Impostos (%)"><NumInput value={input.tax_pct} onChange={set("tax_pct")} placeholder="do cadastro" /></Field>
          <Field label="Cenários (unidades)" className="col-span-2"><Input value={volumes} onChange={(e) => setVolumes(e.target.value)} /></Field>
        </div>
        <Button variant="primary" className="mt-3 w-full" loading={busy} icon={<Calculator className="size-4" />} onClick={run}>Calcular</Button>
        <ErrorBox error={err} />
        {canOperate(user) && c && (
          <div className="mt-4 border-t border-line pt-3">
            <Field label="Salvar como ficha de custos do produto"><Select value={saveTo} onChange={(e) => setSaveTo(e.target.value)}><option value="">Selecione…</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Button size="sm" className="mt-2" icon={<Save className="size-3.5" />} disabled={!saveTo} onClick={async () => { try { const r = await api("/finance/calc3d/save", { body: { product_id: Number(saveTo), input } }); toast(r.missing.length ? `Salvo. Pendente: ${r.missing.join(", ")}` : "Ficha de custos salva"); } catch (e) { toast((e as Error).message, "bad"); } }}>Salvar no produto</Button>
          </div>
        )}
      </Card>
      <div className="min-w-0 space-y-4">
        {c && !c.complete && (
          <div className="flex gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
            <div><b>Itens de custo não informados (considerados R$ 0 até serem cadastrados):</b> {c.missing.join(", ")}. Cadastre-os na aba “Cadastro de custos”.</div>
          </div>
        )}
        {c && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[["Custo de produção", brl(c.production_cost)], ["Custo variável total", brl(c.total_variable_cost)], ["Margem de contribuição", brl(c.contribution_margin)], ["Margem", pct(c.margin_pct)],
                ["Preço mínimo", brl(c.min_price)], ["Preço recomendado", brl(c.recommended_price)], ["Preço promocional", brl(c.promo_price)], ["Lucro por hora de impressão", brl(c.profit_per_print_hour)]].map(([l, v], i) => (
                <div key={l} className={`rounded-xl border p-3 ${i === 2 ? (c.contribution_margin < 0 ? "border-bad/40 bg-bad-soft" : "border-brand/40 bg-brand-soft") : "border-line bg-surface"}`}><div className="text-[11px] text-ink-3">{l}</div><div className="text-lg font-semibold num">{v}</div></div>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Composição do custo por unidade">
                <div className="space-y-1.5 text-sm">
                  {[["Filamento", c.filament_cost, `${c.filament_price_per_kg ? brl(c.filament_price_per_kg) + "/kg" : "preço não cadastrado"}`], ["Energia", c.energy_cost], ["Depreciação", c.depreciation_cost], ["Manutenção", c.maintenance_cost], ["Mão de obra", c.labor_cost], ["Acabamento", c.finishing_cost], ["Embalagem", c.packaging_cost], ["Outros", c.other_costs], ["Frete", c.shipping_cost], ["Taxas do marketplace", c.marketplace_fees], ["Publicidade", c.ads_cost], ["Impostos", c.taxes]].map(([l, v, h]) => (
                    <div key={l as string} className="flex justify-between border-b border-line/50 pb-1 last:border-0"><span className="text-ink-2">{l}{h && <span className="ml-1 text-[10px] text-ink-3">({h})</span>}</span><span className="num">{brl(v as number)}</span></div>
                  ))}
                  <div className="flex justify-between pt-1 font-semibold"><span>Total variável</span><span className="num">{brl(c.total_variable_cost)}</span></div>
                </div>
              </Card>
              <Card title="Ponto de equilíbrio" subtitle="Custos fixos mensais ÷ margem de contribuição">
                {c.monthly_fixed_costs === null ? <Pending>Cadastre os custos fixos mensais no “Cadastro de custos”.</Pending> : c.break_even_units === null ? <p className="text-sm text-bad">Margem de contribuição não positiva: não há ponto de equilíbrio a este preço.</p> : (
                  <div><div className="text-3xl font-semibold num">{int(c.break_even_units)} un./mês</div><p className="mt-1 text-xs text-ink-3">para cobrir {brl(c.monthly_fixed_costs)} de custos fixos ({brl(c.break_even_units * c.inputs.sale_price)} de faturamento).</p></div>
                )}
              </Card>
            </div>
            <Card title="Simulador de cenários">
              <Table rows={res.scenarios} rowKey={(r: any) => r.units} cols={[
                { key: "units", header: "Unidades", align: "right", render: (r: any) => int(r.units) },
                { key: "revenue", header: "Faturamento", align: "right", render: (r: any) => brl(r.revenue) },
                { key: "variable_costs", header: "Custos variáveis", align: "right", render: (r: any) => brl(r.variable_costs) },
                { key: "contribution", header: "Margem de contribuição", align: "right", render: (r: any) => <span className={r.contribution < 0 ? "text-bad" : "text-good"}>{brl(r.contribution)}</span> },
                { key: "after", header: "Após custos fixos", align: "right", render: (r: any) => (r.result_after_fixed === null ? "—" : brl(r.result_after_fixed)) },
                { key: "kg", header: "Filamento", align: "right", render: (r: any) => `${r.filament_kg.toLocaleString("pt-BR")} kg` },
                { key: "h", header: "Horas de máquina", align: "right", render: (r: any) => `${r.print_hours.toLocaleString("pt-BR")} h` },
                { key: "d", header: "Dias de máquina", align: "right", render: (r: any) => r.machine_days.toLocaleString("pt-BR") },
              ]} />
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function ConfigTab() {
  const user = useUser();
  const d = useApi<any>("/finance/cost-config");
  const [c, setC] = useState<any>(null);
  const [newMat, setNewMat] = useState("");
  const { toast, node } = useToast();
  useEffect(() => { if (d.data) setC(d.data.config); }, [d.data]);
  if (!c) return <Spinner />;
  const admin = isAdmin(user);
  // função (não componente) para não remontar o campo a cada tecla
  const F = (k: string, label: string, hint?: string) => <Field key={k} label={label} hint={hint}><NumInput disabled={!admin} value={c[k]} onChange={(v) => setC({ ...c, [k]: v })} /></Field>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {node}
      <Card title="Custos de produção" subtitle="Valores vazios = não informado (o sistema não presume)">
        <div className="mb-3 grid grid-cols-2 gap-3">
          {Object.entries(c.filament_price_per_kg).map(([m, v]) => <Field key={m} label={`Filamento ${m} (R$/kg)`} hint="vazio = média dos rolos em estoque"><NumInput disabled={!admin} value={v as number | null} onChange={(x) => setC({ ...c, filament_price_per_kg: { ...c.filament_price_per_kg, [m]: x } })} /></Field>)}
          {admin && <div className="col-span-2 flex gap-2"><Input placeholder="Outro material (ex.: TPU)" value={newMat} onChange={(e) => setNewMat(e.target.value.toUpperCase())} /><Button size="sm" disabled={!newMat} onClick={() => { setC({ ...c, filament_price_per_kg: { ...c.filament_price_per_kg, [newMat]: null } }); setNewMat(""); }}>Adicionar</Button></div>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {F("energy_kwh_price", "Energia (R$/kWh)")}
          {F("printer_power_watts", "Consumo médio da impressora (W)")}
          {F("depreciation_per_hour", "Depreciação (R$/h de máquina)", "valor da máquina ÷ vida útil em horas")}
          {F("maintenance_per_hour", "Manutenção (R$/h de máquina)")}
          {F("labor_per_hour", "Mão de obra (R$/h)")}
          {F("labor_minutes_per_unit", "Mão de obra por unidade (min)")}
          {F("finishing_per_unit", "Acabamento (R$/un.)")}
          {F("packaging_per_unit", "Embalagem (R$/un.)")}
          {F("failure_rate_pct", "Perdas/falhas (%)")}
        </div>
      </Card>
      <Card title="Venda, impostos e metas de margem">
        <div className="grid grid-cols-2 gap-3">
          {F("tax_pct", "Impostos sobre a venda (%)")}
          {F("ads_pct", "Publicidade (% do preço)")}
          {F("seller_shipping_per_unit", "Frete suportado pelo vendedor (R$/un.)")}
          {F("monthly_fixed_costs", "Custos fixos mensais (R$)")}
          {F("target_margin_pct", "Margem-alvo (preço recomendado, %)")}
          {F("promo_margin_pct", "Margem mínima em promoção (%)")}
        </div>
        {admin ? <Button variant="primary" className="mt-4" onClick={async () => { try { await api("/finance/cost-config", { method: "PUT", body: c }); toast("Cadastro de custos salvo"); d.reload(); } catch (e) { toast((e as Error).message, "bad"); } }}>Salvar cadastro de custos</Button> : <Notice>Somente administradores alteram custos.</Notice>}
      </Card>
      <Card title="Tarifas por canal" subtitle="Tarifas por anúncio podem ser definidas na central do Mercado Livre Seller" className="lg:col-span-2">
        <ChannelFees channels={d.data.channels} admin={admin} onSaved={() => { d.reload(); toast("Tarifas do canal salvas"); }} />
      </Card>
    </div>
  );
}

function ChannelFees({ channels, admin, onSaved }: { channels: any[]; admin: boolean; onSaved: () => void }) {
  const [rows, setRows] = useState<any[]>(channels);
  useEffect(() => setRows(channels), [channels]);
  return (
    <div className="space-y-3">
      {rows.map((ch, i) => (
        <div key={ch.id} className="grid items-end gap-2 sm:grid-cols-[160px_1fr_1fr_1fr_auto]">
          <div className="text-sm font-medium">{ch.name}{ch.fee_pct === null && <Badge tone="warn" className="ml-2">não configurado</Badge>}</div>
          <Field label="Taxa (%)"><NumInput disabled={!admin} value={ch.fee_pct} onChange={(v) => setRows(rows.map((r, j) => (j === i ? { ...r, fee_pct: v } : r)))} /></Field>
          <Field label="Tarifa fixa (R$)"><NumInput disabled={!admin} value={ch.fixed_fee} onChange={(v) => setRows(rows.map((r, j) => (j === i ? { ...r, fixed_fee: v } : r)))} /></Field>
          <Field label="Frete médio (R$)"><NumInput disabled={!admin} value={ch.shipping_cost} onChange={(v) => setRows(rows.map((r, j) => (j === i ? { ...r, shipping_cost: v } : r)))} /></Field>
          {admin && <Button size="sm" onClick={async () => { await api(`/channels/${ch.id}`, { method: "PUT", body: { fee_pct: ch.fee_pct, fixed_fee: ch.fixed_fee, shipping_cost: ch.shipping_cost } }); onSaved(); }}>Salvar</Button>}
        </div>
      ))}
      <Notice>No Mercado Livre a tarifa depende da categoria e do tipo de anúncio. Com a conta conectada, a “Rentabilidade real” usa as tarifas cobradas em cada pedido.</Notice>
    </div>
  );
}

function RankingTab() {
  const d = useApi<any[]>("/finance/ranking");
  if (d.loading && !d.data) return <Spinner />;
  const rows = d.data ?? [];
  return (
    <Card title="Ranking de produtos por lucro por hora de máquina" subtitle="Calculado com peso, tempo, preço do anúncio ativo, custos cadastrados e tarifas">
      <Table rows={rows} rowKey={(r: any) => r.id} empty={<Pending>Nenhum produto cadastrado.</Pending>} cols={[
        { key: "name", header: "Produto", render: (r: any) => <div className="max-w-[280px]"><div className="truncate font-medium">{r.name}</div><div className="text-[11px] text-ink-3">{r.sku ?? "sem SKU"} · {r.material}</div></div> },
        { key: "price", header: "Preço", align: "right", render: (r: any) => brl(r.price) },
        { key: "cost", header: "Custo variável", align: "right", render: (r: any) => brl(r.calc?.total_variable_cost) },
        { key: "contrib", header: "Margem contrib.", align: "right", render: (r: any) => (r.calc ? <span className={r.calc.contribution_margin < 0 ? "text-bad" : ""}>{brl(r.calc.contribution_margin)}</span> : "—") },
        { key: "m", header: "Margem", align: "right", render: (r: any) => pct(r.calc?.margin_pct) },
        { key: "h", header: "Lucro/hora", align: "right", render: (r: any) => brl(r.calc?.profit_per_print_hour) },
        { key: "min", header: "Preço mínimo", align: "right", render: (r: any) => brl(r.calc?.min_price) },
        { key: "p", header: "Pendências", render: (r: any) => (r.pending?.length ? <span className="text-[11px] text-warn">{r.pending.slice(0, 3).join(", ")}{r.pending.length > 3 ? "…" : ""}</span> : <Badge tone="good">completo</Badge>) },
      ]} />
    </Card>
  );
}

function DreTab() {
  const user = useUser();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const d = useApi<any>(`/finance/dre?month=${month}`);
  const exp = useApi<any[]>(`/expenses?month=${month}`);
  const [f, setF] = useState<any>({ date: new Date().toISOString().slice(0, 10), category: "", description: "", amount: null, recurring: false });
  const [del, setDel] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      <Card title="DRE gerencial" action={<div className="flex items-center gap-2"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-8 w-40" /><ExportButtons path={`/finance/dre?month=${month}`} label="" /></div>}>
        {d.loading && !d.data ? <Spinner /> : d.data && (
          <div className="space-y-1 text-sm">
            {d.data.lines.map((l: any) => (
              <div key={l.key} className={`flex items-center justify-between gap-3 border-b border-line/50 py-1.5 ${l.label.startsWith("(=)") ? "font-semibold" : ""}`}>
                <span>{l.label}<span className="ml-2 text-[10px] font-normal text-ink-3">{l.source}</span></span>
                <span className={`num ${l.value === null ? "text-ink-3" : l.value < 0 ? "text-bad" : ""}`}>{l.value === null ? "pendente" : brl(l.value)}</span>
              </div>
            ))}
            <p className="pt-2 text-[11px] text-ink-3">Margem operacional: {d.data.margin_pct === null ? "pendente" : pct(d.data.margin_pct)} · cobertura de custos: {d.data.cost_coverage_pct === null ? "—" : pct(d.data.cost_coverage_pct, 0)}. Linhas pendentes não são zeradas: faltam dados.</p>
          </div>
        )}
      </Card>
      <Card title="Despesas operacionais">
        {canOperate(user) && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            <Input placeholder="Categoria (ex.: Aluguel)" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
            <Input placeholder="Descrição" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <NumInput placeholder="Valor (R$)" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
            <Button className="col-span-2" disabled={!f.category || !f.amount} onClick={async () => { setErr(null); try { await api("/expenses", { body: { ...f, description: f.description || undefined } }); setF({ ...f, description: "", amount: null }); exp.reload(); d.reload(); } catch (e) { setErr(e as Error); } }}>Lançar despesa</Button>
          </div>
        )}
        <ErrorBox error={err} />
        {(exp.data ?? []).length === 0 ? <p className="text-xs text-ink-3">Nenhuma despesa lançada no mês.</p> : (
          <ul className="space-y-1.5 text-xs">{exp.data!.map((e) => <li key={e.id} className="flex items-center justify-between gap-2"><span>{date(e.date)} · <b>{e.category}</b> {e.description}</span><span className="flex items-center gap-2 num">{brl(e.amount)}{canOperate(user) && <button className="text-ink-3 hover:text-bad" onClick={() => setDel(e)} aria-label="Excluir">×</button>}</span></li>)}</ul>
        )}
      </Card>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title="Excluir despesa" confirmLabel="Excluir" onConfirm={async () => { await api(`/expenses/${del.id}`, { method: "DELETE", body: { confirm: true } }); exp.reload(); d.reload(); }}>Excluir {del?.category} de {brl(del?.amount)}?</ConfirmDialog>
    </div>
  );
}
