import { q, json } from "../db/index.ts";
import { localDate, localDayStartUtc, addDays, eachDay, TZ_OFFSET_MIN } from "../lib/dates.ts";
import { getCostConfig } from "./costs3d.ts";

export function getCompany() {
  const c = q.get<any>("SELECT * FROM companies ORDER BY id LIMIT 1");
  return c ? { ...c, channels: json.parse(c.channels, []), catalog: json.parse(c.catalog, []) } : null;
}
export const monthlyGoal = () => getCompany()?.monthly_goal ?? 20000;

export function periodReports() {
  return q.all<any>("SELECT * FROM period_reports ORDER BY date_from DESC").map((r) => ({ ...r, derived_previous: derivePrevious(r) }));
}

/**
 * Período anterior derivado das variações informadas no relatório (ex.: +79,1% → anterior = atual / 1,791).
 * É um cálculo sobre os números do relatório, sinalizado como "derivado".
 */
export function derivePrevious(r: any) {
  const back = (cur: number | null, pct: number | null) => (cur == null || pct == null || pct <= -100 ? null : Math.round((cur / (1 + pct / 100)) * 100) / 100);
  return {
    gross_sales: back(r.gross_sales, r.var_gross_sales_pct),
    units: back(r.units, r.var_units_pct),
    sales_count: back(r.sales_count, r.var_sales_count_pct),
    visits: back(r.visits, r.var_visits_pct),
    avg_unit_price: back(r.avg_unit_price, r.var_avg_price_pct),
    conversion_pct: r.conversion_pct != null && r.var_conversion_pp != null ? Math.round((r.conversion_pct - r.var_conversion_pp) * 10) / 10 : null,
  };
}

const LOCAL_DAY = `date(datetime(date_created, '${TZ_OFFSET_MIN} minutes'))`;

/** Faturamento diário de pedidos pagos (dados por pedido). */
export function dailyOrderRevenue(from: string, to: string, channel?: string) {
  const rows = q.all<{ d: string; revenue: number; orders: number }>(
    `SELECT ${LOCAL_DAY} d, SUM(total_amount) revenue, COUNT(*) orders FROM orders
     WHERE status='paid' AND date_created >= ? AND date_created < ? ${channel && channel !== "all" ? "AND channel = ?" : ""} GROUP BY d`,
    [localDayStartUtc(from), localDayStartUtc(addDays(to, 1)), ...(channel && channel !== "all" ? [channel] : [])],
  );
  const m = new Map(rows.map((r) => [r.d, r]));
  return eachDay(from, to).map((d) => ({ date: d, revenue: m.get(d)?.revenue ?? 0, orders: m.get(d)?.orders ?? 0 }));
}

/**
 * Faturamento de um intervalo combinando fontes sem dupla contagem:
 * pedidos individuais (API/importação) + relatórios agregados cujos dias não têm pedidos registrados.
 */
export function revenueWithReports(from: string, to: string, channel?: string) {
  const daily = dailyOrderRevenue(from, to, channel);
  const orderRevenue = daily.reduce((s, d) => s + d.revenue, 0);
  const daysWithOrders = new Set(daily.filter((d) => d.orders > 0).map((d) => d.date));
  const reports = q.all<any>(
    `SELECT * FROM period_reports WHERE date_from >= ? AND date_to <= ? ${channel && channel !== "all" ? "AND channel = ?" : ""}`,
    [from, to, ...(channel && channel !== "all" ? [channel] : [])],
  ).filter((r) => !eachDay(r.date_from, r.date_to).some((d) => daysWithOrders.has(d)));
  const reportRevenue = reports.reduce((s, r) => s + (r.gross_sales ?? 0), 0);
  return {
    total: orderRevenue + reportRevenue,
    from_orders: orderRevenue,
    from_reports: reportRevenue,
    reports_used: reports.map((r) => ({ id: r.id, date_from: r.date_from, date_to: r.date_to, gross_sales: r.gross_sales, source: r.source })),
    daily,
  };
}

const monthStart = (day: string) => day.slice(0, 8) + "01";
const monthEnd = (day: string) => {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
};

/** Progresso da meta mensal, trajetória necessária e projeção baseada em histórico real. */
export function goalProgress(now = new Date(), channel?: string) {
  const today = localDate(now);
  const start = monthStart(today), end = monthEnd(today);
  const daysInMonth = Number(end.slice(8, 10));
  const dayOfMonth = Number(today.slice(8, 10));
  const goal = monthlyGoal();
  const rev = revenueWithReports(start, today, channel);
  const expectedToDate = (goal / daysInMonth) * dayOfMonth;

  // Ritmo observado: últimos 30 dias de dados (pedidos + relatórios), por dia coberto.
  const pace = observedDailyPace(today, channel);
  const remainingDays = daysInMonth - dayOfMonth;
  const projection = pace.daily_avg === null ? null : rev.total + pace.daily_avg * remainingDays;

  // Série acumulada do mês: real x trajetória linear até a meta.
  let acc = 0;
  const reportDays = new Map<string, number>();
  for (const r of rev.reports_used) {
    const days = eachDay(r.date_from, r.date_to);
    for (const d of days) reportDays.set(d, (reportDays.get(d) ?? 0) + (r.gross_sales ?? 0) / days.length);
  }
  const series = eachDay(start, end).map((d, i) => {
    const isPast = d <= today;
    if (isPast) acc += (rev.daily.find((x) => x.date === d)?.revenue ?? 0) + (reportDays.get(d) ?? 0);
    return { date: d, actual: isPast ? Math.round(acc * 100) / 100 : null, target: Math.round(((goal / daysInMonth) * (i + 1)) * 100) / 100,
      projected: !isPast && pace.daily_avg !== null ? Math.round((rev.total + pace.daily_avg * (i + 1 - dayOfMonth)) * 100) / 100 : null };
  });
  const milestones = q.all<any>("SELECT * FROM goals ORDER BY target_revenue");
  return {
    month: today.slice(0, 7), today, goal, revenue: rev.total, from_orders: rev.from_orders, from_reports: rev.from_reports, reports_used: rev.reports_used,
    progress_pct: goal > 0 ? (rev.total / goal) * 100 : null,
    expected_to_date: Math.round(expectedToDate * 100) / 100,
    trajectory_pct: expectedToDate > 0 ? (rev.total / expectedToDate) * 100 : null,
    remaining: Math.max(0, goal - rev.total),
    remaining_days: remainingDays,
    needed_per_day: remainingDays > 0 ? Math.max(0, goal - rev.total) / remainingDays : null,
    pace, projection, projection_note: "Projeção = faturamento do mês + ritmo diário médio observado × dias restantes. É uma estimativa, não uma garantia.",
    series, milestones,
  };
}

