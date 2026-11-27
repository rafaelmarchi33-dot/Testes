import { q } from "../db/index.ts";
import { resolvePeriod, comparisonRange, eachDay, type Range, TZ_OFFSET_MIN } from "../lib/dates.ts";
import { profitByListing } from "./finance.ts";
import { periodReports, goalProgress, dailyMetrics } from "./company.ts";
import { listingsCenter } from "./listingsIntel.ts";
import { machineOccupancy } from "./factory.ts";
import { getAccount } from "../ml/client.ts";

const LOCAL_DAY = `date(datetime(o.date_created, '${TZ_OFFSET_MIN} minutes'))`;
const chf = (channel?: string) => (channel && channel !== "all" ? { sql: " AND o.channel = ?", p: [channel] } : { sql: "", p: [] as string[] });

function orderKpis(r: Range, channel?: string) {
  const c = chf(channel);
  const s = q.get<any>(
    `SELECT COALESCE(SUM(o.total_amount),0) revenue, COUNT(*) orders FROM orders o WHERE o.status='paid' AND o.date_created >= ? AND o.date_created < ?${c.sql}`,
    [r.fromUtc, r.toUtc, ...c.p],
  )!;
  const units = q.get<any>(
    `SELECT COALESCE(SUM(oi.quantity),0) u FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='paid' AND o.date_created >= ? AND o.date_created < ?${c.sql}`,
    [r.fromUtc, r.toUtc, ...c.p],
  )!.u as number;
  const visits = q.get<{ v: number | null; days: number }>("SELECT SUM(visits) v, COUNT(*) days FROM visits_daily WHERE scope='store' AND date >= ? AND date <= ?", [r.from, r.to])!;
  const ads = q.get<{ cost: number | null; amount: number | null; days: number }>("SELECT SUM(cost) cost, SUM(total_amount) amount, COUNT(DISTINCT date) days FROM ads_campaign_daily WHERE date >= ? AND date <= ?", [r.from, r.to])!;
  let profit = profitByListing(r);
  if (channel && channel !== "all") {
    const ids = new Set(q.all<{ l: string }>(`SELECT DISTINCT oi.listing_id l FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.channel=?`, [channel]).map((x) => x.l));
    profit = profit.filter((p) => ids.has(p.listing_id));
  }
  const known = profit.filter((p) => p.cost_known);
  const knownRevenue = known.reduce((a, p) => a + p.revenue, 0);
  const contribution = known.reduce((a, p) => a + (p.profit ?? 0), 0);
  return {
    source: s.orders > 0 ? "orders" : "none",
    revenue: s.revenue as number, orders: s.orders as number, units,
    avg_ticket: s.orders ? s.revenue / s.orders : null,
    visits: visits.days > 0 ? visits.v : null,
    conversion_pct: visits.days > 0 && visits.v ? (s.orders / visits.v) * 100 : null,
    ad_spend: ads.days > 0 ? ads.cost : null,
    ad_revenue: ads.days > 0 ? ads.amount : null,
    roas: ads.days > 0 && ads.cost ? (ads.amount ?? 0) / ads.cost : null,
    acos_pct: ads.days > 0 && ads.amount ? ((ads.cost ?? 0) / ads.amount) * 100 : null,
    estimated_profit: known.length ? contribution : null,
    contribution_margin_pct: knownRevenue > 0 ? (contribution / knownRevenue) * 100 : null,
    profit_coverage_pct: s.revenue > 0 ? (knownRevenue / s.revenue) * 100 : null,
    profit_rows: profit,
  };
}

/** Quando não há pedidos individuais no período, usa relatório agregado importado contido no período. */
function reportKpis(r: Range, channel?: string) {
  const rep = periodReports().find((p) => p.date_from >= r.from && p.date_to <= r.to && (!channel || channel === "all" || p.channel === channel));
  if (!rep) return null;
  return {
    report: rep,
    kpis: {
      source: "report", revenue: rep.gross_sales, orders: rep.sales_count, units: rep.units, avg_ticket: rep.sales_count ? rep.gross_sales / rep.sales_count : null,
      avg_unit_price: rep.avg_unit_price, visits: rep.visits, conversion_pct: rep.conversion_pct,
      ad_spend: null, ad_revenue: null, roas: null, acos_pct: null, estimated_profit: null, contribution_margin_pct: null, profit_coverage_pct: null,
    },
    previous: { source: "report_derived", revenue: rep.derived_previous.gross_sales, orders: rep.derived_previous.sales_count, units: rep.derived_previous.units, visits: rep.derived_previous.visits, conversion_pct: rep.derived_previous.conversion_pct, avg_unit_price: rep.derived_previous.avg_unit_price },
  };
}

