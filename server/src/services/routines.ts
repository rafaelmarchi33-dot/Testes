import { q, json } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";
import { localDate, addDays, TZ_OFFSET_MIN } from "../lib/dates.ts";
import { aiConfigured } from "../config.ts";
import { logger } from "../lib/logger.ts";
import { overview } from "./overview.ts";
import { goalProgress } from "./company.ts";
import { listingsCenter } from "./listingsIntel.ts";
import { listOpportunities } from "./rnd.ts";
import { productionPlanner, listFilaments } from "./factory.ts";
import { profitabilityRanking } from "./costs3d.ts";
import { dre } from "./dre.ts";

const local = (d = new Date()) => new Date(d.getTime() + TZ_OFFSET_MIN * 60_000);
const lastDayOfMonth = (day: string) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).toISOString().slice(0, 10);

export function isDue(r: any, now = new Date()) {
  if (!r.enabled) return false;
  const l = local(now);
  const today = l.toISOString().slice(0, 10);
  if (l.getUTCHours() < r.hour) return false;
  if (r.last_run_at && localDate(r.last_run_at) === today) return false;
  if (r.frequency === "weekly") return l.getUTCDay() === r.weekday;
  if (r.frequency === "monthly_end") return today === lastDayOfMonth(today);
  return true;
}

export function nextRun(r: any, now = new Date()) {
  for (let i = 0; i < 40; i++) {
    const day = addDays(localDate(now), i);
    const wd = new Date(day + "T12:00:00Z").getUTCDay();
    const ok = r.frequency === "daily" || (r.frequency === "weekly" && wd === r.weekday) || (r.frequency === "monthly_end" && day === lastDayOfMonth(day));
    if (!ok) continue;
    const at = new Date(Date.parse(`${day}T${String(r.hour).padStart(2, "0")}:00:00.000Z`) - TZ_OFFSET_MIN * 60_000);
    if (i === 0 && (at <= now || (r.last_run_at && localDate(r.last_run_at) === day))) continue;
    return at.toISOString();
  }
  return null;
}

export function listRoutines() {
  return q.all<any>("SELECT * FROM routines ORDER BY CASE frequency WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END, weekday").map((r) => ({
    ...r, next_run_at: r.enabled ? nextRun(r) : null,
    last_run: q.get("SELECT id, started_at, finished_at, status, trigger, error FROM routine_runs WHERE routine_key=? ORDER BY id DESC LIMIT 1", [r.key]) ?? null,
  }));
}

/** Dados determinísticos de cada rotina (sempre calculados do banco; a IA apenas comenta). */
export function routineData(key: string) {
  switch (key) {
    case "daily": {
      const o = overview("yesterday");
      const g = goalProgress();
      return { kind: "Rotina diária", ontem: { kpis: o.kpis, fonte: o.data_source }, meta: { faturamento_mes: g.revenue, meta: g.goal, trajetoria_pct: g.trajectory_pct, necessario_por_dia: g.needed_per_day },
        operacional: o.operational, alertas: q.all("SELECT severity, title, message FROM alerts WHERE status='open' ORDER BY created_at DESC LIMIT 15"), pendencias: o.pending };
    }
    case "monday":
      return { kind: "Pesquisa de mercado", radar_top: listOpportunities().slice(0, 10).map((x) => ({ nome: x.name, nota: x.score, observado: x.observed })),
        campeoes: listingsCenter({ days: 30 }).rows.filter((l) => l.class === "campeao").map((l) => ({ titulo: l.title, vendas: l.units_period })),
        concorrentes_recentes: q.all("SELECT name, product, price, our_price, analyzed_at FROM competitors WHERE analyzed_at >= ? ORDER BY analyzed_at DESC", [addDays(localDate(new Date()), -30)]) };
    case "tuesday": {
      const c = listingsCenter({ days: 30 });
      return { kind: "Otimização de anúncios", conversao_loja: c.store_conversion_pct, classes: c.counts, prioridades: c.priority.slice(0, 10).map((l) => ({ titulo: l.title, classe: l.class_label, motivos: l.reasons, qualidade: l.quality_score, conversao: l.conversion_pct })),
        fotos_pendentes: q.all("SELECT name, photo_plan FROM marketing_contents ORDER BY updated_at DESC LIMIT 10").map((m: any) => ({ nome: m.name, pendentes: json.parse<any[]>(m.photo_plan, []).filter((p) => !p.done).length })) };
    }
    case "wednesday":
      return { kind: "Preços, margens e kits", ranking: profitabilityRanking().slice(0, 15).map((p) => ({ produto: p.name, preco: p.price, margem: p.calc?.margin_pct ?? null, lucro_hora: p.calc?.profit_per_print_hour ?? null, preco_minimo: p.calc?.min_price ?? null, pendente: p.pending })),
        margens_negativas: listingsCenter({ days: 30 }).rows.filter((l) => l.margin_pct !== null && l.margin_pct < 0).map((l) => l.title) };
    case "thursday": {
      const p = productionPlanner();
      return { kind: "Produção e capacidade", horas_fila: p.total_hours, maquinas: p.machines, em_risco: p.at_risk.map((s: any) => ({ op: s.id, nome: s.name, risco: s.risk })), filamento: p.filament_needs,
        filamentos_baixos: listFilaments().filter((f) => f.needs_restock).map((f) => `${f.material} ${f.color ?? ""} (${f.available_g} g)`), dados_faltando: p.missing_data };
    }
    case "friday": {
      const w = overview("7d");
      return { kind: "Relatório executivo semanal", semana: w.kpis, variacoes: w.changes, fonte: w.data_source, meta: goalProgress(), producao_concluida: q.get("SELECT COUNT(*) n, SUM(quantity) un FROM production_orders WHERE status='done' AND completed_at >= ?", [new Date(Date.now() - 7 * 86_400_000).toISOString()]) };
    }
    case "month_end": {
      const today = localDate(new Date());
      return { kind: "Fechamento do mês — DRE gerencial", dre: dre(today.slice(0, 7)), meta: goalProgress(), mes: overview("month").kpis };
    }
  }
  throw new HttpError(404, "Rotina inexistente");
}

