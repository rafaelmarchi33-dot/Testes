import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { q } = await import("../src/db/index.ts");
const { calculate, scenarios, DEFAULT_COST_CONFIG, saveCostConfig } = await import("../src/services/costs3d.ts");
const { scoreOpportunity, saveOpportunity, oppSchema, addOpportunityToLab, convertLabToProduct } = await import("../src/services/rnd.ts");
const { parseCsv, parseDate, parseNumber, buildPreview, commitImport, undoImport, parseMetricsText, guessKind } = await import("../src/services/imports.ts");
const { goalProgress, derivePrevious, periodReports, goalSimulation } = await import("../src/services/company.ts");
const { overview } = await import("../src/services/overview.ts");
const { transitionOrder, productionPlanner, moveFilament } = await import("../src/services/factory.ts");
const { listingsCenter } = await import("../src/services/listingsIntel.ts");
const { evaluateAlerts } = await import("../src/services/alerts.ts");
const { routineData, isDue } = await import("../src/services/routines.ts");
const { dre } = await import("../src/services/dre.ts");

test("dados iniciais reais cadastrados como importação inicial", () => {
  const c = q.get<any>("SELECT * FROM companies")!;
  assert.equal(c.listings_identified, 95);
  assert.equal(c.monthly_goal, 20000);
  const r = periodReports()[0]!;
  assert.equal(r.gross_sales, 1872);
  assert.equal(r.source, "initial_import");
  // anterior derivado: 1872 / 1,791 ≈ 1045,23; conversão 6,9 + 7 = 13,9
  assert.equal(derivePrevious(r).gross_sales, 1045.23);
  assert.equal(derivePrevious(r).conversion_pct, 13.9);
  const l = q.get<any>("SELECT * FROM listings WHERE id='INICIAL-HOLLYLAND-M2'")!;
  assert.equal(l.price, 45);
  assert.equal(l.original_price, 50);
  assert.equal(l.quality_score, 94);
  const p = q.get<any>("SELECT * FROM products WHERE id=?", [l.product_id])!;
  assert.equal(p.stock_qty, 0, "estoque físico não informado não pode virar 949");
  assert.equal(q.get<any>("SELECT model FROM machines")!.model, "Bambu Lab A1 Combo");
});

test("calculadora 3D: custos, margem de contribuição, preços e pendências", () => {
  const cfg = { ...DEFAULT_COST_CONFIG, filament_price_per_kg: { PLA: 100, PETG: 120 }, energy_kwh_price: 1, printer_power_watts: 100, depreciation_per_hour: 0.5, maintenance_per_hour: 0.2,
    labor_per_hour: 30, labor_minutes_per_unit: 6, packaging_per_unit: 2, finishing_per_unit: 1, failure_rate_pct: 10, ads_pct: 0, tax_pct: 6, seller_shipping_per_unit: 0, monthly_fixed_costs: 500, target_margin_pct: 30, promo_margin_pct: 15 };
  const c = calculate({ weight_g: 50, print_minutes: 120, material: "PLA", sale_price: 45, fee_pct: 14, fixed_fee: 6.25 }, cfg);
  // filamento: 50g × 1,1 × R$0,10/g = 5,50; energia 0,1kW×2h×1 = 0,20; depreciação 1,00; manutenção 0,40; mão de obra 3,00; acabamento 1,00
  assert.equal(c.filament_cost, 5.5);
  assert.equal(c.production_cost, 11.1);
  // variável: 11,10 + 2 + 6,30 (14%) + 6,25 + 2,70 (6%) = 28,35
  assert.equal(c.total_variable_cost, 28.35);
  assert.equal(c.contribution_margin, 16.65);
  assert.ok(Math.abs(c.profit_per_print_hour! - 8.325) < 0.01);
  assert.equal(c.break_even_units, Math.ceil(500 / 16.65));
  assert.ok(c.complete);
  // preço mínimo zera a margem
  const atMin = calculate({ weight_g: 50, print_minutes: 120, material: "PLA", sale_price: c.min_price!, fee_pct: 14, fixed_fee: 6.25 }, cfg);
  assert.ok(Math.abs(atMin.contribution_margin) < 0.02);
  const rec = calculate({ weight_g: 50, print_minutes: 120, material: "PLA", sale_price: c.recommended_price!, fee_pct: 14, fixed_fee: 6.25 }, cfg);
  assert.ok(Math.abs(rec.margin_pct - 30) < 0.1);
  const s = scenarios(c, [1, 10, 500]);
  assert.equal(s[1]!.contribution, 166.5);
  assert.equal(s[2]!.filament_kg, 25);
  // sem configuração: nada é presumido, os itens faltantes são listados
  const empty = calculate({ weight_g: 50, print_minutes: 120, material: "PLA", sale_price: 45 }, DEFAULT_COST_CONFIG);
  assert.ok(!empty.complete);
  assert.ok(empty.missing.some((m) => m.includes("filamento")));
  assert.ok(empty.missing.some((m) => m.includes("marketplace")));
});

