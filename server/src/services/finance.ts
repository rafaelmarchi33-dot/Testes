import { q, getSetting } from "../db/index.ts";
import { config } from "../config.ts";
import { ml, getAccount } from "../ml/client.ts";
import type { Range } from "../lib/dates.ts";

export interface CostProfile {
  material_cost: number;
  manufacturing_cost: number;
  energy_cost: number;
  production_minutes: number;
  labor_cost_per_hour: number;
  packaging_cost: number;
  operational_cost: number;
  shipping_cost_seller: number;
  ads_cost_per_unit: number;
  tax_rate_pct: number;
  other_cost: number;
}

export const emptyCosts = (): CostProfile => ({
  material_cost: 0, manufacturing_cost: 0, energy_cost: 0, production_minutes: 0, labor_cost_per_hour: 0, packaging_cost: 0,
  operational_cost: 0, shipping_cost_seller: 0, ads_cost_per_unit: 0, tax_rate_pct: 0, other_cost: 0,
});

/** Custo de produção por unidade (sem taxas da plataforma, frete, publicidade e impostos). */
export function productionCost(c: CostProfile): number {
  const labor = (c.production_minutes / 60) * c.labor_cost_per_hour;
  return round2(c.material_cost + c.manufacturing_cost + c.energy_cost + labor + c.packaging_cost + c.operational_cost + c.other_cost);
}

export interface FeeInfo {
  percentage: number; // ex.: 0.165 = 16,5%
  fixed: number;      // tarifa fixa por unidade (R$)
  source: "mercadolivre" | "manual";
  listing_type_id?: string;
}

