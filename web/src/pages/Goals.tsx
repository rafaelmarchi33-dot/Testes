import { useState } from "react";
import { Target, Plus, AlertTriangle } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { useGlobal } from "../lib/global.tsx";
import { useUser, canOperate, isAdmin } from "../components/Layout.tsx";
import { Card, PageHeader, Button, Input, Field, NumInput, ErrorBox, Spinner, Badge, Table, ConfirmDialog, useToast, Notice, ExportButtons } from "../components/ui.tsx";
import { GoalChart, Ring } from "../components/charts.tsx";
import { brl, int, pct, date } from "../lib/format.ts";

export default function Goals() {
  const g = useGlobal();
  const user = useUser();
  const prog = useApi<any>(`/goals/progress?channel=${g.channel}`);
  const [opts, setOpts] = useState<any>({ goal: null, units_per_order: null, minutes: null, grams: null, acos: null, tickets: "50,60,80,100,120" });
  const qs = Object.entries(opts).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  const sim = useApi<any>(`/goals/simulation?${qs}`);
  const goals = useApi<any[]>("/goals");
  const company = useApi<any>("/company");
  const [ms, setMs] = useState<any>({ name: "", target_revenue: null, deadline: "" });
  const [del, setDel] = useState<any>(null);
  const [newGoal, setNewGoal] = useState<number | null>(null);
  const { toast, node } = useToast();
  const p = prog.data;
  return (
    <>
      {node}
      <PageHeader title="Metas e crescimento" subtitle="Meta principal: R$ 20.000/mês de faturamento bruto — trajetória, simulações e capacidade necessária" actions={<ExportButtons path="/goals/export" />} />
      <ErrorBox error={prog.error} />
      {prog.loading && !p ? <Spinner /> : p && (
        <div className="space-y-4">
          {p.trajectory_pct !== null && p.trajectory_pct < 90 && (
            <div className="flex gap-2 rounded-xl border border-bad/30 bg-bad-soft p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" />
              <div><b>Abaixo da trajetória da meta.</b> {brl(p.revenue)} faturados contra {brl(p.expected_to_date)} esperados até hoje ({pct(p.trajectory_pct, 0)}). Necessário {brl(p.needed_per_day)}/dia nos {p.remaining_days} dias restantes.</div></div>
          )}
          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            <Card className="glow-card" title={`Meta de ${p.month}`}>
              <div className="flex flex-col items-center"><Ring pct={p.progress_pct} size={160} /></div>
              <div className="mt-3 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-ink-3">Meta</span><b className="num">{brl(p.goal)}</b></div>
                <div className="flex justify-between"><span className="text-ink-3">Faturado</span><b className="num">{brl(p.revenue)}</b></div>
                {p.from_reports > 0 && <div className="flex justify-between"><span className="text-ink-3">· de relatórios importados</span><span className="num">{brl(p.from_reports)}</span></div>}
                <div className="flex justify-between"><span className="text-ink-3">Ritmo observado</span><span className="num">{p.pace.daily_avg === null ? "—" : `${brl(p.pace.daily_avg)}/dia`}</span></div>
                <div className="text-[10px] text-ink-3">Base: {p.pace.basis}</div>
                <div className="flex justify-between"><span className="text-ink-3">Projeção do mês</span><span className="num">{brl(p.projection)} <Badge tone="warn">estimativa</Badge></span></div>
              </div>
              {isAdmin(user) && <div className="mt-4 flex gap-2"><NumInput placeholder={String(company.data?.monthly_goal ?? 20000)} value={newGoal} onChange={setNewGoal} /><Button size="sm" disabled={!newGoal} onClick={async () => { await api("/company", { method: "PUT", body: { monthly_goal: newGoal } }); setNewGoal(null); prog.reload(); sim.reload(); goals.reload(); toast("Meta atualizada"); }}>Alterar meta</Button></div>}
            </Card>
            <Card title="Trajetória até a meta" subtitle={p.projection_note}><GoalChart data={p.series} goal={p.goal} /></Card>
          </div>

          <Card title="Simulação por ticket médio" subtitle="Quanto é preciso vender, produzir e investir para atingir a meta">
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
              <Field label="Meta (R$)"><NumInput value={opts.goal} placeholder={String(p.goal)} onChange={(v) => setOpts({ ...opts, goal: v })} /></Field>
              <Field label="Tickets (R$)"><Input value={opts.tickets} onChange={(e) => setOpts({ ...opts, tickets: e.target.value })} /></Field>
              <Field label="Unidades/pedido"><NumInput value={opts.units_per_order} placeholder={sim.data ? String(sim.data.units_per_order) : ""} onChange={(v) => setOpts({ ...opts, units_per_order: v })} /></Field>
              <Field label="Minutos/unidade"><NumInput value={opts.minutes} placeholder={sim.data?.minutes_per_unit ? String(Math.round(sim.data.minutes_per_unit)) : "informe"} onChange={(v) => setOpts({ ...opts, minutes: v })} /></Field>
              <Field label="Gramas/unidade"><NumInput value={opts.grams} placeholder={sim.data?.grams_per_unit ? String(Math.round(sim.data.grams_per_unit)) : "informe"} onChange={(v) => setOpts({ ...opts, grams: v })} /></Field>
              <Field label="ACOS/ads (%)"><NumInput value={opts.acos} placeholder={sim.data?.acos_pct != null ? String(sim.data.acos_pct) : "informe"} onChange={(v) => setOpts({ ...opts, acos: v })} /></Field>
            </div>
            {sim.data && <>
              <Table rows={sim.data.rows} rowKey={(r: any) => r.ticket} cols={[
                { key: "t", header: "Ticket médio", render: (r: any) => <b>{brl(r.ticket)}</b> },
                { key: "o", header: "Pedidos/mês", align: "right", render: (r: any) => int(r.orders) },
                { key: "od", header: "Pedidos/dia", align: "right", render: (r: any) => r.orders_per_day.toFixed(1) },
                { key: "u", header: "Unidades/mês", align: "right", render: (r: any) => int(r.units) },
                { key: "d", header: "Faturamento/dia", align: "right", render: (r: any) => brl(r.daily_revenue) },
                { key: "w", header: "Faturamento/semana", align: "right", render: (r: any) => brl(r.weekly_revenue) },
                { key: "h", header: "Horas de impressão", align: "right", render: (r: any) => (r.print_hours === null ? "—" : `${int(r.print_hours)} h`) },
                { key: "c", header: "Uso da capacidade", align: "right", render: (r: any) => (r.utilization_pct === null ? "—" : <span className={r.utilization_pct > 100 ? "font-semibold text-bad" : ""}>{pct(r.utilization_pct, 0)}</span>) },
                { key: "p", header: "Impressoras", align: "right", render: (r: any) => r.printers_needed ?? "—" },
                { key: "f", header: "Filamento", align: "right", render: (r: any) => (r.filament_kg === null ? "—" : `${r.filament_kg.toFixed(1)} kg`) },
                { key: "a", header: "Investimento ads", align: "right", render: (r: any) => brl(r.ad_investment) },
              ]} />
              <p className="mt-2 text-[11px] text-ink-3">Unidades por pedido: {sim.data.units_per_order} ({sim.data.units_per_order_source}) · capacidade atual: {int(sim.data.capacity_hours_month)} h/mês em {sim.data.machines} máquina(s).</p>
              {sim.data.notes.map((n: string) => <p key={n} className="text-[11px] text-warn">{n}</p>)}
            </>}
          </Card>

          <Card title="Metas intermediárias" subtitle="Marcos configuráveis no caminho até a meta principal">
            <div className="space-y-2">
              {(goals.data ?? []).map((m) => {
                const pr = Math.min(100, (p.revenue / m.target_revenue) * 100);
                return (
                  <div key={m.id} className="grid items-center gap-3 sm:grid-cols-[1fr_200px_auto]">
                    <div><div className="flex items-center gap-2 text-sm font-medium"><Target className="size-4 text-brand" />{m.name}{m.kind === "main" && <Badge tone="brand">principal</Badge>}</div><div className="text-[11px] text-ink-3">{brl(m.target_revenue)}/mês{m.deadline && ` · prazo ${date(m.deadline)}`}{m.notes && ` · ${m.notes}`}</div></div>
                    <div><div className="h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-brand" style={{ width: `${pr}%` }} /></div><div className="mt-0.5 text-right text-[10px] text-ink-3 num">{pct(pr, 0)} no mês atual</div></div>
                    {canOperate(user) && m.kind !== "main" ? <Button size="sm" variant="ghost" onClick={() => setDel(m)}>Remover</Button> : <span />}
                  </div>
                );
              })}
            </div>
            {canOperate(user) && <div className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-[1fr_160px_160px_auto]">
              <Input placeholder="Nome do marco" value={ms.name} onChange={(e) => setMs({ ...ms, name: e.target.value })} />
              <NumInput placeholder="Faturamento (R$)" value={ms.target_revenue} onChange={(v) => setMs({ ...ms, target_revenue: v })} />
              <Input type="date" value={ms.deadline} onChange={(e) => setMs({ ...ms, deadline: e.target.value })} />
              <Button icon={<Plus className="size-4" />} disabled={!ms.name || !ms.target_revenue} onClick={async () => { await api("/goals", { body: { ...ms, deadline: ms.deadline || null } }); setMs({ name: "", target_revenue: null, deadline: "" }); goals.reload(); }}>Adicionar</Button>
            </div>}
          </Card>
          <Notice>Projeções e simulações são estimativas matemáticas a partir do histórico registrado e das premissas informadas — não são garantias de resultado.</Notice>
        </div>
      )}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title="Remover meta" confirmLabel="Remover" onConfirm={async () => { await api(`/goals/${del.id}`, { method: "DELETE", body: { confirm: true } }); goals.reload(); }}>Remover “{del?.name}”?</ConfirmDialog>
    </>
  );
}