test("radar: nota 0–100 com pesos e separação observado/estimado", () => {
  const s = scoreOpportunity({ sold_signal: 5000, margin_pct: 50, difficulty: "baixa", sellers: 0, differentiation: "alta", weight_g: 80 });
  assert.equal(s.total, 100);
  const none = scoreOpportunity({});
  assert.equal(none.total, 7); // só fabricação "não avaliada" recebe nota neutra
  assert.equal(s.parts.find((p) => p.key === "demand")!.max, 25);
  const id = saveOpportunity(oppSchema.parse({ name: "Suporte de headset", competitor_prices: [39, 49, 59], demand_level: "média", weight_g: 120, print_minutes: 180 }));
  const o = q.get<any>("SELECT * FROM opportunities WHERE id=?", [id])!;
  assert.equal(JSON.parse(o.observed).price_median, 49);
  assert.equal(JSON.parse(o.estimates).weight_g, 120);
  const lab = addOpportunityToLab(id, 1);
  assert.equal(q.get<any>("SELECT status FROM lab_products WHERE id=?", [lab])!.status, "research");
  assert.throws(() => convertLabToProduct(lab, 1), /aprovados/);
  q.run("UPDATE lab_products SET status='approved', sku='M2M-HS-01' WHERE id=?", [lab]);
  const pid = convertLabToProduct(lab, 1);
  assert.equal(q.get<any>("SELECT weight_g FROM products WHERE id=?", [pid])!.weight_g, 120);
});

test("importação: formatos brasileiros, auto-mapeamento, validação, efetivação e desfazer", () => {
  assert.equal(parseNumber("R$ 1.234,56"), 1234.56);
  assert.equal(parseNumber("-12,5%"), -12.5);
  assert.equal(parseNumber("1.872"), 1872);
  assert.equal(parseDate("26 de novembro de 2026 14:30 hs.")!.day, "2026-11-26");
  assert.equal(parseDate("19/11/2026")!.day, "2026-11-19");
  assert.equal(parseDate("31/02/x"), null);
  const future = buildPreview("orders", parseCsv("N.º de venda;Data da venda;Unidades;Preço unitário;SKU\n9;01/01/2099;1;10;X"));
  assert.ok(future.parsed[0]!.errors.includes("Data no futuro"));

  const csv = [
    "Vendas;;;;;;",
    "N.º de venda;Data da venda;Estado;Unidades;Receita por produtos (BRL);Tarifa de venda e impostos (BRL);SKU;# de anúncio;Título do anúncio;Preço unitário de venda do anúncio (BRL)",
    "2000001;20 de novembro de 2026 10:00 hs.;Entregue;2;90,00;-25,10;M2M-ML2;MLB111;Ímã Lark M2;45,00",
    "2000002;21/11/2026;Cancelada pelo comprador;1;45,00;-12,55;M2M-ML2;MLB111;Ímã Lark M2;45,00",
    "2000002;21/11/2026;Cancelada pelo comprador;1;45,00;-12,55;M2M-ML2;MLB111;Ímã Lark M2;45,00",
    "2000003;data ruim;Entregue;0;0;0;;;;",
  ].join("\n");
  const rows = parseCsv(csv);
  assert.equal(guessKind(rows[1]!), "orders");
  const p = buildPreview("orders", rows);
  assert.equal(p.headerRow, 1);
  assert.equal(p.parsed.length, 4);
  assert.equal(p.parsed[0]!.errors.length, 0);
  assert.ok(p.parsed[2]!.duplicate, "linha repetida detectada");
  assert.ok(p.parsed[3]!.errors.length >= 2, "data e quantidade inválidas");
  const imp = Number(q.run("INSERT INTO imports (kind, filename, original_name) VALUES ('orders','x.csv','x.csv')").lastInsertRowid);
  const r = commitImport(imp, "orders", p.parsed, 1);
  assert.equal(r.imported, 2);
  const o = q.get<any>("SELECT * FROM orders WHERE id=2000001")!;
  assert.equal(o.total_amount, 90);
  assert.equal(o.status, "paid");
  assert.equal(q.get<any>("SELECT sale_fee FROM order_items WHERE order_id=2000001")!.sale_fee, 12.55);
  assert.equal(q.get<any>("SELECT status FROM orders WHERE id=2000002")!.status, "cancelled");
  // reimportar: pedidos já existentes são duplicados
  assert.ok(buildPreview("orders", rows).parsed[0]!.duplicate);
  const u = undoImport(imp);
  assert.equal(u.removed.orders, 2);
  assert.equal(q.get<any>("SELECT COUNT(*) n FROM orders")!.n, 0);
  assert.throws(() => undoImport(imp), /efetivadas/);
});