const PROMPTS: Record<string, string> = {
  daily: "Faça o resumo diário da diretoria: vendas, faturamento, conversão, pedidos, estoque, problemas operacionais e até 5 ações recomendadas para hoje.",
  monday: "Faça a pesquisa de mercado semanal: produtos vencedores, oportunidades do radar e movimentos de concorrência. Indique o que pesquisar a fundo.",
  tuesday: "Otimização de anúncios: quais anúncios melhorar primeiro, o que mudar em título, fotos e conversão.",
  wednesday: "Revisão de preços, margens e kits: onde ajustar preço (com cálculo), quais kits criar.",
  thursday: "Produção: o que imprimir primeiro, lotes, filamento a comprar (sem comprar), capacidade e riscos de atraso.",
  friday: "Relatório executivo da semana e plano da próxima semana.",
  month_end: "DRE gerencial comentado do mês, crescimento, metas e planejamento do próximo mês.",
};

export async function runRoutine(key: string, trigger: "schedule" | "manual") {
  const r = q.get<any>("SELECT * FROM routines WHERE key=?", [key]);
  if (!r) throw new HttpError(404, "Rotina inexistente");
  const started = new Date().toISOString();
  const run = q.run("INSERT INTO routine_runs (routine_key, started_at, status, trigger) VALUES (?,?, 'running', ?)", [key, started, trigger]);
  const runId = Number(run.lastInsertRowid);
  try {
    const data = routineData(key);
    let summary: string | null = null;
    let note: string | null = null;
    if (r.use_ai && aiConfigured()) {
      const { analyze } = await import("../ai/mind.ts");
      try { summary = (await analyze(PROMPTS[key]!, data, "medium")) ?? null; } catch (e) { note = `IA indisponível: ${(e as Error).message}`; }
    } else if (r.use_ai) note = "IA não configurada: rotina gerou apenas os dados calculados.";
    q.run("UPDATE routine_runs SET finished_at=?, status=?, data=?, ai_summary=?, error=? WHERE id=?", [new Date().toISOString(), note ? "partial" : "ok", JSON.stringify(data), summary, note, runId]);
    q.run("UPDATE routines SET last_run_at=?, last_status=? WHERE key=?", [started, note ? "partial" : "ok", key]);
    if (r.webhook_url) {
      fetch(r.webhook_url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ routine: key, name: r.name, at: started, data, summary }) })
        .catch((e) => logger.warn("routine_webhook_failed", { key, error: e }));
    }
    return { id: runId, status: note ? "partial" : "ok", note };
  } catch (e) {
    q.run("UPDATE routine_runs SET finished_at=?, status='failed', error=? WHERE id=?", [new Date().toISOString(), (e as Error).message, runId]);
    q.run("UPDATE routines SET last_run_at=?, last_status='failed' WHERE key=?", [started, key]);
    throw e;
  }
}

let running = false;
/** Verificação periódica (chamada pelo agendador interno do servidor). */
export async function tickRoutines(now = new Date()) {
  if (running) return;
  running = true;
  try {
    for (const r of q.all<any>("SELECT * FROM routines WHERE enabled=1")) {
      if (!isDue(r, now)) continue;
      try { await runRoutine(r.key, "schedule"); } catch (e) { logger.error("routine_failed", { key: r.key, error: e }); }
    }
  } finally { running = false; }
}
