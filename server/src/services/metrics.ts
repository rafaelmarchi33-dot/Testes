import { q } from "../db/index.ts";
import { resolvePeriod, previousRange, eachDay, localDate, addDays, type Range } from "../lib/dates.ts";
import { profitByListing } from "./finance.ts";
import { ml, getAccount } from "../ml/client.ts";
import { TZ_OFFSET_MIN } from "../lib/dates.ts";

/** Expressão SQL que converte date_created (ISO UTC) para a data local da loja. */
const LOCAL_DAY = `date(datetime(o.date_created, '${TZ_OFFSET_MIN} minutes'))`;

function revenueIn(fromUtc: string, toUtc: string) {
  return q.get<{ revenue: number; orders: number }>(
    "SELECT COALESCE(SUM(total_amount),0) revenue, COUNT(*) orders FROM orders WHERE status='paid' AND date_created >= ? AND date_created < ?",
    [fromUtc, toUtc],
  )!;
}

function summary(r: Range) {
  const s = q.get<any>(
    `SELECT COALESCE(SUM(o.total_amount),0) revenue, COUNT(*) orders,
       COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o2 ON o2.id=oi.order_id
                 WHERE o2.status='paid' AND o2.date_created >= ? AND o2.date_created < ?),0) units
     FROM orders o WHERE o.status='paid' AND o.date_created >= ? AND o.date_created < ?`,
    [r.fromUtc, r.toUtc, r.fromUtc, r.toUtc],
  );
  const cancelled = q.get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE status='cancelled' AND date_created >= ? AND date_created < ?", [r.fromUtc, r.toUtc])!.n;
  const profit = profitByListing(r);
  const known = profit.filter((p) => p.cost_known);
  const knownRevenue = known.reduce((a, p) => a + p.revenue, 0);
  const grossProfit = known.reduce((a, p) => a + (p.profit ?? 0), 0);
  const fees = profit.reduce((a, p) => a + p.sale_fees, 0);
  const visits = q.get<{ v: number | null; days: number }>("SELECT SUM(visits) v, COUNT(*) days FROM visits_daily WHERE scope='store' AND date >= ? AND date <= ?", [r.from, r.to])!;
  const ads = q.get<{ cost: number | null; days: number }>("SELECT SUM(cost) cost, COUNT(DISTINCT date) days FROM ads_campaign_daily WHERE date >= ? AND date <= ?", [r.from, r.to])!;
  return {
    revenue: s.revenue as number,
    orders: s.orders as number,
    units: s.units as number,
    avg_ticket: s.orders ? s.revenue / s.orders : 0,
    cancelled,
    sale_fees: fees,
    gross_profit: known.length ? grossProfit : null,
    margin_pct: knownRevenue > 0 ? (grossProfit / knownRevenue) * 100 : null,
    profit_coverage_pct: s.revenue > 0 ? (knownRevenue / s.revenue) * 100 : null,
    ad_spend: ads.days > 0 ? ads.cost : null,
    visits: visits.days > 0 ? visits.v : null,
    visits_days_covered: visits.days,
    conversion_pct: visits.days > 0 && visits.v ? (s.orders / visits.v) * 100 : null,
  };
}

const pctChange = (cur: number | null, prev: number | null) => (cur == null || prev == null || prev === 0 ? null : ((cur - prev) / prev) * 100);