export interface Simulation {
  price: number;
  revenue: number;
  platform_fee: number;
  fixed_fee: number;
  shipping: number;
  ads: number;
  taxes: number;
  production_cost: number;
  total_cost: number;
  net_profit: number;
  margin_pct: number;     // lucro / receita
  roi_pct: number | null; // lucro / custo total desembolsado
  min_price: number;      // preço de equilíbrio (lucro zero)
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Simula a venda de 1 unidade a um preço, com estrutura de custos e taxas. */
export function simulate(price: number, costs: CostProfile, fee: FeeInfo): Simulation {
  const prod = productionCost(costs);
  const platformFee = price * fee.percentage;
  const taxes = price * (costs.tax_rate_pct / 100);
  const variable = prod + costs.shipping_cost_seller + costs.ads_cost_per_unit + fee.fixed;
  const totalCost = variable + platformFee + taxes;
  const profit = price - totalCost;
  const denom = 1 - fee.percentage - costs.tax_rate_pct / 100;
  return {
    price: round2(price),
    revenue: round2(price),
    platform_fee: round2(platformFee),
    fixed_fee: round2(fee.fixed),
    shipping: round2(costs.shipping_cost_seller),
    ads: round2(costs.ads_cost_per_unit),
    taxes: round2(taxes),
    production_cost: prod,
    total_cost: round2(totalCost),
    net_profit: round2(profit),
    margin_pct: price > 0 ? round2((profit / price) * 100) : 0,
    roi_pct: totalCost > 0 ? round2((profit / totalCost) * 100) : null,
    min_price: denom > 0 ? round2(variable / denom) : Infinity,
  };
}

/** Preço necessário para atingir a margem-alvo (lucro/receita). */
export function priceForMargin(targetMarginPct: number, costs: CostProfile, fee: FeeInfo): number | null {
  const denom = 1 - fee.percentage - costs.tax_rate_pct / 100 - targetMarginPct / 100;
  if (denom <= 0) return null;
  const variable = productionCost(costs) + costs.shipping_cost_seller + costs.ads_cost_per_unit + fee.fixed;
  return round2(variable / denom);
}

/** Ponto de equilíbrio mensal em unidades, dado o custo fixo mensal da operação. */
export function breakEvenUnits(monthlyFixed: number, sim: Simulation): number | null {
  const contribution = sim.net_profit; // custos variáveis já descontados
  if (contribution <= 0) return null;
  return Math.ceil(monthlyFixed / contribution);
}

/**
 * Consulta a tarifa oficial de venda do Mercado Livre para preço/categoria/tipo de anúncio.
 * Endpoint: /sites/{SITE}/listing_prices
 */
export async function fetchFee(price: number, categoryId: string | undefined, listingTypeId = "gold_special"): Promise<FeeInfo> {
  const qs = new URLSearchParams({ price: String(price), listing_type_id: listingTypeId });
  if (categoryId) qs.set("category_id", categoryId);
  const r = await ml<any>(`/sites/${config.ml.siteId}/listing_prices?${qs}`, { anonymous: !getAccount() });
  const row = Array.isArray(r) ? r.find((x) => x.listing_type_id === listingTypeId) ?? r[0] : r;
  const d = row?.sale_fee_details ?? {};
  const pct = typeof d.percentage_fee === "number" ? d.percentage_fee / 100 : row?.sale_fee_amount && price ? (row.sale_fee_amount - (d.fixed_fee ?? 0)) / price : 0;
  return { percentage: pct, fixed: d.fixed_fee ?? 0, source: "mercadolivre", listing_type_id: listingTypeId };
}

/** Recomenda preço: itera porque a tarifa fixa do ML depende da faixa de preço. */
export async function recommendPrice(costs: CostProfile, categoryId: string | undefined, listingTypeId: string, targetMarginPct: number) {
  let fee = await fetchFee(Math.max(productionCost(costs) * 2, 50), categoryId, listingTypeId);
  let price = priceForMargin(targetMarginPct, costs, fee);
  for (let i = 0; i < 3 && price; i++) {
    fee = await fetchFee(price, categoryId, listingTypeId);
    const next = priceForMargin(targetMarginPct, costs, fee);
    if (next === null || Math.abs(next - price) < 0.01) { price = next; break; }
    price = next;
  }
  return { price, fee, simulation: price ? simulate(price, costs, fee) : null };
}

export function getProductCosts(productId: number): CostProfile | null {
  const r = q.get<CostProfile>("SELECT * FROM product_costs WHERE product_id=?", [productId]);
  if (!r) return null;
  const { product_id: _p, updated_at: _u, ...rest } = r as any;
  return rest as CostProfile;
}

// ------------------------------------------------------------------
// Rentabilidade realizada (pedidos pagos do período)
// ------------------------------------------------------------------
export interface ProfitRow {
  listing_id: string;
  product_id: number | null;
  title: string;
  units: number;
  orders: number;
  revenue: number;
  sale_fees: number;
  shipping: number;
  production_cost: number | null;
  taxes: number;
  ads: number;
  profit: number | null;
  margin_pct: number | null;
  cost_known: boolean;
}

/**
 * Rentabilidade por anúncio:
 * - receita = preço unitário × quantidade (pedidos pagos)
 * - tarifas = sale_fee informado pelo ML no pedido (por unidade) × quantidade
 * - frete = custo do envio pago pelo vendedor (/shipments/{id}/costs), rateado por receita entre pedidos/itens do mesmo envio
 * - custo de produção e impostos = ficha de custos do produto (quando cadastrada)
 * - publicidade = custo do Product Ads do anúncio (proporcional aos dias do período) ou custo/unidade da ficha
 * Lucro só é calculado quando há ficha de custos; caso contrário fica null (sem inventar).
 */
export function profitByListing(range: Range): ProfitRow[] {
  const items = q.all<any>(
    `SELECT oi.order_id, oi.listing_id, oi.title, oi.quantity, oi.unit_price, oi.sale_fee, o.total_amount, o.shipping_id,
            l.product_id, COALESCE(l.title, oi.title) AS ltitle
     FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN listings l ON l.id = oi.listing_id
     WHERE o.status = 'paid' AND o.date_created >= ? AND o.date_created < ?`,
    [range.fromUtc, range.toUtc],
  );
  // Rateio do frete por envio
  const shipIds = [...new Set(items.map((i) => i.shipping_id).filter(Boolean))];
  const shipCost = new Map<number, number>();
  const shipRevenue = new Map<number, number>();
  if (shipIds.length) {
    for (const s of q.all<any>(`SELECT id, seller_cost FROM shipments WHERE id IN (${shipIds.map(() => "?").join(",")})`, shipIds)) {
      shipCost.set(s.id, s.seller_cost ?? 0);
    }
    for (const i of items) if (i.shipping_id) shipRevenue.set(i.shipping_id, (shipRevenue.get(i.shipping_id) ?? 0) + i.unit_price * i.quantity);
  }
  const costCache = new Map<number, CostProfile | null>();
  const adsCost = new Map<string, number>();
  for (const a of q.all<any>("SELECT listing_id, cost, date_from, date_to FROM ads_item_metrics")) {
    const overlap = overlapDays(range.from, range.to, a.date_from, a.date_to);
    const span = overlapDays(a.date_from, a.date_to, a.date_from, a.date_to);
    if (overlap > 0 && span > 0) adsCost.set(a.listing_id, (adsCost.get(a.listing_id) ?? 0) + (a.cost ?? 0) * (overlap / span));
  }

  const by = new Map<string, ProfitRow & { _orders: Set<number> }>();
  for (const i of items) {
    const rev = i.unit_price * i.quantity;
    let row = by.get(i.listing_id);
    if (!row) {
      row = { listing_id: i.listing_id, product_id: i.product_id, title: i.ltitle, units: 0, orders: 0, revenue: 0, sale_fees: 0, shipping: 0,
        production_cost: 0, taxes: 0, ads: 0, profit: null, margin_pct: null, cost_known: false, _orders: new Set() };
      by.set(i.listing_id, row);
    }
    row.units += i.quantity;
    row._orders.add(i.order_id);
    row.revenue += rev;
    row.sale_fees += (i.sale_fee ?? 0) * i.quantity;
    if (i.shipping_id && shipRevenue.get(i.shipping_id)) row.shipping += (shipCost.get(i.shipping_id) ?? 0) * (rev / shipRevenue.get(i.shipping_id)!);
    if (i.product_id && !costCache.has(i.product_id)) costCache.set(i.product_id, getProductCosts(i.product_id));
  }
  return [...by.values()].map(({ _orders, ...r }) => {
    const costs = r.product_id ? costCache.get(r.product_id) ?? null : null;
    r.orders = _orders.size;
    r.ads = adsCost.get(r.listing_id) ?? (costs ? costs.ads_cost_per_unit * r.units : 0);
    if (costs) {
      r.cost_known = true;
      r.production_cost = productionCost(costs) * r.units;
      r.taxes = r.revenue * (costs.tax_rate_pct / 100);
      // Frete: usa o custo real do envio; se não houver, usa o valor da ficha
      if (r.shipping === 0 && costs.shipping_cost_seller) r.shipping = costs.shipping_cost_seller * r.units;
      r.profit = r.revenue - r.sale_fees - r.shipping - r.production_cost - r.taxes - r.ads;
      r.margin_pct = r.revenue > 0 ? (r.profit / r.revenue) * 100 : null;
    } else {
      r.production_cost = null;
    }
    for (const k of ["revenue", "sale_fees", "shipping", "taxes", "ads"] as const) r[k] = round2(r[k]);
    if (r.production_cost !== null) r.production_cost = round2(r.production_cost);
    if (r.profit !== null) r.profit = round2(r.profit);
    if (r.margin_pct !== null) r.margin_pct = round2(r.margin_pct);
    return r;
  }).sort((a, b) => b.revenue - a.revenue);
}

function overlapDays(aFrom: string, aTo: string, bFrom: string, bTo: string) {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  return to < from ? 0 : Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

export const financeDefaults = () => ({
  target_margin_pct: getSetting<number>("target_margin_pct", 25),
  min_margin_pct: getSetting<number>("min_margin_pct", 10),
  default_listing_type: getSetting<string>("default_listing_type", "gold_special"),
  monthly_fixed_costs: getSetting<number>("monthly_fixed_costs", 0),
  default_tax_rate_pct: getSetting<number>("default_tax_rate_pct", 0),
  energy_kwh_price: getSetting<number>("energy_kwh_price", 0),
  labor_cost_per_hour: getSetting<number>("labor_cost_per_hour", 0),
});
