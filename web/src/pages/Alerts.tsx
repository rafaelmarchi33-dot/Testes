import { useState } from "react";
import { Link } from "react-router";
import { Bell, CheckCircle2, AlertOctagon, AlertTriangle, Lightbulb, Info, RefreshCw } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, PageHeader, Spinner, ErrorBox, Empty, Tabs, Button, Badge, cx } from "../components/ui.tsx";
import { relative } from "../lib/format.ts";
import { useUser, canOperate, isAdmin } from "../components/Layout.tsx";
import { Select, NumInput, Table } from "../components/ui.tsx";

const SEV = {
  critical: { icon: <AlertOctagon className="size-4" />, cls: "text-bad bg-bad-soft", label: "Crítico" },
  warning: { icon: <AlertTriangle className="size-4" />, cls: "text-warn bg-warn-soft", label: "Atenção" },
  opportunity: { icon: <Lightbulb className="size-4" />, cls: "text-good bg-good-soft", label: "Oportunidade" },
  info: { icon: <Info className="size-4" />, cls: "text-info bg-info-soft", label: "Informativo" },
} as const;

const link = (a: any) => a.entity === "listing" ? `/seller?id=${a.entity_id}` : a.entity === "filament" || a.entity === "production_order" ? "/fabrica" : a.entity === "opportunity" ? `/radar?id=${a.entity_id}` : a.entity === "campaign" ? "/marketing" : a.type === "below_goal" ? "/metas" : a.entity === "period_report" ? "/" : a.entity === "order" ? `/pedidos?q=${a.entity_id}` : a.entity === "product" ? "/estoque" : a.type === "unanswered_questions" ? "/perguntas" : a.type === "ml_reauth" ? "/integracoes" : null;

export default function Alerts() {
  const user = useUser();
  const [filter, setFilter] = useState("active");
  const { data, error, loading, reload } = useApi<any[]>(`/alerts${filter === "resolved" ? "?status=resolved" : ""}`);
  const [sev, setSev] = useState<string>("all");
  const [view, setView] = useState<"alerts" | "rules">("alerts");
  const rows = (data ?? []).filter((a) => sev === "all" || a.severity === sev);
  const update = async (id: number, status: string) => { await api(`/alerts/${id}`, { method: "PATCH", body: { status } }); reload(); };
  return (
    <>
      <PageHeader title="Central de alertas" subtitle="Monitoramento contínuo da loja: estoque, desempenho, margens, prazos, perguntas e oportunidades."
        actions={<>
          {canOperate(user) && <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={async () => { await api("/alerts/evaluate", { body: {} }); reload(); }}>Reavaliar</Button>}
          {canOperate(user) && <Button size="sm" onClick={async () => { await api("/alerts/read-all", { body: {} }); reload(); }}>Marcar todos como lidos</Button>}
        </>} />
      <div className="mb-4"><Tabs value={view} onChange={setView} items={[{ value: "alerts", label: "Alertas" }, { value: "rules", label: "Regras, limites e prioridades" }]} /></div>
      {view === "rules" ? <Rules admin={isAdmin(user)} onSaved={reload} /> : <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Tabs value={filter} onChange={setFilter} items={[{ value: "active", label: "Ativos" }, { value: "resolved", label: "Resolvidos" }]} />
        <Tabs value={sev} onChange={setSev} items={[{ value: "all", label: "Todos" }, ...Object.entries(SEV).map(([k, v]) => ({ value: k, label: v.label }))]} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : !rows.length ? <Card><Empty icon={<Bell className="size-5" />} title="Nenhum alerta">Tudo certo por aqui.</Empty></Card> : (
        <div className="space-y-2">
          {rows.map((a) => {
            const s = SEV[a.severity as keyof typeof SEV];
            const to = link(a);
            return (
              <div key={a.id} className={cx("flex items-start gap-3 rounded-xl border border-line bg-surface p-4 animate-in", a.status === "open" && "border-l-4", a.status === "open" && a.severity === "critical" && "border-l-bad", a.status === "open" && a.severity === "warning" && "border-l-warn", a.status === "open" && a.severity === "opportunity" && "border-l-good", a.status === "open" && a.severity === "info" && "border-l-info")}>
                <span className={cx("rounded-lg p-2", s.cls)}>{s.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{a.title}</span>{a.status === "open" && <Badge tone="brand">novo</Badge>}<span className="text-[11px] text-ink-3">{relative(a.updated_at)}</span></div>
                  <p className="mt-0.5 text-sm text-ink-2">{a.message}</p>
                  {to && <Link to={to} className="mt-1 inline-block text-xs text-brand hover:underline">Ver detalhes →</Link>}
                </div>
                {canOperate(user) && a.status !== "resolved" && (
                  <div className="flex shrink-0 gap-1">
                    {a.status === "open" && <Button size="sm" variant="ghost" onClick={() => update(a.id, "read")}>Lido</Button>}
                    <Button size="sm" variant="ghost" icon={<CheckCircle2 className="size-3.5" />} onClick={() => update(a.id, "resolved")}>Resolver</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </>}
    </>
  );
}

function Rules({ admin, onSaved }: { admin: boolean; onSaved: () => void }) {
  const { data, reload } = useApi<any[]>("/alert-rules");
  const [edits, setEdits] = useState<Record<string, any>>({});
  const save = async (r: any) => {
    const e = { ...r, ...edits[r.type] };
    await api(`/alert-rules/${r.type}`, { method: "PUT", body: { enabled: !!e.enabled, severity: e.severity || null, threshold: e.threshold ?? null } });
    await api("/alerts/evaluate", { body: {} });
    setEdits((x) => { const { [r.type]: _, ...rest } = x; return rest; }); reload(); onSaved();
  };
  if (!data) return <Spinner />;
  return (
    <Card title="Regras de alerta" subtitle="Ative, defina a prioridade e ajuste os limites. As regras são reavaliadas a cada 30 minutos e após cada alteração.">
      <Table rows={data} rowKey={(r: any) => r.type} cols={[
        { key: "label", header: "Regra", render: (r: any) => <span className="font-medium">{r.label}</span> },
        { key: "enabled", header: "Ativa", render: (r: any) => <input type="checkbox" disabled={!admin} checked={!!(edits[r.type]?.enabled ?? r.enabled)} onChange={(e) => setEdits({ ...edits, [r.type]: { ...edits[r.type], enabled: e.target.checked } })} /> },
        { key: "severity", header: "Prioridade", render: (r: any) => <Select disabled={!admin} className="h-8 w-36 text-xs" value={edits[r.type]?.severity ?? r.severity ?? ""} onChange={(e) => setEdits({ ...edits, [r.type]: { ...edits[r.type], severity: e.target.value } })}>
          <option value="">Padrão</option><option value="critical">Crítico</option><option value="warning">Atenção</option><option value="opportunity">Oportunidade</option><option value="info">Informativo</option></Select> },
        { key: "threshold", header: "Limite", render: (r: any) => r.threshold_label ? <div className="flex items-center gap-2"><NumInput disabled={!admin} className="h-8 w-24 text-xs" value={edits[r.type]?.threshold ?? r.threshold} onChange={(v) => setEdits({ ...edits, [r.type]: { ...edits[r.type], threshold: v } })} /><span className="text-[11px] text-ink-3">{r.threshold_label}</span></div> : <span className="text-[11px] text-ink-3">—</span> },
        { key: "save", header: "", render: (r: any) => admin && edits[r.type] && <Button size="sm" onClick={() => save(r)}>Salvar</Button> },
      ]} />
    </Card>
  );
}
