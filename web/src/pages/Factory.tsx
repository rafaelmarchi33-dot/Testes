import { useState } from "react";
import { Plus, Wrench, Printer, Brain, ArrowRight } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { useUser, canOperate, isAdmin } from "../components/Layout.tsx";
import { Card, PageHeader, Button, Input, Select, Field, NumInput, Textarea, ErrorBox, Spinner, Badge, Tabs, Table, Pending, Modal, ConfirmDialog, useToast, ExportButtons, Notice, cx } from "../components/ui.tsx";
import { Markdown } from "../lib/markdown.tsx";
import { brl, int, date } from "../lib/format.ts";

const PO_STATUS: Record<string, { label: string; tone: any }> = {
  waiting: { label: "Aguardando", tone: "neutral" }, scheduled: { label: "Programada", tone: "info" }, printing: { label: "Imprimindo", tone: "brand" },
  finishing: { label: "Em acabamento", tone: "warn" }, packing: { label: "Embalando", tone: "warn" }, done: { label: "Concluída", tone: "good" }, cancelled: { label: "Cancelada", tone: "bad" },
};
const NEXT: Record<string, string[]> = { waiting: ["scheduled", "printing", "cancelled"], scheduled: ["printing", "waiting", "cancelled"], printing: ["finishing", "packing", "done", "cancelled"], finishing: ["packing", "done", "cancelled"], packing: ["done", "cancelled"], done: [], cancelled: [] };
const PRIO: Record<string, string> = { urgent: "Urgente", high: "Alta", normal: "Normal", low: "Baixa" };
const M_STATUS: Record<string, string> = { available: "Disponível", printing: "Imprimindo", maintenance: "Manutenção", inactive: "Inativa" };
const hm = (min: number | null | undefined) => (min == null ? "—" : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`);

export default function FactoryPage() {
  const [tab, setTab] = useState<"orders" | "planner" | "machines" | "filaments">("orders");
  return (
    <>
      <PageHeader title="Mind Factory" subtitle="Controle industrial da impressão 3D: máquinas, ordens de produção, planejamento e filamentos"
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: "orders", label: "Ordens de produção" }, { value: "planner", label: "Planejamento inteligente" }, { value: "machines", label: "Máquinas" }, { value: "filaments", label: "Filamentos" }]} />} />
      {tab === "orders" && <Orders />}
      {tab === "planner" && <Planner />}
      {tab === "machines" && <Machines />}
      {tab === "filaments" && <Filaments />}
    </>
  );
}

const blankPO = { product_id: null as number | null, name: "", sku: "", quantity: 1, material: "PLA", color: "", filament_id: null as number | null, machine_id: null as number | null, weight_g_unit: null, minutes_unit: null, units_per_plate: null, start_date: "", due_date: "", priority: "normal", sale_price_unit: null, notes: "" };

function Orders() {
  const user = useUser();
  const [status, setStatus] = useState("open");
  const list = useApi<any[]>(`/factory/orders?status=${status}`);
  const products = useApi<any[]>("/products");
  const machines = useApi<any[]>("/factory/machines");
  const filaments = useApi<any[]>("/factory/filaments");
  const [form, setForm] = useState<any>(null);
  const [move, setMove] = useState<{ po: any; to: string } | null>(null);
  const [failed, setFailed] = useState(0);
  const { toast, node } = useToast();
  const save = async () => {
    const body = { ...form, sku: form.sku || null, color: form.color || null, start_date: form.start_date || null, due_date: form.due_date || null, notes: form.notes || null, material: form.material || null };
    try { if (form.id) await api(`/factory/orders/${form.id}`, { method: "PUT", body }); else await api("/factory/orders", { body }); setForm(null); list.reload(); toast("Ordem salva"); } catch (e) { toast((e as Error).message, "bad"); }
  };
  return (
    <>
      {node}
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Em aberto</option><option value="all">Todas</option>{Object.entries(PO_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
          <div className="ml-auto flex gap-2"><ExportButtons path="/factory/export?kind=orders" />{canOperate(user) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ ...blankPO })}>Nova ordem</Button>}</div>
        </div>
        <div className="p-5">
          {list.loading && !list.data ? <Spinner /> : (
            <Table rows={list.data ?? []} rowKey={(r: any) => r.id} empty={<Pending title="Nenhuma ordem">Crie ordens de produção para controlar fila, filamento e prazos.</Pending>} cols={[
              { key: "id", header: "OP", render: (r: any) => <span className="font-mono text-xs">#{r.id}</span> },
              { key: "name", header: "Produto", render: (r: any) => <div className="max-w-[220px]"><div className="truncate font-medium">{r.name}</div><div className="text-[11px] text-ink-3">{r.sku ?? "—"} · {r.material ?? "?"} {r.color ?? ""}</div></div> },
              { key: "q", header: "Qtd.", align: "right", render: (r: any) => int(r.quantity) },
              { key: "w", header: "Por unidade", align: "right", render: (r: any) => <span className="whitespace-nowrap">{r.weight_g_unit ? `${r.weight_g_unit} g` : "—"} · {hm(r.minutes_unit)}</span> },
              { key: "tt", header: "Total", align: "right", render: (r: any) => <span className="whitespace-nowrap">{hm(r.total_minutes)}{r.total_grams ? ` · ${int(r.total_grams)} g` : ""}</span> },
              { key: "due", header: "Início → prazo", render: (r: any) => <div className="whitespace-nowrap text-xs"><div className="text-ink-3">{date(r.start_date)}</div><div className={r.due_date && r.due_date < new Date().toISOString().slice(0, 10) && !["done", "cancelled"].includes(r.status) ? "font-semibold text-bad" : ""}>{date(r.due_date)}</div><div className="text-[10px] text-ink-3">{r.machine_name ?? "máquina automática"}</div></div> },
              { key: "p", header: "Prioridade", render: (r: any) => <Badge tone={r.priority === "urgent" ? "bad" : r.priority === "high" ? "warn" : "neutral"}>{PRIO[r.priority]}</Badge> },
              { key: "s", header: "Status", render: (r: any) => <Badge tone={PO_STATUS[r.status]!.tone}>{PO_STATUS[r.status]!.label}</Badge> },
              { key: "a", header: "", render: (r: any) => canOperate(user) && (
                <div className="flex justify-end gap-1">
                  {NEXT[r.status]!.filter((s) => s !== "cancelled").slice(0, 2).map((s) => <Button key={s} size="sm" onClick={() => { setFailed(0); setMove({ po: r, to: s }); }} icon={<ArrowRight className="size-3" />}>{PO_STATUS[s]!.label}</Button>)}
                  {!["done", "cancelled"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => setForm({ ...blankPO, ...r })}>Editar</Button>}
                  {NEXT[r.status]!.includes("cancelled") && <Button size="sm" variant="ghost" className="text-bad" onClick={() => setMove({ po: r, to: "cancelled" })}>Cancelar</Button>}
                </div>
              ) },
            ]} />
          )}
        </div>
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `Editar OP #${form.id}` : "Nova ordem de produção"} wide footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" disabled={!form?.name || !form?.quantity} onClick={save}>Salvar</Button></>}>
        {form && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Produto cadastrado" className="sm:col-span-2"><Select value={form.product_id ?? ""} onChange={(e) => { const p = (products.data ?? []).find((x) => x.id === Number(e.target.value)); setForm({ ...form, product_id: p?.id ?? null, name: p?.name ?? form.name, sku: p?.sku ?? form.sku, weight_g_unit: p?.weight_g ?? form.weight_g_unit, minutes_unit: p?.print_minutes ?? form.minutes_unit, material: p?.material ?? form.material }); }}>
              <option value="">— avulso —</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="SKU"><Input value={form.sku ?? ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
            <Field label="Nome" className="sm:col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Quantidade"><NumInput value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v ?? 1 })} /></Field>
            <Field label="Material"><Select value={form.material ?? ""} onChange={(e) => setForm({ ...form, material: e.target.value })}><option>PLA</option><option>PETG</option></Select></Field>
            <Field label="Cor"><Input value={form.color ?? ""} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
            <Field label="Rolo de filamento"><Select value={form.filament_id ?? ""} onChange={(e) => setForm({ ...form, filament_id: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{(filaments.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.material} {f.color} {f.brand} ({Math.round(f.available_g)} g)</option>)}</Select></Field>
            <Field label="Peso por unidade (g)"><NumInput value={form.weight_g_unit} onChange={(v) => setForm({ ...form, weight_g_unit: v })} /></Field>
            <Field label="Tempo por unidade (min)"><NumInput value={form.minutes_unit} onChange={(v) => setForm({ ...form, minutes_unit: v })} /></Field>
            <Field label="Unidades por mesa"><NumInput value={form.units_per_plate} onChange={(v) => setForm({ ...form, units_per_plate: v })} /></Field>
            <Field label="Máquina"><Select value={form.machine_id ?? ""} onChange={(e) => setForm({ ...form, machine_id: e.target.value ? Number(e.target.value) : null })}><option value="">automática</option>{(machines.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
            <Field label="Data de início"><Input type="date" value={form.start_date ?? ""} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
            <Field label="Prazo"><Input type="date" value={form.due_date ?? ""} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            <Field label="Prioridade"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{Object.entries(PRIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Preço de venda/un. (para lucro/hora)"><NumInput value={form.sale_price_unit} onChange={(v) => setForm({ ...form, sale_price_unit: v })} /></Field>
            <div className="flex items-end text-xs text-ink-3">Tempo total: <b className="ml-1 text-ink">{hm(form.minutes_unit ? form.minutes_unit * form.quantity : null)}</b> · Filamento: <b className="ml-1 text-ink">{form.weight_g_unit ? `${int(form.weight_g_unit * form.quantity)} g` : "—"}</b></div>
            <Field label="Observações" className="sm:col-span-3"><Textarea className="min-h-14" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!move} onClose={() => setMove(null)} danger={move?.to === "cancelled"} title={`OP #${move?.po.id}: ${move ? PO_STATUS[move.to]!.label : ""}`} confirmLabel="Confirmar"
        onConfirm={async () => { const r = await api(`/factory/orders/${move!.po.id}/status`, { body: { status: move!.to, failed_units: move!.to === "done" ? failed : undefined, confirm: true } }); toast(r.effects.length ? r.effects.join(" · ") : "Status atualizado"); list.reload(); }}>
        {move?.to === "done" ? (
          <div className="space-y-2"><p>Ao concluir: o filamento consumido é baixado do rolo, as horas são somadas à máquina e as unidades boas entram no estoque (produtos sem produção sob demanda).</p>
            <Field label="Unidades com falha (descartadas)"><NumInput value={failed} onChange={(v) => setFailed(v ?? 0)} /></Field></div>
        ) : <p>Mudar “{move?.po.name}” de {move ? PO_STATUS[move.po.status]!.label : ""} para {move ? PO_STATUS[move.to]!.label : ""}?</p>}
      </ConfirmDialog>
    </>
  );
}

function Planner() {
  const p = useApi<any>("/factory/planner");
  const [ai, setAi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  if (p.loading && !p.data) return <Spinner />;
  const d = p.data;
  if (!d) return <ErrorBox error={p.error} />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Horas na fila", `${d.total_hours.toFixed(1)} h`], ["Ordens planejadas", int(d.schedule.length)], ["Com risco de atraso", int(d.at_risk.length)], ["Lotes possíveis", int(d.batches.length)]].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-line bg-surface p-3"><div className="text-[11px] text-ink-3">{l}</div><div className="text-lg font-semibold num">{v}</div></div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Sequência recomendada" subtitle="Prazo primeiro, depois prioridade e lucro por hora de máquina">
          {d.schedule.length === 0 ? <Pending>Nenhuma ordem aguardando impressão.</Pending> : (
            <ol className="space-y-2">{d.schedule.map((s: any, i: number) => (
              <li key={s.id} className={cx("flex items-center gap-3 rounded-lg border p-2.5 text-sm", s.risk ? "border-bad/40 bg-bad-soft" : "border-line")}>
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1"><div className="truncate font-medium">OP #{s.id} · {s.name} × {s.quantity}</div>
                  <div className="text-[11px] text-ink-3">{s.machine ?? "sem máquina"} · {hm(s.remaining_minutes)} · término estimado {date(s.est_finish)} · prazo {date(s.due_date)}{s.profit_per_hour != null && ` · ${brl(s.profit_per_hour)}/h`}</div>
                  {s.risk && <div className="text-[11px] font-medium text-bad">Risco: {s.risk}</div>}</div>
              </li>))}</ol>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Filamento necessário">
            {d.filament_needs.length === 0 ? <p className="text-xs text-ink-3">Sem peso informado nas ordens.</p> : d.filament_needs.map((f: any) => (
              <div key={f.material + f.color} className="mb-2 text-xs"><div className="flex justify-between"><b>{f.material} {f.color ?? ""}</b><span className="num">{int(f.grams)} g / {int(f.available_g)} g</span></div>
                {f.shortfall_g > 0 && <div className="text-bad">Faltam {int(f.shortfall_g)} g — avaliar compra (nada é comprado automaticamente)</div>}</div>
            ))}
          </Card>
          <Card title="Lotes e aproveitamento de mesa">
            {d.batches.length === 0 && d.plate_tips.length === 0 ? <p className="text-xs text-ink-3">Nenhum lote identificado.</p> : <>
              {d.batches.map((b: any) => <div key={b.key} className="mb-2 text-xs"><b>{b.key}</b>: {b.orders.map((o: any) => `#${o.id} ${o.name} (${o.quantity})`).join(", ")} — mesma troca de filamento</div>)}
              {d.plate_tips.map((t: any) => <div key={t.id} className="text-xs">OP #{t.id}: {t.plates} mesa(s) com unidades agrupadas</div>)}
            </>}
          </Card>
          {d.missing_data.length > 0 && <Notice tone="warn">Ordens sem peso/tempo: {d.missing_data.map((m: any) => `#${m.id}`).join(", ")} — o planejamento fica incompleto.</Notice>}
        </div>
      </div>
      <Card title="Recomendação da IA" action={<Button loading={busy} icon={<Brain className="size-4" />} onClick={async () => { setBusy(true); setErr(null); try { setAi((await api("/factory/planner/ai", { body: {} })).analysis); } catch (e) { setErr(e as Error); } finally { setBusy(false); } }}>Pedir plano ao Mind AI</Button>}>
        <ErrorBox error={err} />
        {ai ? <div className="prose-ai text-sm"><Markdown text={ai} /></div> : <p className="text-xs text-ink-3">A IA analisa a fila, lotes, mesa (256×256 mm), filamento e prazos, priorizando lucro por hora de máquina.</p>}
      </Card>
    </div>
  );
}

const blankM = { name: "", model: "", technology: "FDM", nozzle_mm: 0.4, materials: ["PLA", "PETG"], build_volume: "", multicolor: "", status: "available", hours_worked: 0, hours_per_day: 16, power_watts: null, purchase_price: null, lifetime_hours: null, notes: "" };
function Machines() {
  const user = useUser();
  const list = useApi<any[]>("/factory/machines");
  const [form, setForm] = useState<any>(null);
  const [maint, setMaint] = useState<any>(null);
  const [mf, setMf] = useState<any>({ date: new Date().toISOString().slice(0, 10), type: "Preventiva", description: "", cost: null });
  const hist = useApi<any[]>(maint ? `/factory/machines/${maint.id}/maintenance` : null, [maint?.id]);
  const { toast, node } = useToast();
  const save = async () => { try { const body = { ...form, nozzle_mm: form.nozzle_mm || null, build_volume: form.build_volume || null, multicolor: form.multicolor || null, notes: form.notes || null }; if (form.id) await api(`/factory/machines/${form.id}`, { method: "PUT", body }); else await api("/factory/machines", { body }); setForm(null); list.reload(); } catch (e) { toast((e as Error).message, "bad"); } };
  return (
    <>
      {node}
      <div className="mb-3 flex justify-end">{canOperate(user) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ ...blankM })}>Cadastrar impressora</Button>}</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(list.data ?? []).map((m) => (
          <Card key={m.id}>
            <div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><Printer className="size-5" /></div>
              <div className="flex-1"><div className="font-semibold">{m.name}</div><div className="text-xs text-ink-3">{m.model} · {m.technology} · bico {m.nozzle_mm ?? "—"} mm</div></div>
              <Badge tone={m.status === "available" ? "good" : m.status === "printing" ? "brand" : m.status === "maintenance" ? "warn" : "neutral"}>{M_STATUS[m.status]}</Badge></div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              {[["Materiais", m.materials.join(", ") || "—"], ["Capacidade", m.build_volume ?? "—"], ["Multicolor", m.multicolor ?? "—"], ["Horas trabalhadas", `${(m.hours_worked ?? 0).toFixed(1)} h`], ["Horas úteis/dia", `${m.hours_per_day} h`], ["Potência", m.power_watts ? `${m.power_watts} W` : "não informada"], ["Ordens ativas", m.active_orders], ["Última manutenção", date(m.last_maintenance)]].map(([l, v]) => <div key={l as string} className="rounded-md bg-surface-2 p-2"><div className="text-ink-3">{l}</div><div className="truncate font-medium">{v}</div></div>)}
            </div>
            {m.notes && <p className="mt-2 text-[11px] text-ink-3">{m.notes}</p>}
            {canOperate(user) && <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => setForm({ ...blankM, ...m })}>Editar</Button><Button size="sm" icon={<Wrench className="size-3.5" />} onClick={() => setMaint(m)}>Manutenções</Button></div>}
          </Card>
        ))}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Editar impressora" : "Nova impressora"} wide footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" disabled={!form?.name || !form?.model} onClick={save}>Salvar</Button></>}>
        {form && <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Modelo"><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
          <Field label="Bico (mm)"><NumInput value={form.nozzle_mm} onChange={(v) => setForm({ ...form, nozzle_mm: v })} /></Field>
          <Field label="Materiais (separados por vírgula)"><Input value={form.materials.join(", ")} onChange={(e) => setForm({ ...form, materials: e.target.value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) })} /></Field>
          <Field label="Capacidade (volume)"><Input value={form.build_volume ?? ""} onChange={(e) => setForm({ ...form, build_volume: e.target.value })} /></Field>
          <Field label="Multicolor"><Input value={form.multicolor ?? ""} onChange={(e) => setForm({ ...form, multicolor: e.target.value })} /></Field>
          <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{Object.entries(M_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Horas trabalhadas"><NumInput value={form.hours_worked} onChange={(v) => setForm({ ...form, hours_worked: v ?? 0 })} /></Field>
          <Field label="Horas úteis por dia"><NumInput value={form.hours_per_day} onChange={(v) => setForm({ ...form, hours_per_day: v ?? 16 })} /></Field>
          <Field label="Potência média (W)"><NumInput value={form.power_watts} onChange={(v) => setForm({ ...form, power_watts: v })} /></Field>
          <Field label="Valor de compra (R$)"><NumInput value={form.purchase_price} onChange={(v) => setForm({ ...form, purchase_price: v })} /></Field>
          <Field label="Vida útil (h)"><NumInput value={form.lifetime_hours} onChange={(v) => setForm({ ...form, lifetime_hours: v })} /></Field>
          {form.purchase_price && form.lifetime_hours && <div className="text-xs text-ink-3 sm:col-span-3">Depreciação sugerida: <b className="text-ink">{brl(form.purchase_price / form.lifetime_hours)}/h</b> — informe no Financeiro › Cadastro de custos.</div>}
          <Field label="Notas" className="sm:col-span-3"><Textarea className="min-h-14" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>}
      </Modal>
      <Modal open={!!maint} onClose={() => setMaint(null)} title={`Manutenções — ${maint?.name ?? ""}`}>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={mf.date} onChange={(e) => setMf({ ...mf, date: e.target.value })} />
          <Select value={mf.type} onChange={(e) => setMf({ ...mf, type: e.target.value })}><option>Preventiva</option><option>Corretiva</option><option>Troca de bico</option><option>Limpeza</option><option>Calibração</option></Select>
          <Input className="col-span-2" placeholder="Descrição" value={mf.description} onChange={(e) => setMf({ ...mf, description: e.target.value })} />
          <NumInput placeholder="Custo (R$)" value={mf.cost} onChange={(v) => setMf({ ...mf, cost: v })} />
          <Button onClick={async () => { await api(`/factory/machines/${maint.id}/maintenance`, { body: { ...mf, description: mf.description || undefined } }); hist.reload(); list.reload(); setMf({ ...mf, description: "", cost: null }); }}>Registrar</Button>
        </div>
        <ul className="mt-4 space-y-1.5 text-xs">{(hist.data ?? []).map((h) => <li key={h.id}>{date(h.date)} · <b>{h.type}</b> {h.description} {h.cost != null && `· ${brl(h.cost)}`} <span className="text-ink-3">({h.hours_at?.toFixed(0)} h)</span></li>)}</ul>
      </Modal>
    </>
  );
}

const blankF = { brand: "", material: "PLA", color: "", total_g: 1000, available_g: 1000, min_g: 200, cost_per_kg: null, purchased_at: "", notes: "" };
function Filaments() {
  const user = useUser();
  const list = useApi<any[]>("/factory/filaments");
  const [form, setForm] = useState<any>(null);
  const [mv, setMv] = useState<any>(null);
  const [arch, setArch] = useState<any>(null);
  const { toast, node } = useToast();
  return (
    <>
      {node}
      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-line p-4"><ExportButtons path="/factory/export?kind=filaments" />{canOperate(user) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ ...blankF })}>Cadastrar rolo</Button>}</div>
        <div className="p-5">
          <Table rows={list.data ?? []} rowKey={(r: any) => r.id} empty={<Pending title="Nenhum filamento cadastrado">Cadastre os rolos com custo por quilo para calcular custos reais e alertas de reposição.</Pending>} cols={[
            { key: "m", header: "Material", render: (f: any) => <b>{f.material}</b> },
            { key: "c", header: "Cor", render: (f: any) => f.color ?? "—" },
            { key: "b", header: "Marca", render: (f: any) => f.brand ?? "—" },
            { key: "t", header: "Peso total", align: "right", render: (f: any) => `${int(f.total_g)} g` },
            { key: "a", header: "Disponível", align: "right", render: (f: any) => <div><span className={f.needs_restock ? "font-semibold text-bad" : ""}>{int(f.available_g)} g</span><div className="mt-1 h-1 w-24 rounded bg-surface-2"><div className={cx("h-1 rounded", f.needs_restock ? "bg-bad" : "bg-brand")} style={{ width: `${Math.min(100, (f.available_g / Math.max(1, f.total_g)) * 100)}%` }} /></div></div> },
            { key: "k", header: "Custo/kg", align: "right", render: (f: any) => brl(f.cost_per_kg) },
            { key: "cons", header: "Consumo 30d", align: "right", render: (f: any) => (f.consumed_30d ? `${int(f.consumed_30d)} g` : "—") },
            { key: "r", header: "Reposição", render: (f: any) => (f.needs_restock ? <Badge tone="bad">necessária</Badge> : <Badge tone="good">ok</Badge>) },
            { key: "x", header: "", render: (f: any) => canOperate(user) && <div className="flex justify-end gap-1"><Button size="sm" onClick={() => setMv({ f, type: "purchase", grams: null, reason: "" })}>Movimentar</Button><Button size="sm" variant="ghost" onClick={() => setForm({ ...blankF, ...f })}>Editar</Button><Button size="sm" variant="ghost" className="text-bad" onClick={() => setArch(f)}>Arquivar</Button></div> },
          ]} />
        </div>
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Editar rolo" : "Novo rolo de filamento"} footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" onClick={async () => { try { const body = { ...form, brand: form.brand || null, color: form.color || null, purchased_at: form.purchased_at || null, notes: form.notes || null }; if (form.id) await api(`/factory/filaments/${form.id}`, { method: "PUT", body }); else await api("/factory/filaments", { body }); setForm(null); list.reload(); } catch (e) { toast((e as Error).message, "bad"); } }}>Salvar</Button></>}>
        {form && <div className="grid grid-cols-2 gap-3">
          <Field label="Marca"><Input value={form.brand ?? ""} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
          <Field label="Material"><Select value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })}><option>PLA</option><option>PETG</option><option>TPU</option><option>ABS</option></Select></Field>
          <Field label="Cor"><Input value={form.color ?? ""} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
          <Field label="Custo por kg (R$)"><NumInput value={form.cost_per_kg} onChange={(v) => setForm({ ...form, cost_per_kg: v })} /></Field>
          {!form.id && <><Field label="Peso total (g)"><NumInput value={form.total_g} onChange={(v) => setForm({ ...form, total_g: v ?? 0 })} /></Field>
            <Field label="Peso disponível (g)"><NumInput value={form.available_g} onChange={(v) => setForm({ ...form, available_g: v ?? 0 })} /></Field></>}
          <Field label="Estoque mínimo (g)"><NumInput value={form.min_g} onChange={(v) => setForm({ ...form, min_g: v ?? 0 })} /></Field>
          <Field label="Data de compra"><Input type="date" value={form.purchased_at ?? ""} onChange={(e) => setForm({ ...form, purchased_at: e.target.value })} /></Field>
        </div>}
      </Modal>
      <ConfirmDialog open={!!mv} onClose={() => setMv(null)} title={`Movimentar ${mv?.f.material} ${mv?.f.color ?? ""}`} confirmLabel="Registrar movimentação"
        onConfirm={async () => { await api(`/factory/filaments/${mv.f.id}/movements`, { body: { type: mv.type, grams: Number(mv.grams), reason: mv.reason || undefined, confirm: true } }); list.reload(); toast("Movimentação registrada"); }}>
        {mv && <div className="grid grid-cols-2 gap-2">
          <Select value={mv.type} onChange={(e) => setMv({ ...mv, type: e.target.value })}><option value="purchase">Entrada (compra realizada)</option><option value="consumption">Consumo</option><option value="waste">Perda/desperdício</option><option value="adjust">Ajuste (+/−)</option></Select>
          <NumInput placeholder="Gramas" value={mv.grams} onChange={(v) => setMv({ ...mv, grams: v })} />
          <Input className="col-span-2" placeholder="Motivo" value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} />
          <p className="col-span-2 text-[11px] text-ink-3">O sistema apenas registra: compras de filamento nunca são feitas automaticamente.</p>
        </div>}
      </ConfirmDialog>
      <ConfirmDialog open={!!arch} onClose={() => setArch(null)} danger title="Arquivar rolo" confirmLabel="Arquivar" onConfirm={async () => { await api(`/factory/filaments/${arch.id}`, { method: "DELETE", body: { confirm: true } }); list.reload(); }}>Arquivar {arch?.material} {arch?.color}? O histórico é mantido.</ConfirmDialog>
    </>
  );
}

void isAdmin;