export function dashboard(period: string, from?: string, to?: string) {
  const range = resolvePeriod(period, from, to);
  const prev = previousRange(range);
  const cur = summary(range);
  const before = summary(prev);
  const today = resolvePeriod("today");
  const d7 = resolvePeriod("7d");
  const d30 = resolvePeriod("30d");
  const allTime = q.get<{ revenue: number; orders: number }>("SELECT COALESCE(SUM(total_amount),0) revenue, COUNT(*) orders FROM orders WHERE status='paid'")!;

  const operational = {
    active_listings: q.get<{ n: number }>("SELECT COUNT(*) n FROM listings WHERE status='active'")!.n,
    paused_listings: q.get<{ n: number }>("SELECT COUNT(*) n FROM listings WHERE status='paused'")!.n,
    out_of_stock_listings: q.get<{ n: number }>("SELECT COUNT(*) n FROM listings WHERE status IN ('active','paused') AND available_quantity <= 0")!.n,
    out_of_stock_products: q.get<{ n: number }>("SELECT COUNT(*) n FROM products WHERE made_to_order=0 AND stock_qty <= 0 AND id IN (SELECT product_id FROM listings WHERE status IN ('active','paused'))")!.n,
    awaiting_shipment: q.get<{ n: number }>(
      "SELECT COUNT(*) n FROM shipments s JOIN orders o ON o.id=s.order_id WHERE o.status='paid' AND s.status IN ('ready_to_ship','handling','pending')",
    )!.n,
    unanswered_questions: q.get<{ n: number }>("SELECT COUNT(*) n FROM questions WHERE status='UNANSWERED'")!.n,
  };

  // Série diária (atual x anterior alinhado por posição)
  const daily = (r: Range) => {
    const rows = q.all<{ d: string; revenue: number; orders: number }>(
      `SELECT ${LOCAL_DAY} d, SUM(o.total_amount) revenue, COUNT(*) orders FROM orders o
       WHERE o.status='paid' AND o.date_created >= ? AND o.date_created < ? GROUP BY d`,
      [r.fromUtc, r.toUtc],
    );
    const m = new Map(rows.map((x) => [x.d, x]));
    return eachDay(r.from, r.to).map((d) => ({ date: d, revenue: m.get(d)?.revenue ?? 0, orders: m.get(d)?.orders ?? 0 }));
  };
  const curSeries = daily(range);
  const prevSeries = daily(prev);
  const series = curSeries.map((p, i) => ({ ...p, prev_revenue: prevSeries[i]?.revenue ?? 0, prev_date: prevSeries[i]?.date }));

  // Comparativo mensal (12 meses)
  const monthly = q.all<{ month: string; revenue: number; orders: number }>(
    `SELECT substr(${LOCAL_DAY},1,7) month, SUM(o.total_amount) revenue, COUNT(*) orders FROM orders o
     WHERE o.status='paid' AND o.date_created >= ? GROUP BY month ORDER BY month`,
    [new Date(Date.now() - 400 * 86_400_000).toISOString()],
  ).slice(-12);

  const profit = profitByListing(range);
  const byProduct = profit.slice(0, 10).map((p) => ({ listing_id: p.listing_id, title: p.title, revenue: p.revenue, units: p.units, profit: p.profit, margin_pct: p.margin_pct }));
  const profitTop = profit.filter((p) => p.profit !== null).sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0)).slice(0, 10)
    .map((p) => ({ listing_id: p.listing_id, title: p.title, profit: p.profit, margin_pct: p.margin_pct }));

  const byCategory = q.all<{ category_id: string; name: string | null; units: number; revenue: number }>(
    `SELECT COALESCE(oi.category_id, l.category_id) category_id, c.name, SUM(oi.quantity) units, SUM(oi.quantity*oi.unit_price) revenue
     FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN listings l ON l.id=oi.listing_id
     LEFT JOIN categories c ON c.id = COALESCE(oi.category_id, l.category_id)
     WHERE o.status='paid' AND o.date_created >= ? AND o.date_created < ? GROUP BY 1 ORDER BY revenue DESC LIMIT 10`,
    [range.fromUtc, range.toUtc],
  );

  const growth = growthByListing(range, prev).slice(0, 10);
  const campaigns = q.all<any>(
    `SELECT c.id, c.name, c.status, SUM(d.cost) cost, SUM(d.total_amount) amount, SUM(d.clicks) clicks, SUM(d.prints) prints
     FROM ads_campaigns c JOIN ads_campaign_daily d ON d.campaign_id=c.id WHERE d.date >= ? AND d.date <= ? GROUP BY c.id ORDER BY cost DESC LIMIT 10`,
    [range.from, range.to],
  ).map((c) => ({ ...c, acos: c.amount ? c.cost / c.amount : null, roas: c.cost ? c.amount / c.cost : null }));

  const lastSync = q.get<{ at: string | null }>("SELECT MAX(last_success_at) at FROM sync_state WHERE status='ok'")!.at;
  return {
    range, previous: prev,
    connected: !!getAccount(),
    last_sync: lastSync,
    kpis: {
      ...cur,
      revenue_total: allTime.revenue,
      revenue_today: revenueIn(today.fromUtc, today.toUtc).revenue,
      revenue_7d: revenueIn(d7.fromUtc, d7.toUtc).revenue,
      revenue_30d: revenueIn(d30.fromUtc, d30.toUtc).revenue,
      ...operational,
    },
    changes: {
      revenue: pctChange(cur.revenue, before.revenue),
      orders: pctChange(cur.orders, before.orders),
      units: pctChange(cur.units, before.units),
      avg_ticket: pctChange(cur.avg_ticket, before.avg_ticket),
      gross_profit: pctChange(cur.gross_profit, before.gross_profit),
      conversion_pct: pctChange(cur.conversion_pct, before.conversion_pct),
      ad_spend: pctChange(cur.ad_spend, before.ad_spend),
    },
    previous_kpis: before,
    charts: { series, monthly, byProduct, profitTop, byCategory, growth, campaigns },
  };
}

