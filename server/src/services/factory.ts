import { q, json } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";
import { localDate, addDays } from "../lib/dates.ts";
import { recordMovement } from "./inventory.ts";
import { calculate, getCostConfig } from "./costs3d.ts";

export const PROD_STATUS = ["waiting", "scheduled", "printing", "finishing", "packing", "done", "cancelled"] as const;
export type ProdStatus = (typeof PROD_STATUS)[number];
const ALLOWED: Record<ProdStatus, ProdStatus[]> = {
  waiting: ["scheduled", "printing", "cancelled"],
  scheduled: ["waiting", "printing", "cancelled"],
  printing: ["finishing", "packing", "done", "cancelled"],
  finishing: ["packing", "done", "cancelled"],
  packing: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

export const listMachines = () =>
  q.all<any>(`SELECT m.*, (SELECT COUNT(*) FROM production_orders p WHERE p.machine_id=m.id AND p.status IN ('scheduled','printing')) active_orders,
     (SELECT MAX(date) FROM machine_maintenance mm WHERE mm.machine_id=m.id) last_maintenance FROM machines m ORDER BY m.id`)
    .map((m) => ({ ...m, materials: json.parse(m.materials, []) }));

export const listFilaments = () =>
  q.all<any>(`SELECT f.*, (SELECT -SUM(grams) FROM filament_movements fm WHERE fm.filament_id=f.id AND fm.type IN ('consumption','waste') AND fm.created_at >= ?) consumed_30d
     FROM filaments f WHERE f.active=1 ORDER BY f.material, f.color`, [new Date(Date.now() - 30 * 86_400_000).toISOString()])
    .map((f) => ({ ...f, needs_restock: f.min_g > 0 && f.available_g <= f.min_g }));

/** Movimenta filamento (gramas positivas = entrada). Idempotente com ref. */
export function moveFilament(filamentId: number, type: "purchase" | "consumption" | "adjust" | "waste", grams: number, opts: { ref?: string; reason?: string; userId?: number } = {}) {
  const signed = type === "consumption" || type === "waste" ? -Math.abs(grams) : type === "purchase" ? Math.abs(grams) : grams;
  return q.tx(() => {
    if (opts.ref && q.get("SELECT 1 FROM filament_movements WHERE filament_id=? AND type=? AND ref=?", [filamentId, type, opts.ref])) return false;
    q.run("INSERT INTO filament_movements (filament_id, type, grams, ref, reason, created_by) VALUES (?,?,?,?,?,?)", [filamentId, type, signed, opts.ref ?? null, opts.reason ?? null, opts.userId ?? null]);
    q.run(`UPDATE filaments SET available_g = MAX(0, available_g + ?)${type === "purchase" ? ", total_g = total_g + ?" : ""} WHERE id=?`,
      type === "purchase" ? [signed, signed, filamentId] : [signed, filamentId]);
    return true;
  });
}

export function listProductionOrders(status?: string) {
  return q.all<any>(
    `SELECT po.*, p.name product_name, m.name machine_name, f.brand filament_brand, f.color filament_color, f.material filament_material
     FROM production_orders po LEFT JOIN products p ON p.id=po.product_id LEFT JOIN machines m ON m.id=po.machine_id LEFT JOIN filaments f ON f.id=po.filament_id
     ${status && status !== "all" ? (status === "open" ? "WHERE po.status NOT IN ('done','cancelled')" : "WHERE po.status = ?") : ""}
     ORDER BY CASE po.status WHEN 'printing' THEN 0 WHEN 'finishing' THEN 1 WHEN 'packing' THEN 2 WHEN 'scheduled' THEN 3 WHEN 'waiting' THEN 4 ELSE 5 END,
       COALESCE(po.due_date,'9999') LIMIT 500`,
    status && status !== "all" && status !== "open" ? [status] : [],
  ).map(withTotals);
}

function withTotals(po: any) {
  return {
    ...po,
    total_minutes: po.minutes_unit ? po.minutes_unit * po.quantity : null,
    total_grams: po.weight_g_unit ? po.weight_g_unit * po.quantity : null,
  };
}

/**
 * Transição de status. Ao concluir: baixa o filamento consumido (idempotente), soma as horas na máquina
 * e dá entrada no estoque do produto (unidades boas). Tudo em registros auditáveis.
 */
export function transitionOrder(id: number, to: ProdStatus, userId: number, opts: { failed_units?: number } = {}) {
  const po = q.get<any>("SELECT * FROM production_orders WHERE id=?", [id]);
  if (!po) throw new HttpError(404, "Ordem de produção não encontrada");
  if (!ALLOWED[po.status as ProdStatus].includes(to)) throw new HttpError(409, `Transição inválida: ${po.status} → ${to}`);
  const now = new Date().toISOString();
  const effects: string[] = [];
  q.run("UPDATE production_orders SET status=?, updated_at=?, start_date=COALESCE(start_date, CASE WHEN ?='printing' THEN ? END) WHERE id=?", [to, now, to, localDate(new Date()), id]);
  if (to === "printing" && po.machine_id) q.run("UPDATE machines SET status='printing' WHERE id=?", [po.machine_id]);
  if (to === "done") {
    const failed = Math.max(0, Math.min(po.quantity, opts.failed_units ?? 0));
    const good = po.quantity - failed;
    q.run("UPDATE production_orders SET completed_at=?, failed_units=? WHERE id=?", [now, failed, id]);
    if (po.filament_id && po.weight_g_unit) {
      const grams = po.weight_g_unit * po.quantity;
      if (moveFilament(po.filament_id, "consumption", grams, { ref: `po:${id}`, reason: `OP #${id} ${po.name}`, userId })) effects.push(`${grams.toFixed(0)} g de filamento baixados`);
    }
    if (po.machine_id && po.minutes_unit) {
      const h = (po.minutes_unit * po.quantity) / 60;
      q.run("UPDATE machines SET hours_worked = hours_worked + ? WHERE id=?", [h, po.machine_id]);
      effects.push(`${h.toFixed(1)} h somadas à máquina`);
    }
    if (po.product_id && good > 0) {
      const mto = q.get<{ made_to_order: number }>("SELECT made_to_order FROM products WHERE id=?", [po.product_id]);
      if (mto && !mto.made_to_order && recordMovement(po.product_id, "production", good, { ref: `po:${id}`, reason: `OP #${id}`, userId })) effects.push(`${good} un. adicionadas ao estoque`);
    }
  }
  if ((to === "done" || to === "cancelled") && po.machine_id) {
    const busy = q.get("SELECT 1 FROM production_orders WHERE machine_id=? AND status='printing' AND id != ?", [po.machine_id, id]);
    if (!busy) q.run("UPDATE machines SET status='available' WHERE id=? AND status='printing'", [po.machine_id]);
  }
  return { ok: true, effects };
}

/**
 * Planejamento inteligente (determinístico):
 * prioridade = prazo (risco) > prioridade declarada > lucro por hora de máquina.
 * Simula a fila nas máquinas disponíveis com as horas úteis por dia e aponta atrasos, lotes e consumo de filamento.
 */
export function productionPlanner(now = new Date()) {
  const today = localDate(now);
  const orders = listProductionOrders("open").filter((o) => o.status !== "cancelled");
  const machines = listMachines().filter((m) => m.status !== "inactive" && m.status !== "maintenance");
  const cfg = getCostConfig();
  const prioRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  const enriched = orders.map((o) => {
    let profitPerHour: number | null = null;
    if (o.sale_price_unit && o.weight_g_unit && o.minutes_unit) {
      const c = calculate({ weight_g: o.weight_g_unit, print_minutes: o.minutes_unit, material: o.material ?? "PLA", sale_price: o.sale_price_unit }, cfg);
      profitPerHour = c.profit_per_print_hour;
    }
    const remainingMinutes = ["printing", "finishing", "packing"].includes(o.status) ? 0 : (o.total_minutes ?? null);
    return { ...o, profit_per_hour: profitPerHour, remaining_minutes: remainingMinutes };
  });
  const queue = enriched
    .filter((o) => o.remaining_minutes !== 0)
    .sort((a, b) => {
      const da = a.due_date ?? "9999-12-31", dbb = b.due_date ?? "9999-12-31";
      if (da !== dbb) return da < dbb ? -1 : 1;
      if (prioRank[a.priority] !== prioRank[b.priority]) return prioRank[a.priority]! - prioRank[b.priority]!;
      return (b.profit_per_hour ?? -1e9) - (a.profit_per_hour ?? -1e9);
    });

  // Simulação de fila: cada máquina acumula horas; ordem vai para a máquina que termina antes.
  const load = machines.map((m) => ({ id: m.id, name: m.name, hours: 0, hpd: m.hours_per_day || 16 }));
  const schedule = queue.map((o) => {
    const hours = o.remaining_minutes ? o.remaining_minutes / 60 : null;
    if (!load.length || hours === null) return { ...o, machine: null, est_finish: null, risk: hours === null ? "sem tempo de impressão informado" : "nenhuma máquina disponível" };
    const target = (o.machine_id && load.find((l) => l.id === o.machine_id)) || [...load].sort((a, b) => a.hours / a.hpd - b.hours / b.hpd)[0]!;
    target.hours += hours;
    const finish = addDays(today, Math.ceil(target.hours / target.hpd) - 1);
    const late = o.due_date && finish > o.due_date;
    return { ...o, machine: target.name, est_finish: finish, risk: late ? `termina ${finish}, prazo ${o.due_date}` : null };
  });

  // Filamento necessário x disponível por material/cor
  const need = new Map<string, { material: string; color: string | null; grams: number }>();
  for (const o of queue) {
    if (!o.total_grams) continue;
    const k = `${o.material ?? "?"}|${o.color ?? ""}`;
    const cur = need.get(k) ?? { material: o.material ?? "?", color: o.color ?? null, grams: 0 };
    cur.grams += o.total_grams;
    need.set(k, cur);
  }
  const filaments = listFilaments();
  const filamentNeeds = [...need.values()].map((n) => {
    const available = filaments.filter((f) => f.material === n.material && (!n.color || !f.color || f.color.toLowerCase() === n.color.toLowerCase())).reduce((s, f) => s + f.available_g, 0);
    return { ...n, available_g: available, shortfall_g: Math.max(0, n.grams - available) };
  });

  // Lotes: ordens com mesmo material e cor podem ser impressas em sequência/mesma mesa
  const batches = new Map<string, any[]>();
  for (const o of queue) {
    const k = `${o.material ?? "?"} ${o.color ?? ""}`.trim();
    batches.set(k, [...(batches.get(k) ?? []), o]);
  }
  return {
    today,
    machines: load.map((l) => ({ ...l, days: l.hpd ? l.hours / l.hpd : null })),
    schedule,
    at_risk: schedule.filter((s) => s.risk),
    batches: [...batches.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ key: k, orders: v.map((o) => ({ id: o.id, name: o.name, quantity: o.quantity })), total_grams: v.reduce((s, o) => s + (o.total_grams ?? 0), 0) })),
    filament_needs: filamentNeeds,
    total_hours: queue.reduce((s, o) => s + (o.remaining_minutes ?? 0) / 60, 0),
    missing_data: queue.filter((o) => !o.minutes_unit || !o.weight_g_unit).map((o) => ({ id: o.id, name: o.name })),
    plate_tips: queue.filter((o) => o.units_per_plate && o.units_per_plate > 1).map((o) => ({ id: o.id, name: o.name, plates: Math.ceil(o.quantity / o.units_per_plate) })),
  };
}

/** Ocupação das máquinas em um intervalo (horas de OPs concluídas / horas disponíveis). */
export function machineOccupancy(fromIso: string, toIso: string, days: number) {
  const done = q.get<{ h: number | null }>("SELECT SUM(minutes_unit*quantity)/60.0 h FROM production_orders WHERE status='done' AND completed_at >= ? AND completed_at < ?", [fromIso, toIso])!.h;
  const cap = q.get<{ c: number | null }>("SELECT SUM(hours_per_day) c FROM machines WHERE status != 'inactive'")!.c;
  return { print_hours: done ?? 0, capacity_hours: cap ? cap * days : null, occupancy_pct: cap && done !== null ? (done / (cap * days)) * 100 : null, has_data: done !== null };
}