test("importação de PDF de métricas: extração do texto", () => {
  const values = parseMetricsText("Métricas 19 de nov. - 26 de nov. de 2026\nVendas brutas R$ 1.872\n+79,1%\nUnidades vendidas 39\nQuantidade de vendas 37\nVisitas 534\nConversão 6,9 %\nPreço médio por unidade R$ 48");
  assert.equal(values.gross_sales, 1872);
  assert.equal(values.units, 39);
  assert.equal(values.visits, 534);
  assert.equal(values.conversion_pct, 6.9);
});

test("meta e visão geral usam o relatório importado sem dupla contagem", () => {
  const g = goalProgress(new Date("2026-11-27T15:00:00Z"));
  assert.equal(g.revenue, 1872);
  assert.equal(g.from_reports, 1872);
  assert.ok(g.progress_pct! > 9 && g.progress_pct! < 9.5);
  assert.ok(g.trajectory_pct! < 90);
  const ov = overview("custom", "2026-11-19", "2026-11-26");
  assert.equal(ov.data_source, "report");
  assert.equal(ov.kpis.revenue, 1872);
  assert.equal(ov.changes.revenue, 79.1);
  assert.equal(ov.changes.conversion_pp, -7);
  assert.equal(ov.charts.daily, null, "sem pedidos diários: gráfico pendente, sem dados fictícios");
  const sim = goalSimulation(20000, [50, 100]);
  assert.equal(sim.rows[0]!.orders, 400);
  assert.equal(sim.units_per_order_source, "relatório importado");
  assert.equal(sim.rows[0]!.units, Math.ceil(400 * (39 / 37)));
});

test("produção: transições, baixa de filamento idempotente, horas e estoque", () => {
  const f = Number(q.run("INSERT INTO filaments (brand, material, color, total_g, available_g, min_g, cost_per_kg) VALUES ('Bambu','PLA','Preto',1000,1000,200,100)").lastInsertRowid);
  const prod = Number(q.run("INSERT INTO products (name, made_to_order, stock_qty) VALUES ('Organizador', 0, 0)").lastInsertRowid);
  const po = Number(q.run("INSERT INTO production_orders (product_id, name, quantity, material, color, filament_id, machine_id, weight_g_unit, minutes_unit, due_date) VALUES (?, 'Organizador', 10, 'PLA', 'Preto', ?, 1, 40, 60, '2026-01-01')", [prod, f]).lastInsertRowid);
  const plan = productionPlanner(new Date("2026-11-27T12:00:00Z"));
  assert.equal(plan.filament_needs[0]!.grams, 400);
  assert.ok(plan.at_risk.length >= 1, "prazo vencido aparece como risco");
  assert.throws(() => transitionOrder(po, "done", 1), /Transição inválida/);
  transitionOrder(po, "printing", 1);
  const r = transitionOrder(po, "done", 1, { failed_units: 1 });
  assert.ok(r.effects.length === 3);
  assert.equal(q.get<any>("SELECT available_g FROM filaments WHERE id=?", [f])!.available_g, 600);
  assert.equal(q.get<any>("SELECT stock_qty FROM products WHERE id=?", [prod])!.stock_qty, 9);
  assert.equal(q.get<any>("SELECT hours_worked FROM machines WHERE id=1")!.hours_worked, 10);
  assert.equal(moveFilament(f, "consumption", 400, { ref: `po:${po}` }), false, "idempotente");
  moveFilament(f, "consumption", 450);
  evaluateAlerts(new Date("2026-11-27T12:00:00Z"));
  assert.ok(q.get("SELECT 1 FROM alerts WHERE type='filament_low' AND status='open'"));
  assert.ok(q.get("SELECT 1 FROM alerts WHERE type='conversion_drop'"), "queda de 7 p.p. do relatório gera alerta");
  assert.ok(q.get("SELECT 1 FROM alerts WHERE type='below_goal'"));
});

test("central de anúncios classifica e não inventa margem", () => {
  const c = listingsCenter({ days: 30 });
  const l = c.rows.find((r) => r.id === "INICIAL-HOLLYLAND-M2")!;
  assert.equal(l.margin_pct, null);
  assert.ok(l.unit_missing.length > 0);
  saveCostConfig({ filament_price_per_kg: { PLA: 100 } });
  assert.ok(c.priority.length <= 20);
});

