import { q, json } from "../db/index.ts";
import { calculate, feesFor, getCostConfig } from "./costs3d.ts";
import { getProductCosts, productionCost } from "./finance.ts";

export type ListingClass = "campeao" | "oportunidade" | "escalavel" | "subperformer" | "critico" | "sem_dados";
export const CLASS_LABEL: Record<ListingClass, string> = {
  campeao: "Campeão", oportunidade: "Oportunidade", escalavel: "Escalável", subperformer: "Subperformer", critico: "Crítico", sem_dados: "Dados insuficientes",
};

/**
 * Central de anúncios: visitas, vendas, conversão, margem e lucro por unidade calculados a partir dos dados
 * armazenados (API, importações ou relatório inicial). Nada é estimado sem custos/tarifas cadastrados.
 */
export function listingsCenter(opts: { days?: number; channel?: string; search?: string; status?: string } = {}) {
  const days = opts.days ?? 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const sinceDay = since.slice(0, 10);
  const where: string[] = [];
  const params: any[] = [];
  if (opts.channel && opts.channel !== "all") { where.push("l.channel = ?"); params.push(opts.channel); }
  if (opts.status && opts.status !== "all") { where.push("l.status = ?"); params.push(opts.status); }
  if (opts.search) { where.push("(l.title LIKE ? OR l.id LIKE ? OR l.sku LIKE ?)"); const s = `%${opts.search}%`; params.push(s, s, s); }
  const rows = q.all<any>(
    `SELECT l.id, l.title, l.sku, l.price, l.original_price, l.available_quantity, l.sold_quantity, l.status, l.thumbnail, l.permalink, l.health, l.quality_score,
       l.competition_status, l.channel, l.source, l.product_id, l.listing_type_id, l.category_id, l.visits_total,
       p.name product_name, p.weight_g, p.print_minutes, COALESCE(p.material,'PLA') material, p.stock_qty, p.min_stock, p.made_to_order,
       COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.listing_id=l.id AND o.status='paid' AND o.date_created >= ?),0) units_period,
       COALESCE((SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.listing_id=l.id AND o.status='paid' AND o.date_created >= ?),0) orders_period,
       COALESCE((SELECT SUM(oi.quantity*oi.unit_price) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.listing_id=l.id AND o.status='paid' AND o.date_created >= ?),0) revenue_period,
       (SELECT AVG(oi.sale_fee) FROM order_items oi WHERE oi.listing_id=l.id AND oi.sale_fee IS NOT NULL) avg_sale_fee,
       (SELECT SUM(visits) FROM visits_daily v WHERE v.scope=l.id AND v.date >= ?) visits_period
     FROM listings l LEFT JOIN products p ON p.id=l.product_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`,
    [since, since, since, sinceDay, ...params],
  );
  const cfg = getCostConfig();
  const enriched = rows.map((l) => {
    const visits: number | null = l.visits_period ?? l.visits_total ?? null;
    const conversion = visits && visits > 0 ? (l.orders_period / visits) * 100 : null;
    const unit = unitEconomics(l, cfg);
    return { ...l, visits, conversion_pct: conversion, unit_profit: unit.profit, margin_pct: unit.margin, unit_cost_source: unit.source, unit_missing: unit.missing };
  });

  // Referências da loja para classificar
  const withVisits = enriched.filter((l) => l.visits && l.visits > 0);
  const storeConv = withVisits.length ? (withVisits.reduce((s, l) => s + l.orders_period, 0) / withVisits.reduce((s, l) => s + l.visits!, 0)) * 100 : null;
  const sortedVisits = withVisits.map((l) => l.visits!).sort((a, b) => a - b);
  const medianVisits = sortedVisits.length ? sortedVisits[Math.floor(sortedVisits.length / 2)]! : null;
  const unitsSorted = enriched.map((l) => l.units_period).filter((u) => u > 0).sort((a, b) => b - a);
  const top20Cut = unitsSorted.length ? unitsSorted[Math.max(0, Math.ceil(unitsSorted.length * 0.2) - 1)]! : Infinity;

  const classified = enriched.map((l) => {
    const reasons: string[] = [];
    let cls: ListingClass = "sem_dados";
    const active = l.status === "active";
    if (active && (l.available_quantity ?? 1) <= 0) { cls = "critico"; reasons.push("sem estoque disponível"); }
    else if (l.margin_pct !== null && l.margin_pct < 0) { cls = "critico"; reasons.push(`margem negativa (${l.margin_pct.toFixed(1)}%)`); }
    else if (active && l.visits && l.visits >= 50 && l.orders_period === 0) { cls = "critico"; reasons.push(`${l.visits} visitas sem vendas`); }
    else if (l.visits === null && l.units_period === 0) { cls = "sem_dados"; reasons.push("sem visitas e vendas registradas no período"); }
    else if (l.units_period > 0 && l.units_period >= top20Cut && (storeConv === null || (l.conversion_pct ?? 0) >= storeConv * 0.9)) { cls = "campeao"; reasons.push("entre os 20% que mais vendem"); }
    else if (storeConv !== null && l.conversion_pct !== null && l.conversion_pct >= storeConv * 1.2 && medianVisits !== null && (l.visits ?? 0) <= medianVisits) { cls = "escalavel"; reasons.push("conversão acima da loja com pouco tráfego — mais visitas tendem a gerar vendas"); }
    else if (storeConv !== null && l.conversion_pct !== null && medianVisits !== null && (l.visits ?? 0) >= medianVisits && l.conversion_pct < storeConv) { cls = "oportunidade"; reasons.push("tráfego relevante com conversão abaixo da loja — otimizar título, fotos e preço"); }
    else { cls = "subperformer"; reasons.push("baixo tráfego e poucas vendas"); }
    if (l.quality_score !== null && l.quality_score < 70) reasons.push(`qualidade ${l.quality_score}`);
    // Pontuação de prioridade: receita em jogo + potencial de conversão + urgência
    const lostVisits = storeConv !== null && l.visits && l.conversion_pct !== null && l.conversion_pct < storeConv ? l.visits * (storeConv - l.conversion_pct) / 100 : 0;
    const priority = l.revenue_period * 0.5 + lostVisits * (l.price ?? 0) + (cls === "critico" ? 500 : 0) + (cls === "escalavel" ? 200 : 0);
    return { ...l, class: cls, class_label: CLASS_LABEL[cls], reasons, priority_score: Math.round(priority) };
  });
  const counts = Object.fromEntries(Object.keys(CLASS_LABEL).map((k) => [k, classified.filter((l) => l.class === k).length]));
  return {
    days, store_conversion_pct: storeConv, median_visits: medianVisits, counts,
    rows: classified.sort((a, b) => b.revenue_period - a.revenue_period || (b.visits ?? 0) - (a.visits ?? 0)),
    priority: [...classified].filter((l) => l.status === "active").sort((a, b) => b.priority_score - a.priority_score).slice(0, 20),
  };
}