/** KPIs das métricas diárias importadas, somente dos dias SEM pedidos individuais (evita dupla contagem). */
function metricsKpis(r: Range, channel?: string) {
  const rows = q.all<any>(
    `SELECT * FROM daily_metrics d WHERE date >= ? AND date <= ? ${channel && channel !== "all" ? "AND channel = ?" : ""}
     AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.status='paid' AND o.channel=d.channel AND ${LOCAL_DAY} = d.date) ORDER BY date`,
    [r.from, r.to, ...(channel && channel !== "all" ? [channel] : [])],
  );
  if (!rows.length) return null;
  const sum = (k: string) => rows.reduce((s, x) => s + (x[k] ?? 0), 0);
  const revenue = sum("gross_sales"), orders = sum("sales_count"), units = sum("units"), visits = sum("unique_visits");
  return {
    days: rows.length,
    kpis: { revenue, orders, units, visits },
    funnel: {
      unique_visits: visits, intent_unique_visitors: sum("intent_unique_visitors"), intent_count: sum("intent_count"), intent_units: sum("intent_units"),
      intent_value: sum("intent_value"), sales_count: orders, units, gross_sales: revenue, unique_buyers: sum("unique_buyers"), likes: sum("likes"),
    },
  };
}

/** Soma às KPIs de pedidos as métricas diárias dos dias sem pedidos. Visitas já vêm de visits_daily (inclui as importadas). */
function withMetrics(base: any, r: Range, channel?: string) {
  const mk = metricsKpis(r, channel);
  if (!mk) return { k: base, mk: null };
  const revenue = base.revenue + mk.kpis.revenue, orders = base.orders + mk.kpis.orders, units = base.units + mk.kpis.units;
  const visits = base.visits ?? mk.kpis.visits;
  return {
    mk,
    k: {
      ...base, source: base.orders > 0 ? "mixed" : "daily_metrics", revenue, orders, units,
      avg_ticket: orders ? revenue / orders : null, avg_unit_price: units ? revenue / units : null,
      visits, conversion_pct: visits ? (orders / visits) * 100 : null,
    },
  };
}

const pct = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0 ? null : ((a - b) / b) * 100);