/** Variação de unidades vendidas por anúncio entre dois períodos. */
export function growthByListing(cur: Range, prev: Range) {
  const units = (r: Range) =>
    new Map(
      q.all<{ listing_id: string; units: number; revenue: number }>(
        `SELECT oi.listing_id, SUM(oi.quantity) units, SUM(oi.quantity*oi.unit_price) revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id
         WHERE o.status='paid' AND o.date_created >= ? AND o.date_created < ? GROUP BY oi.listing_id`,
        [r.fromUtc, r.toUtc],
      ).map((x) => [x.listing_id, x]),
    );
  const a = units(cur), b = units(prev);
  const ids = new Set([...a.keys(), ...b.keys()]);
  const titles = new Map(q.all<{ id: string; title: string }>("SELECT id, title FROM listings").map((x) => [x.id, x.title]));
  return [...ids].map((id) => {
    const cu = a.get(id)?.units ?? 0, pu = b.get(id)?.units ?? 0;
    return { listing_id: id, title: titles.get(id) ?? id, units: cu, prev_units: pu, delta: cu - pu, growth_pct: pu > 0 ? ((cu - pu) / pu) * 100 : null };
  }).sort((x, y) => y.delta - x.delta);
}

/** Busca e guarda nomes de categorias para exibição (cache local). */
export async function ensureCategoryNames() {
  const missing = q.all<{ id: string }>(
    `SELECT DISTINCT category_id id FROM (SELECT category_id FROM listings UNION SELECT category_id FROM order_items)
     WHERE id IS NOT NULL AND id NOT IN (SELECT id FROM categories) LIMIT 40`,
  );
  for (const { id } of missing) {
    try {
      const c = await ml<any>(`/categories/${id}`, { anonymous: !getAccount() });
      q.run("INSERT OR REPLACE INTO categories (id, name, path, max_title_length, raw, fetched_at) VALUES (?,?,?,?,?,?)", [
        id, c.name, (c.path_from_root ?? []).map((p: any) => p.name).join(" > "), c.settings?.max_title_length ?? null, JSON.stringify(c), new Date().toISOString(),
      ]);
    } catch { /* ignora categorias inacessíveis */ }
  }
}

/** Snapshot compacto de dados reais para a IA (sem dados pessoais de compradores). */
export function storeSnapshot() {
  const d30 = resolvePeriod("30d");
  const prev30 = previousRange(d30);
  const d7 = resolvePeriod("7d");
  const prev7 = previousRange(d7);
  const dash = dashboard("30d");
  const profit = profitByListing(d30);
  const listings = q.all<any>(
    `SELECT l.id, l.title, l.price, l.status, l.available_quantity, l.sold_quantity, l.listing_type_id, l.health, l.category_id, l.free_shipping,
            p.id product_id, p.stock_qty, p.min_stock, p.made_to_order,
            (SELECT SUM(visits) FROM visits_daily v WHERE v.scope = l.id AND v.date >= ?) visits_30d
     FROM listings l LEFT JOIN products p ON p.id = l.product_id WHERE l.status IN ('active','paused','under_review') ORDER BY l.sold_quantity DESC LIMIT 80`,
    [d30.from],
  );
  const growth7 = growthByListing(d7, prev7);
  const growth30 = growthByListing(d30, prev30);
  const noSales = q.all<any>(
    `SELECT l.id, l.title, l.price, l.available_quantity,
       (SELECT MAX(o.date_created) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.listing_id=l.id AND o.status='paid') last_sale
     FROM listings l WHERE l.status='active'`,
  ).filter((x) => !x.last_sale || Date.parse(x.last_sale) < Date.now() - 30 * 86_400_000).slice(0, 30);
  return {
    generated_at: new Date().toISOString(),
    today_local: localDate(new Date()),
    kpis_30d: dash.kpis,
    changes_vs_previous_30d: dash.changes,
    revenue_daily_30d: dash.charts.series.map((s) => ({ date: s.date, revenue: s.revenue, orders: s.orders })),
    profitability_30d: profit.slice(0, 40),
    listings,
    growth_7d_vs_prev: growth7.slice(0, 15),
    decline_30d_vs_prev: growth30.filter((g) => g.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 15),
    active_without_sales_30d: noSales,
    open_alerts: q.all("SELECT type, severity, title, message FROM alerts WHERE status='open' ORDER BY created_at DESC LIMIT 30"),
    ads_campaigns: dash.charts.campaigns,
    data_gaps: dataGaps(),
  };
}

export function dataGaps(): string[] {
  const gaps: string[] = [];
  if (!getAccount()) gaps.push("Conta do Mercado Livre não conectada: não há dados reais de vendas.");
  const noCost = q.get<{ n: number }>("SELECT COUNT(*) n FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_costs c WHERE c.product_id=p.id)")!.n;
  if (noCost) gaps.push(`${noCost} produto(s) sem ficha de custos: lucro e margem desses itens não podem ser calculados.`);
  const s = q.all<{ resource: string; status: string; message: string | null }>("SELECT resource, status, message FROM sync_state WHERE status='error'");
  for (const x of s) gaps.push(`Sincronização de ${x.resource} com erro: ${x.message}`);
  if (!q.get("SELECT 1 FROM visits_daily WHERE scope='store'")) gaps.push("Sem dados de visitas: taxa de conversão indisponível.");
  if (!q.get("SELECT 1 FROM ads_campaigns")) gaps.push("Sem dados de publicidade (Product Ads não disponível ou sem campanhas).");
  return gaps;
}