/** Lucro e margem por unidade: ficha de custos do produto ou calculadora 3D (peso/tempo) + tarifas configuradas. */
function unitEconomics(l: any, cfg: ReturnType<typeof getCostConfig>) {
  if (!l.price) return { profit: null, margin: null, source: null, missing: ["preço"] };
  const fees = feesFor(l.id, l.channel ?? "mercadolivre");
  const feePct = fees.fee_pct ?? (l.avg_sale_fee && l.price ? (l.avg_sale_fee / l.price) * 100 : null);
  const fixedFee = fees.fee_pct === null && l.avg_sale_fee ? 0 : fees.fixed_fee;
  if (l.product_id) {
    const sheet = getProductCosts(l.product_id);
    if (sheet && productionCost(sheet) > 0) {
      if (feePct === null) return { profit: null, margin: null, source: "ficha de custos", missing: ["tarifa do marketplace"] };
      const cost = productionCost(sheet) + sheet.shipping_cost_seller + sheet.ads_cost_per_unit + (fixedFee ?? 0) + l.price * (feePct / 100) + l.price * (sheet.tax_rate_pct / 100);
      const profit = l.price - cost;
      return { profit: Math.round(profit * 100) / 100, margin: (profit / l.price) * 100, source: "ficha de custos", missing: [] };
    }
    if (l.weight_g && l.print_minutes) {
      const c = calculate({ weight_g: l.weight_g, print_minutes: l.print_minutes, material: l.material, sale_price: l.price, fee_pct: feePct, fixed_fee: fixedFee, shipping: fees.shipping_cost, ads_pct: fees.ads_pct }, cfg);
      if (!c.complete) return { profit: null, margin: null, source: "calculadora 3D", missing: c.missing };
      return { profit: c.contribution_margin, margin: c.margin_pct, source: "calculadora 3D", missing: [] };
    }
  }
  return { profit: null, margin: null, source: null, missing: ["custos do produto (ficha ou peso/tempo)"] };
}

export function listingDetail(id: string) {
  const l = q.get<any>("SELECT * FROM listings WHERE id=?", [id]);
  if (!l) return null;
  const center = listingsCenter({ days: 30 }).rows.find((r) => r.id === id);
  const raw = json.parse<any>(l.raw, {});
  return {
    ...center, raw: undefined,
    pictures: (raw.pictures ?? []).map((p: any) => p.secure_url ?? p.url),
    attributes: (raw.attributes ?? []).map((a: any) => ({ name: a.name, value: a.value_name })),
    sales: q.all("SELECT date(datetime(o.date_created,'-180 minutes')) date, SUM(oi.quantity) units, SUM(oi.quantity*oi.unit_price) revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.listing_id=? AND o.status='paid' GROUP BY 1 ORDER BY 1", [id]),
    visits_series: q.all("SELECT date, visits FROM visits_daily WHERE scope=? ORDER BY date", [id]),
    fee_override: q.get("SELECT * FROM listing_fee_overrides WHERE listing_id=?", [id]) ?? null,
    competitors: q.all("SELECT id, name, price, url, rating, reviews FROM competitors WHERE our_listing_id=?", [id]),
  };
}
