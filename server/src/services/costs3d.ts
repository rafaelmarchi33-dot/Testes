import { q, getSetting, setSetting } from "../db/index.ts";

/**
 * Configuração de custos da operação de impressão 3D.
 * Valores começam em null = "não informado". O sistema nunca presume custos:
 * os cálculos mostram quais itens estão faltando.
 */
export interface CostConfig {
  filament_price_per_kg: Record<string, number | null>; // por material (PLA, PETG…)
  energy_kwh_price: number | null;          // R$/kWh
  printer_power_watts: number | null;       // consumo médio da impressora (W)
  depreciation_per_hour: number | null;     // R$/hora de máquina
  maintenance_per_hour: number | null;      // R$/hora de máquina
  labor_per_hour: number | null;            // R$/hora de mão de obra
  labor_minutes_per_unit: number | null;    // minutos de mão de obra por unidade (pós-processo, embalagem)
  packaging_per_unit: number | null;
  finishing_per_unit: number | null;
  failure_rate_pct: number | null;          // perdas/falhas de impressão (%)
  ads_pct: number | null;                   // publicidade como % do preço
  tax_pct: number | null;                   // impostos sobre a venda (%)
  seller_shipping_per_unit: number | null;  // frete suportado pelo vendedor
  monthly_fixed_costs: number | null;       // custos fixos mensais (para ponto de equilíbrio)
  target_margin_pct: number;                // margem-alvo para preço recomendado
  promo_margin_pct: number;                 // margem mínima aceitável em promoção
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  filament_price_per_kg: { PLA: null, PETG: null },
  energy_kwh_price: null, printer_power_watts: null, depreciation_per_hour: null, maintenance_per_hour: null,
  labor_per_hour: null, labor_minutes_per_unit: null, packaging_per_unit: null, finishing_per_unit: null,
  failure_rate_pct: null, ads_pct: null, tax_pct: null, seller_shipping_per_unit: null, monthly_fixed_costs: null,
  target_margin_pct: 30, promo_margin_pct: 15,
};

export function getCostConfig(): CostConfig {
  const c = getSetting<Partial<CostConfig>>("cost_config", {});
  return { ...DEFAULT_COST_CONFIG, ...c, filament_price_per_kg: { ...DEFAULT_COST_CONFIG.filament_price_per_kg, ...(c.filament_price_per_kg ?? {}) } };
}
export function saveCostConfig(c: Partial<CostConfig>) {
  const merged = { ...getCostConfig(), ...c };
  setSetting("cost_config", merged);
  return merged;
}

export interface ChannelFees { id: string; name: string; fee_pct: number | null; fixed_fee: number | null; shipping_cost: number | null }
export const listChannels = () => q.all<ChannelFees & { active: number; notes: string | null }>("SELECT * FROM channels ORDER BY name");

/** Tarifas efetivas de um anúncio: override do anúncio > canal. */
export function feesFor(listingId: string | null, channelId = "mercadolivre") {
  const ch = q.get<ChannelFees>("SELECT * FROM channels WHERE id=?", [channelId]);
  const ov = listingId ? q.get<any>("SELECT * FROM listing_fee_overrides WHERE listing_id=?", [listingId]) : undefined;
  return {
    fee_pct: ov?.fee_pct ?? ch?.fee_pct ?? null,
    fixed_fee: ov?.fixed_fee ?? ch?.fixed_fee ?? null,
    shipping_cost: ov?.shipping_cost ?? ch?.shipping_cost ?? null,
    ads_pct: ov?.ads_pct ?? null,
    source: ov ? "anúncio" : "canal",
  };
}