export function overview(period: string, from?: string, to?: string, channel?: string) {
  const range = resolvePeriod(period, from, to);
  const prev = comparisonRange(period, range);
  let cur: any = orderKpis(range, channel);
  let before: any = orderKpis(prev, channel);
  let dataSource = cur.source;
  let report: any = null;
  let funnel: any = null;
  let metricsDays = 0;
  const m1 = withMetrics(cur, range, channel);
  if (m1.mk) {
    cur = m1.k;
    funnel = m1.mk.funnel;
    metricsDays = m1.mk.days;
    dataSource = cur.source;
    before = withMetrics(before, prev, channel).k;
    if (dataSource === "daily_metrics" && before.orders === 0 && before.revenue === 0) {
      // sem dados do período anterior: usa o anterior derivado do relatório agregado do mesmo período, se houver
      const rk = reportKpis(range, channel);
      if (rk && rk.report.date_from === range.from && rk.report.date_to === range.to) { before = { ...before, ...rk.previous }; report = rk.report; }
    }
  } else if (cur.orders === 0) {
    const rk = reportKpis(range, channel);
    if (rk) {
      report = rk.report;
      cur = { ...cur, ...rk.kpis };
      before = before.orders === 0 ? { ...before, ...rk.previous } : before;
      dataSource = "report";
    }
  }
  const changes = {
    revenue: report && before.source === "report_derived" ? report.var_gross_sales_pct : pct(cur.revenue, before.revenue),
    orders: report && before.source === "report_derived" ? report.var_sales_count_pct : pct(cur.orders, before.orders),
    units: report && before.source === "report_derived" ? report.var_units_pct : pct(cur.units, before.units),
    avg_ticket: pct(cur.avg_ticket, before.avg_ticket),
    visits: report && before.source === "report_derived" ? report.var_visits_pct : pct(cur.visits, before.visits),
    conversion_pp: cur.conversion_pct != null && before.conversion_pct != null ? cur.conversion_pct - before.conversion_pct : null,
    estimated_profit: pct(cur.estimated_profit, before.estimated_profit),
    ad_spend: pct(cur.ad_spend, before.ad_spend),
  };

  const center = listingsCenter({ range, channel });
  const stock = q.get<{ units: number; products: number }>("SELECT COALESCE(SUM(stock_qty),0) units, COUNT(*) products FROM products WHERE made_to_order=0 AND stock_qty > 0")!;
  const occ = machineOccupancy(range.fromUtc, range.toUtc, range.days);
  const operational = {
    active_listings: center.rows.filter((l) => l.status === "active").length,
    champions: center.counts.campeao ?? 0,
    critical: center.counts.critico ?? 0,
    listings_identified: q.get<{ n: number | null }>("SELECT listings_identified n FROM companies LIMIT 1")?.n ?? null,
    stock_units: stock.units, stock_products: stock.products,
    ml_displayed_stock: q.get<{ s: number | null }>("SELECT SUM(available_quantity) s FROM listings WHERE status='active'")!.s,
    print_hours: occ.has_data ? occ.print_hours : null,
    occupancy_pct: occ.occupancy_pct,
    capacity_hours: occ.capacity_hours,
    awaiting_shipment: q.get<{ n: number }>("SELECT COUNT(*) n FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.status='paid' AND s.status IN ('ready_to_ship','handling','pending')")!.n,
    unanswered_questions: q.get<{ n: number }>("SELECT COUNT(*) n FROM questions WHERE status='UNANSWERED'")!.n,
    open_production_orders: q.get<{ n: number }>("SELECT COUNT(*) n FROM production_orders WHERE status NOT IN ('done','cancelled')")!.n,
    filaments_low: q.get<{ n: number }>("SELECT COUNT(*) n FROM filaments WHERE active=1 AND min_g > 0 AND available_g <= min_g")!.n,
  };

  // ---------------- Séries ----------------
  const c = chf(channel);
  const dailyRows = (r: Range) => {
    const rows = q.all<{ d: string; revenue: number; orders: number }>(
      `SELECT ${LOCAL_DAY} d, SUM(o.total_amount) revenue, COUNT(*) orders FROM orders o WHERE o.status='paid' AND o.date_created >= ? AND o.date_created < ?${c.sql} GROUP BY d`,
      [r.fromUtc, r.toUtc, ...c.p],
    );
    const m = new Map(rows.map((x) => [x.d, x]));
    // dias sem pedidos usam as métricas diárias importadas
    const met = new Map(dailyMetrics(r.from, r.to, channel).map((x) => [x.date, x]));
    return eachDay(r.from, r.to).map((d) => {
      const o = m.get(d);
      if (o) return { date: d, revenue: o.revenue, orders: o.orders };
      const x = met.get(d);
      return { date: d, revenue: x?.gross_sales ?? 0, orders: x?.sales_count ?? 0 };
    });
  };
  const curDaily = dailyRows(range), prevDaily = dailyRows(prev);
  const daily = curDaily.map((p, i) => ({ ...p, prev_revenue: prevDaily[i]?.revenue ?? 0, prev_date: prevDaily[i]?.date }));
  const hasDaily = curDaily.some((d) => d.orders > 0) || prevDaily.some((d) => d.orders > 0);

  const weekly = q.all<{ week: string; revenue: number; orders: number }>(
    `SELECT strftime('%Y-W%W', ${LOCAL_DAY}) week, SUM(o.total_amount) revenue, COUNT(*) orders FROM orders o WHERE o.status='paid' AND o.date_created >= ?${c.sql} GROUP BY week ORDER BY week`,
    [new Date(Date.now() - 16 * 7 * 86_400_000).toISOString(), ...c.p],
  );
  // semanas: soma as métricas diárias importadas nos dias sem pedidos
  for (const mw of q.all<{ week: string; revenue: number; orders: number }>(
    `SELECT strftime('%Y-W%W', date) week, SUM(gross_sales) revenue, SUM(sales_count) orders FROM daily_metrics d
     WHERE date >= ? AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.status='paid' AND ${LOCAL_DAY} = d.date) ${channel && channel !== "all" ? "AND d.channel = ?" : ""} GROUP BY week`,
    [new Date(Date.now() - 16 * 7 * 86_400_000).toISOString().slice(0, 10), ...c.p],
  )) {
    const w = weekly.find((x) => x.week === mw.week);
    if (w) { w.revenue += mw.revenue; w.orders += mw.orders; } else weekly.push(mw);
  }
  weekly.sort((a, b) => a.week.localeCompare(b.week));
  const monthly = q.all<{ month: string; revenue: number; orders: number }>(
    `SELECT substr(${LOCAL_DAY},1,7) month, SUM(o.total_amount) revenue, COUNT(*) orders FROM orders o WHERE o.status='paid' AND o.date_created >= ?${c.sql} GROUP BY month ORDER BY month`,
    [new Date(Date.now() - 400 * 86_400_000).toISOString(), ...c.p],
  );
  // Relatórios agregados entram na série semanal/mensal marcados como tal
  const reports = periodReports().filter((r) => !channel || channel === "all" || r.channel === channel);
  const monthlyWithReports = [...monthly.map((m) => ({ ...m, report_revenue: 0 }))];
  const metricsMonth = q.all<{ month: string; revenue: number; first: string; last: string }>(
    `SELECT substr(date,1,7) month, SUM(gross_sales) revenue, MIN(date) first, MAX(date) last FROM daily_metrics d
     WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.status='paid' AND ${LOCAL_DAY} = d.date) ${channel && channel !== "all" ? "AND d.channel = ?" : ""} GROUP BY month`,
    channel && channel !== "all" ? [channel] : [],
  );
  for (const mm of metricsMonth) {
    const row = monthlyWithReports.find((x) => x.month === mm.month);
    if (row) row.report_revenue += mm.revenue; else monthlyWithReports.push({ month: mm.month, revenue: 0, orders: 0, report_revenue: mm.revenue });
  }
  const metricDays = new Set(q.all<{ date: string }>("SELECT date FROM daily_metrics").map((x) => x.date));
  for (const r of reports) {
    if (eachDay(r.date_from, r.date_to).some((d) => metricDays.has(d))) continue;
    const m = r.date_from.slice(0, 7);
    const hasOrders = curDaily.concat(prevDaily).some((d) => d.orders > 0 && d.date >= r.date_from && d.date <= r.date_to)
      || !!q.get(`SELECT 1 FROM orders o WHERE o.status='paid' AND ${LOCAL_DAY} BETWEEN ? AND ?`, [r.date_from, r.date_to]);
    if (hasOrders) continue;
    const row = monthlyWithReports.find((x) => x.month === m);
    if (row) row.report_revenue += r.gross_sales ?? 0;
    else monthlyWithReports.push({ month: m, revenue: 0, orders: 0, report_revenue: r.gross_sales ?? 0 });
  }
  monthlyWithReports.sort((a, b) => a.month.localeCompare(b.month));

  const profitRows = (cur.profit_rows ?? []) as ReturnType<typeof profitByListing>;
  const topSold = [...profitRows].sort((a, b) => b.units - a.units).slice(0, 10).map((p) => ({ title: p.title, units: p.units, revenue: p.revenue }));
  const topProfit = profitRows.filter((p) => p.profit !== null).sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0)).slice(0, 10).map((p) => ({ title: p.title, profit: p.profit, margin_pct: p.margin_pct }));
  const conversionByListing = center.rows.filter((l) => l.conversion_pct !== null).sort((a, b) => (b.visits ?? 0) - (a.visits ?? 0)).slice(0, 12)
    .map((l) => ({ title: l.title, conversion_pct: l.conversion_pct, visits: l.visits, orders: l.orders_period }));
  const profitByCategory = (() => {
    const cats = new Map<string, { category: string; revenue: number; profit: number; known: boolean }>();
    for (const p of profitRows) {
      const cat = q.get<{ c: string | null }>("SELECT COALESCE(pr.category, c.name) c FROM listings l LEFT JOIN products pr ON pr.id=l.product_id LEFT JOIN categories c ON c.id=l.category_id WHERE l.id=?", [p.listing_id])?.c ?? "Sem categoria";
      const cur = cats.get(cat) ?? { category: cat, revenue: 0, profit: 0, known: false };
      cur.revenue += p.revenue;
      if (p.profit !== null) { cur.profit += p.profit; cur.known = true; }
      cats.set(cat, cur);
    }
    return [...cats.values()].filter((x) => x.known).sort((a, b) => b.profit - a.profit);
  })();
  const metricsInRange = dailyMetrics(range.from, range.to, channel);
  const dailyConversion = metricsInRange.length
    ? metricsInRange.map((x) => ({ date: x.date, conversion: x.unique_visits ? (x.sales_count / x.unique_visits) * 100 : 0, intent: x.unique_visits ? (x.intent_unique_visitors / x.unique_visits) * 100 : 0, visits: x.unique_visits }))
    : null;
  const adsDaily = q.all<any>("SELECT date, SUM(cost) cost, SUM(total_amount) revenue FROM ads_campaign_daily WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date", [range.from, range.to]);
  const goal = goalProgress(new Date(), channel);
  const { profit_rows: _a, ...curOut } = cur;
  const { profit_rows: _b, ...prevOut } = before;

  return {
    range, previous: prev, period, channel: channel ?? "all",
    data_source: dataSource, report_used: report, metrics_days: metricsDays, funnel,
    connected: !!getAccount(),
    last_sync: q.get<{ at: string | null }>("SELECT MAX(last_success_at) at FROM sync_state WHERE status='ok'")!.at,
    kpis: curOut, previous_kpis: prevOut, changes, operational,
    goal,
    charts: {
      daily: hasDaily ? daily : null,
      weekly: weekly.length ? weekly : null,
      monthly: monthlyWithReports.length ? monthlyWithReports : null,
      top_sold: topSold.length ? topSold : null,
      top_profit: topProfit.length ? topProfit : null,
      conversion_by_listing: conversionByListing.length ? conversionByListing : null,
      profit_by_category: profitByCategory.length ? profitByCategory : null,
      ads_vs_return: adsDaily.length ? adsDaily : null,
      goal_series: goal.series,
      daily_conversion: dailyConversion,
    },
    pending: pendingData(),
  };
}

