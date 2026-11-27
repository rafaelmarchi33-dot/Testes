import { useState } from "react";
import { Play, CalendarClock, Eye } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { useUser, isAdmin, canOperate } from "../components/Layout.tsx";
import { Card, PageHeader, Button, Input, Select, Field, ErrorBox, Spinner, Badge, Modal, Notice, useToast } from "../components/ui.tsx";
import { Markdown } from "../lib/markdown.tsx";
import { dateTime } from "../lib/format.ts";

const WD = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const FREQ: Record<string, string> = { daily: "Diária", weekly: "Semanal", monthly_end: "Último dia do mês" };
const STATUS: Record<string, [string, any]> = { ok: ["Concluída", "good"], partial: ["Parcial", "warn"], failed: ["Falhou", "bad"], running: ["Executando", "info"] };

export default function Routines() {
  const user = useUser();
  const d = useApi<any>("/routines");
  const [edit, setEdit] = useState<any>(null);
  const [run, setRun] = useState<number | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast, node } = useToast();
  return (
    <>
      {node}
      <PageHeader title="Automações e rotina de diretoria" subtitle="Relatórios recorrentes calculados a partir dos dados reais, com comentário do Mind AI quando configurado" />
      {d.data && <Notice title="Agendamento:">{d.data.scheduler.note} IA {d.data.scheduler.ai ? "configurada" : "não configurada — as rotinas geram apenas os dados calculados"}. Opcionalmente, cada rotina pode enviar o resultado a um webhook (Zapier, Make, n8n…).</Notice>}
      <ErrorBox error={d.error} />
      {d.loading && !d.data ? <Spinner /> : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(d.data?.routines ?? []).map((r: any) => (
            <Card key={r.key}>
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><CalendarClock className="size-5" /></div>
                <div className="min-w-0 flex-1"><div className="font-semibold">{r.name}</div><div className="text-xs text-ink-3">{FREQ[r.frequency]}{r.frequency === "weekly" && ` · ${WD[r.weekday]}`} · {String(r.hour).padStart(2, "0")}h</div></div>
                <Badge tone={r.enabled ? "good" : "neutral"}>{r.enabled ? "Ativa" : "Pausada"}</Badge>
              </div>
              <p className="mt-2 text-xs text-ink-2">{r.description}</p>
              <div className="mt-3 space-y-1 text-[11px] text-ink-3">
                <div>Próxima execução: <span className="text-ink">{r.next_run_at ? dateTime(r.next_run_at) : "—"}</span></div>
                <div>Última: {r.last_run ? <>{dateTime(r.last_run.started_at)} <Badge tone={STATUS[r.last_run.status]?.[1]}>{STATUS[r.last_run.status]?.[0] ?? r.last_run.status}</Badge> <span>({r.last_run.trigger === "manual" ? "manual" : "agendada"})</span></> : "nunca"}</div>
                {r.last_run?.error && <div className="text-warn">{r.last_run.error}</div>}
                {r.webhook_url && <div>Webhook configurado</div>}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {canOperate(user) && <Button size="sm" variant="primary" loading={busy === r.key} icon={<Play className="size-3.5" />} onClick={async () => { setBusy(r.key); try { const x = await api(`/routines/${r.key}/run`, { body: {} }); toast(x.note ?? "Rotina executada"); d.reload(); setRun(x.id); } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(null); } }}>Executar agora</Button>}
                {r.last_run && <Button size="sm" icon={<Eye className="size-3.5" />} onClick={() => setRun(r.last_run.id)}>Ver resultado</Button>}
                <Button size="sm" variant="ghost" onClick={() => setHistory(r.key)}>Histórico</Button>
                {isAdmin(user) && <Button size="sm" variant="ghost" onClick={() => setEdit({ ...r, webhook_url: r.webhook_url ?? "" })}>Configurar</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Configurar — ${edit?.name ?? ""}`} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" onClick={async () => { try { await api(`/routines/${edit.key}`, { method: "PUT", body: { enabled: !!edit.enabled, hour: Number(edit.hour), weekday: edit.weekday, use_ai: !!edit.use_ai, webhook_url: edit.webhook_url || null } }); setEdit(null); d.reload(); } catch (e) { toast((e as Error).message, "bad"); } }}>Salvar</Button></>}>
        {edit && <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> Rotina ativa</label>
          <Field label="Horário (São Paulo)"><Select value={edit.hour} onChange={(e) => setEdit({ ...edit, hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select></Field>
          {edit.frequency === "weekly" && <Field label="Dia da semana"><Select value={edit.weekday} onChange={(e) => setEdit({ ...edit, weekday: Number(e.target.value) })}>{WD.map((w, i) => <option key={i} value={i}>{w}</option>)}</Select></Field>}
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.use_ai} onChange={(e) => setEdit({ ...edit, use_ai: e.target.checked })} /> Incluir análise do Mind AI</label>
          <Field label="Webhook (opcional)" className="col-span-2" hint="Recebe um POST JSON com os dados e o resumo da rotina"><Input value={edit.webhook_url} onChange={(e) => setEdit({ ...edit, webhook_url: e.target.value })} placeholder="https://hooks…" /></Field>
        </div>}
      </Modal>
      <RunModal id={run} onClose={() => setRun(null)} />
      <HistoryModal routine={history} onClose={() => setHistory(null)} onOpen={(id) => { setHistory(null); setRun(id); }} />
    </>
  );
}

function RunModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const d = useApi<any>(id ? `/routine-runs/${id}` : null, [id]);
  return (
    <Modal open={!!id} onClose={onClose} title="Resultado da rotina" wide>
      {d.loading && !d.data ? <Spinner /> : d.data && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs"><Badge tone={STATUS[d.data.status]?.[1]}>{STATUS[d.data.status]?.[0]}</Badge><span className="text-ink-3">{dateTime(d.data.started_at)} · {d.data.trigger === "manual" ? "execução manual" : "execução agendada"}</span></div>
          {d.data.error && <Notice tone="warn">{d.data.error}</Notice>}
          {d.data.ai_summary && <Card title="Análise do Mind AI"><div className="prose-ai text-sm"><Markdown text={d.data.ai_summary} /></div></Card>}
          <Card title="Dados calculados"><pre className="max-h-[50vh] overflow-auto text-[11px]">{JSON.stringify(d.data.data, null, 2)}</pre></Card>
        </div>
      )}
    </Modal>
  );
}

function HistoryModal({ routine, onClose, onOpen }: { routine: string | null; onClose: () => void; onOpen: (id: number) => void }) {
  const d = useApi<any[]>(routine ? `/routines/${routine}/runs` : null, [routine]);
  return (
    <Modal open={!!routine} onClose={onClose} title="Histórico de execuções">
      {(d.data ?? []).length === 0 ? <p className="text-xs text-ink-3">Nenhuma execução.</p> : (
        <ul className="space-y-1.5">{d.data!.map((r) => <li key={r.id}><button onClick={() => onOpen(r.id)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-surface-2"><span>{dateTime(r.started_at)} · {r.trigger === "manual" ? "manual" : "agendada"}</span><Badge tone={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] ?? r.status}</Badge></button></li>)}</ul>
      )}
    </Modal>
  );
}