/** Ritmo médio diário observado nos últimos 30 dias com dados. Dias sem nenhuma fonte de dados não entram. */
export function observedDailyPace(today: string, channel?: string) {
  const from = addDays(today, -29);
  const daily = dailyOrderRevenue(from, today, channel);
  const orderDays = daily.filter((d) => d.orders > 0);
  const hasApi = !!q.get("SELECT 1 FROM ml_accounts WHERE status='connected'");
  const reports = q.all<any>("SELECT * FROM period_reports WHERE date_to >= ? AND date_from <= ?", [from, today]);
  let revenue = daily.reduce((s, d) => s + d.revenue, 0);
  let coveredDays = hasApi ? 30 : orderDays.length;
  const used: string[] = [];
  for (const r of reports) {
    const days = eachDay(r.date_from, r.date_to);
    if (days.some((d) => orderDays.find((o) => o.date === d))) continue;
    revenue += r.gross_sales ?? 0;
    if (!hasApi) coveredDays += days.length;
    used.push(`${r.date_from}→${r.date_to}`);
  }
  return {
    daily_avg: coveredDays > 0 ? Math.round((revenue / coveredDays) * 100) / 100 : null,
    covered_days: coveredDays,
    basis: hasApi ? "pedidos sincronizados dos últimos 30 dias" : coveredDays ? `dias com dados registrados${used.length ? ` (inclui relatório ${used.join(", ")})` : ""}` : "sem histórico",
  };
}

/** Simulação do caminho até a meta para diferentes tickets médios. */
export function goalSimulation(goal = monthlyGoal(), tickets = [50, 60, 80, 100, 120], opts: { units_per_order?: number; minutes_per_unit?: number | null; grams_per_unit?: number | null; acos_pct?: number | null; hours_per_day?: number } = {}) {
  // Unidades por pedido a partir do histórico real (pedidos ou relatório)
  const hist = q.get<{ u: number | null; o: number | null }>("SELECT SUM(oi.quantity) u, COUNT(DISTINCT oi.order_id) o FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='paid'")!;
  const rep = q.get<{ u: number | null; o: number | null }>("SELECT SUM(units) u, SUM(sales_count) o FROM period_reports")!;
  const upo = opts.units_per_order ?? (hist.o ? hist.u! / hist.o : rep.o ? rep.u! / rep.o : 1);
  const prod = q.get<{ m: number | null; g: number | null }>("SELECT AVG(print_minutes) m, AVG(weight_g) g FROM products WHERE print_minutes > 0")!;
  const minutes = opts.minutes_per_unit ?? prod.m ?? null;
  const grams = opts.grams_per_unit ?? prod.g ?? null;
  const acos = opts.acos_pct ?? getCostConfig().ads_pct ?? null;
  const machines = q.all<{ hours_per_day: number }>("SELECT hours_per_day FROM machines WHERE status != 'inactive'");
  const capacityHoursMonth = machines.reduce((s, m) => s + m.hours_per_day * 30, 0);
  return {
    goal, units_per_order: Math.round(upo * 100) / 100, units_per_order_source: opts.units_per_order ? "informado" : hist.o ? "pedidos registrados" : rep.o ? "relatório importado" : "suposição 1 un./pedido",
    minutes_per_unit: minutes, grams_per_unit: grams, acos_pct: acos, capacity_hours_month: capacityHoursMonth, machines: machines.length,
    rows: tickets.map((t) => {
      const orders = Math.ceil(goal / t);
      const units = Math.ceil(orders * upo);
      const printHours = minutes ? (units * minutes) / 60 : null;
      return {
        ticket: t, orders, units, daily_revenue: goal / 30, weekly_revenue: (goal / 30) * 7, orders_per_day: orders / 30,
        print_hours: printHours, utilization_pct: printHours && capacityHoursMonth ? (printHours / capacityHoursMonth) * 100 : null,
        printers_needed: printHours && machines.length ? Math.ceil(printHours / (capacityHoursMonth / machines.length)) : null,
        filament_kg: grams ? (units * grams) / 1000 : null,
        ad_investment: acos !== null ? goal * (acos / 100) : null,
      };
    }),
    notes: [
      "Simulação matemática: não representa garantia de resultado.",
      minutes ? null : "Cadastre peso e tempo de impressão nos produtos para calcular capacidade e filamento necessários.",
      acos !== null ? null : "Informe a publicidade (% do preço/ACOS) no Financeiro para estimar o investimento necessário.",
    ].filter(Boolean),
  };
}