/** Lista explícita do que falta para os indicadores ficarem completos. */
export function pendingData(): string[] {
  const out: string[] = [];
  if (!getAccount()) out.push("Mercado Livre não conectado — vendas diárias, pedidos e visitas dependem da conexão ou de importação de relatórios.");
  if (!q.get("SELECT 1 FROM orders")) out.push(q.get("SELECT 1 FROM daily_metrics")
    ? "Sem pedidos individuais: gráficos diários usam as métricas importadas, mas produtos mais vendidos e lucro por produto exigem o relatório de vendas (Vendas › Exportar)."
    : "Nenhum pedido individual registrado: gráficos diários, produtos mais vendidos e lucro por produto ficam pendentes.");
  if (!q.get("SELECT 1 FROM product_costs") && !q.get("SELECT 1 FROM products WHERE weight_g > 0 AND print_minutes > 0")) out.push("Nenhum produto com custos (ficha de custos ou peso/tempo): lucro e margem não podem ser calculados.");
  const cfg = q.get<{ value: string }>("SELECT value FROM settings WHERE key='cost_config'");
  if (!cfg) out.push("Configuração de custos (filamento, energia, embalagem, taxas) ainda não preenchida no módulo Financeiro.");
  if (!q.get("SELECT 1 FROM channels WHERE fee_pct IS NOT NULL")) out.push("Tarifas dos canais não configuradas.");
  if (!q.get("SELECT 1 FROM ads_campaign_daily")) out.push("Sem dados de publicidade (conecte Product Ads ou importe o relatório de campanhas).");
  if (!q.get("SELECT 1 FROM visits_daily WHERE scope='store'")) out.push("Sem visitas diárias registradas: conversão diária indisponível (o relatório inicial tem apenas o total do período).");
  if (!q.get("SELECT 1 FROM production_orders WHERE status='done'")) out.push("Sem ordens de produção concluídas: horas de impressão e ocupação ficam pendentes.");
  return out;
}