test("rotinas e DRE geram dados determinísticos", () => {
  const d = routineData("daily") as any;
  assert.ok(d.meta);
  assert.ok(isDue({ enabled: 1, frequency: "daily", hour: 7, last_run_at: null }, new Date("2026-11-27T12:00:00Z")));
  assert.ok(!isDue({ enabled: 1, frequency: "weekly", weekday: 1, hour: 7, last_run_at: null }, new Date("2026-11-27T12:00:00Z")));
  assert.ok(isDue({ enabled: 1, frequency: "monthly_end", hour: 7, last_run_at: null }, new Date("2026-11-30T12:00:00Z")));
  const r = dre("2026-11");
  assert.equal(r.lines[0]!.value, 1872);
  assert.equal(r.lines.find((x) => x.key === "result")!.value, null, "sem custos o resultado fica pendente");
});

void fs; void path;

test("relatório 'Métricas do desempenho' do ML: diário, sem dupla contagem com o relatório agregado", async () => {
  const { guessKindFromRows } = await import("../src/services/imports.ts");
  const rows = [
    ["Métricas do desempenho dos seus produtos"], ["Este relatório contém as métricas gerais…"], ["Nota: este relatório inclui apenas o \"total de visitas\" até ontem."],
    ["", "Visitas", "Visitas", "Visitas", "Intenção de compra", "Intenção de compra", "Intenção de compra", "Intenção de compra", "Intenção de compra", "Vendas brutas", "Vendas brutas", "Vendas brutas", "Vendas brutas", "Vendas brutas"],
    ["Data", "Visitas únicas", "Total de visitas", "Curtir", "Visitas únicas com intenção de compra", "Unidades com intenção de compra", "Conversão de visitas em intenção de compra", "Quantidade de intenções de compra", "Valor bruto de intenção de compra (BRL)", "Quantidade de vendas", "Compradores únicos", "Unidades vendidas", "Vendas brutas (ARS)", "Conversão de visitas em vendas"],
    ["19/11/26", "54", "93", "1", "5", "8", "9,26%", "8", "380", "6", "5", "8", "357.89", "11,11%"],
    ["20/11/26", "21", "43", "1", "3", "5", "14,29%", "5", "238", "4", "4", "4", "190", "19,05%"],
    ["21/11/26", "42", "69", "1", "4", "13", "9,52%", "7", "618", "1", "2", "1", "47.5", "2,38%"],
    ["22/11/26", "32", "60", "1", "2", "2", "6,25%", "2", "95", "1", "0", "1", "47.5", "3,13%"],
    ["23/11/26", "62", "101", "2", "6", "8", "9,68%", "8", "363", "7", "7", "7", "312.83", "11,29%"],
    ["24/11/26", "138", "188", "1", "4", "7", "2,90%", "7", "324", "8", "8", "8", "368.14", "5,80%"],
    ["25/11/26", "107", "157", "1", "6", "7", "5,61%", "7", "320", "5", "5", "5", "322.65", "4,67%"],
    ["26/11/26", "79", "0", "1", "4", "6", "5,06%", "6", "270", "5", "3", "5", "225", "6,33%"],
    ["Valores totais do período", "45", "45", "45", "45", "45", "", "45", "45", "45", "45", "45", "45", ""],
  ];
  assert.equal(guessKindFromRows(rows), "daily_metrics");
  const p = buildPreview("daily_metrics", rows);
  assert.equal(p.parsed.length, 8, "linha de totais ignorada");
  assert.ok(p.parsed.every((r) => !r.errors.length));
  const imp = Number(q.run("INSERT INTO imports (kind, filename, original_name) VALUES ('daily_metrics','d.xlsx','d.xlsx')").lastInsertRowid);
  assert.equal(commitImport(imp, "daily_metrics", p.parsed, 1).imported, 8);

  const ov = overview("custom", "2026-11-19", "2026-11-26");
  assert.equal(ov.data_source, "daily_metrics");
  assert.equal(Math.round(ov.kpis.revenue * 100) / 100, 1871.51);
  assert.equal(ov.kpis.orders, 37);
  assert.equal(ov.kpis.units, 39);
  assert.equal(ov.kpis.visits, 535);
  assert.ok(Math.abs(ov.kpis.conversion_pct! - 6.92) < 0.01);
  assert.equal(ov.changes.revenue, 79.1, "anterior derivado do relatório agregado do mesmo período");
  assert.equal(ov.funnel.intent_unique_visitors, 34);
  assert.equal(ov.charts.daily!.find((d: any) => d.date === "2026-11-24")!.revenue, 368.14);
  // a meta não soma o relatório agregado de novo
  const g = goalProgress(new Date("2026-11-27T15:00:00Z"));
  assert.equal(Math.round(g.revenue * 100) / 100, 1871.51);
  assert.equal(g.from_reports, 0);
  undoImport(imp);
  assert.equal(goalProgress(new Date("2026-11-27T15:00:00Z")).revenue, 1872);
  assert.equal(q.get<any>("SELECT COUNT(*) n FROM visits_daily WHERE scope='store'")!.n, 0);
});