export interface CalcInput {
  weight_g: number;
  print_minutes: number;
  material: string;
  sale_price: number;
  fee_pct?: number | null;        // taxa percentual do marketplace
  fixed_fee?: number | null;      // tarifa fixa por venda
  packaging?: number | null;
  other_costs?: number | null;
  shipping?: number | null;
  ads_pct?: number | null;
  tax_pct?: number | null;
  units_per_plate?: number | null; // informativo: tempo de impressão é sempre por unidade
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const nz = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Calculadora de produto impresso em 3D.
 * - custo de filamento = peso × (1 + perdas) × preço/kg do material
 * - energia = potência (kW) × horas × R$/kWh
 * - custo de produção = filamento + energia + depreciação + manutenção + mão de obra + acabamento
 * - custo variável total = produção + embalagem + outros + frete + taxas (% e fixa) + publicidade + impostos
 * - margem de contribuição = preço − custo variável total (nunca é faturamento)
 */
export function calculate(input: CalcInput, cfg: CostConfig = getCostConfig()) {
  const missing: string[] = [];
  const need = (v: number | null | undefined, label: string) => {
    if (v === null || v === undefined) missing.push(label);
    return nz(v);
  };
  const hours = input.print_minutes / 60;
  const failure = nz(cfg.failure_rate_pct) / 100;
  const pricePerKg = cfg.filament_price_per_kg[input.material] ?? avgFilamentPrice(input.material);
  const filament = (input.weight_g * (1 + failure) / 1000) * need(pricePerKg, `preço do filamento ${input.material}/kg`);
  const energy = (need(cfg.printer_power_watts, "consumo da impressora (W)") / 1000) * hours * need(cfg.energy_kwh_price, "preço da energia (kWh)");
  const depreciation = hours * need(cfg.depreciation_per_hour, "depreciação por hora");
  const maintenance = hours * need(cfg.maintenance_per_hour, "manutenção por hora");
  const labor = (need(cfg.labor_minutes_per_unit, "minutos de mão de obra por unidade") / 60) * need(cfg.labor_per_hour, "custo da mão de obra/hora");
  const finishing = need(cfg.finishing_per_unit, "acabamento por unidade");
  const production = filament + energy + depreciation + maintenance + labor + finishing;

  const packaging = input.packaging ?? need(cfg.packaging_per_unit, "embalagem por unidade");
  const other = nz(input.other_costs);
  const shipping = input.shipping ?? need(cfg.seller_shipping_per_unit, "frete suportado pelo vendedor");
  const feePct = (input.fee_pct ?? need(null, "taxa percentual do marketplace")) / 100;
  const fixedFee = input.fixed_fee ?? 0;
  const adsPct = (input.ads_pct ?? need(cfg.ads_pct, "publicidade (% do preço)")) / 100;
  const taxPct = (input.tax_pct ?? need(cfg.tax_pct, "impostos (%)")) / 100;
  const pctTotal = feePct + adsPct + taxPct;

  const fixedVariable = production + packaging + other + shipping + fixedFee;
  const price = input.sale_price;
  const marketplace = price * feePct + fixedFee;
  const ads = price * adsPct;
  const taxes = price * taxPct;
  const totalVariable = production + packaging + other + shipping + marketplace + ads + taxes;
  const contribution = price - totalVariable;
  const margin = price > 0 ? (contribution / price) * 100 : 0;

  const priceFor = (marginPct: number) => {
    const d = 1 - pctTotal - marginPct / 100;
    return d > 0 ? r2(fixedVariable / d) : null;
  };
  const minPrice = priceFor(0);
  const recommended = priceFor(cfg.target_margin_pct);
  const promo = priceFor(cfg.promo_margin_pct);
  const fixedMonthly = cfg.monthly_fixed_costs;

  return {
    inputs: input,
    filament_cost: r2(filament),
    energy_cost: r2(energy),
    depreciation_cost: r2(depreciation),
    maintenance_cost: r2(maintenance),
    labor_cost: r2(labor),
    finishing_cost: r2(finishing),
    production_cost: r2(production),
    packaging_cost: r2(packaging),
    other_costs: r2(other),
    shipping_cost: r2(shipping),
    marketplace_fees: r2(marketplace),
    ads_cost: r2(ads),
    taxes: r2(taxes),
    total_variable_cost: r2(totalVariable),
    contribution_margin: r2(contribution),
    estimated_profit: r2(contribution), // lucro por unidade antes dos custos fixos
    margin_pct: r2(margin),
    min_price: minPrice,
    recommended_price: recommended,
    promo_price: promo,
    profit_per_print_hour: hours > 0 ? r2(contribution / hours) : null,
    break_even_units: fixedMonthly && contribution > 0 ? Math.ceil(fixedMonthly / contribution) : null,
    monthly_fixed_costs: fixedMonthly,
    filament_price_per_kg: pricePerKg ?? null,
    missing: [...new Set(missing)],
    complete: missing.length === 0,
  };
}
export type CalcResult = ReturnType<typeof calculate>;

/** Preço médio ponderado do filamento em estoque (quando não configurado manualmente). */
export function avgFilamentPrice(material: string): number | null {
  const r = q.get<{ p: number | null }>(
    "SELECT SUM(cost_per_kg*total_g)/NULLIF(SUM(total_g),0) p FROM filaments WHERE material=? AND cost_per_kg IS NOT NULL AND active=1",
    [material],
  );
  return r?.p ? r2(r.p) : null;
}

/** Cenários de volume (1, 10, 50, 100, 500 unidades). */
export function scenarios(calc: CalcResult, volumes = [1, 10, 50, 100, 500], hoursPerDay = 16, machines = 1) {
  const fixed = calc.monthly_fixed_costs ?? 0;
  const minutes = calc.inputs.print_minutes; // tempo por unidade
  return volumes.map((v) => {
    const revenue = calc.inputs.sale_price * v;
    const variable = calc.total_variable_cost * v;
    const contribution = revenue - variable;
    const printHours = (minutes * v) / 60;
    return {
      units: v,
      revenue: r2(revenue),
      variable_costs: r2(variable),
      contribution: r2(contribution),
      fixed_costs: r2(fixed),
      result_after_fixed: calc.monthly_fixed_costs === null ? null : r2(contribution - fixed),
      filament_kg: r2((calc.inputs.weight_g * v) / 1000),
      print_hours: r2(printHours),
      machine_days: r2(printHours / (hoursPerDay * Math.max(1, machines))),
    };
  });
}

/** Ranking de rentabilidade dos produtos que têm peso/tempo e preço conhecidos. */
export function profitabilityRanking() {
  const cfg = getCostConfig();
  const rows = q.all<any>(
    `SELECT p.id, p.name, p.sku, p.weight_g, p.print_minutes, COALESCE(p.material,'PLA') material, p.units_per_plate,
       (SELECT price FROM listings l WHERE l.product_id=p.id AND l.status='active' ORDER BY l.sold_quantity DESC LIMIT 1) price,
       (SELECT id FROM listings l WHERE l.product_id=p.id AND l.status='active' ORDER BY l.sold_quantity DESC LIMIT 1) listing_id,
       (SELECT channel FROM listings l WHERE l.product_id=p.id LIMIT 1) channel
     FROM products p`,
  );
  return rows.map((p) => {
    if (!p.weight_g || !p.print_minutes || !p.price) {
      return { ...p, calc: null, pending: [!p.weight_g && "peso", !p.print_minutes && "tempo de impressão", !p.price && "preço de venda"].filter(Boolean) };
    }
    const fees = feesFor(p.listing_id, p.channel ?? "mercadolivre");
    const calc = calculate({ weight_g: p.weight_g, print_minutes: p.print_minutes, material: p.material, sale_price: p.price, fee_pct: fees.fee_pct, fixed_fee: fees.fixed_fee, shipping: fees.shipping_cost, ads_pct: fees.ads_pct, units_per_plate: p.units_per_plate }, cfg);
    return { ...p, calc, pending: calc.missing };
  }).sort((a, b) => (b.calc?.profit_per_print_hour ?? -1e9) - (a.calc?.profit_per_print_hour ?? -1e9));
}
