import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { z } from "zod";
import { q, json } from "../db/index.ts";
import { ah, HttpError, IntegrationUnavailable } from "../lib/errors.ts";
import { audit } from "../lib/audit.ts";
import { requireRole } from "../auth/index.ts";
import { config, aiConfigured, mlConfigured } from "../config.ts";
import { randomToken } from "../lib/crypto.ts";
import { localDate, resolvePeriod } from "../lib/dates.ts";
import { getAccount, ml } from "../ml/client.ts";
import { getCompany, periodReports, goalProgress, goalSimulation } from "../services/company.ts";
import { overview } from "../services/overview.ts";
import { listingsCenter, listingDetail } from "../services/listingsIntel.ts";
import { calculate, scenarios, getCostConfig, saveCostConfig, listChannels, profitabilityRanking, type CalcInput } from "../services/costs3d.ts";
import { dre } from "../services/dre.ts";
import { listMachines, listFilaments, moveFilament, listProductionOrders, transitionOrder, productionPlanner, PROD_STATUS } from "../services/factory.ts";
import { recordMovement } from "../services/inventory.ts";
import {
  listOpportunities, saveOpportunity, oppSchema, radarFromMl, radarWebResearch, addOpportunityToLab, RADAR_CATEGORIES,
  listLab, labEvent, convertLabToProduct, LAB_STATUS, LAB_STATUS_LABEL, estimateMargin,
} from "../services/rnd.ts";
import { IMPORT_KINDS, readFileRows, buildPreview, guessKind, parseMetricsText, commitImport, undoImport } from "../services/imports.ts";
import { chat, listConversations, getConversation, ceoDiagnosis, latestDiagnosis, analyze, generateListingCopy, companySnapshot } from "../ai/mind.ts";
import { listRoutines, runRoutine, routineData } from "../services/routines.ts";
import { toExcel, toPdf, type Report } from "../services/reports.ts";
import { adsDerived } from "../ml/ads.ts";

export const v2 = Router();
const viewer = requireRole("viewer");
const operator = requireRole("operator");
const admin = requireRole("admin");
const confirmSchema = z.object({ confirm: z.literal(true, { message: "Confirmação explícita necessária" }) });
const now = () => new Date().toISOString();
const id = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, "ID inválido");
  return n;
};

async function sendReport(res: any, r: Report, format: string, name: string) {
  const fname = `${name}-${localDate(new Date())}`;
  if (format === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}.xlsx"`);
    return res.send(await toExcel(r));
  }
  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}.pdf"`);
    return res.send(await toPdf(r));
  }
  res.json(r);
}
const brl = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");
const subtitle = (extra = "") => `${extra}${extra ? " · " : ""}Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · MIND2MATTER INTELLIGENCE`;

// ======================================================================
// Empresa, relatórios importados e visão geral
// ======================================================================
v2.get("/company", viewer, (_req, res) => res.json(getCompany()));
v2.put("/company", admin, ah((req, res) => {
  const b = z.object({
    name: z.string().min(1).max(120).optional(), segment: z.string().max(200).optional(),
    monthly_goal: z.number().positive().max(10_000_000).optional(), listings_identified: z.number().int().min(0).nullable().optional(),
    monthly_revenue_min: z.number().min(0).nullable().optional(), monthly_revenue_max: z.number().min(0).nullable().optional(), notes: z.string().max(4000).nullable().optional(),
  }).parse(req.body);
  const keys = Object.keys(b);
  if (keys.length) q.run(`UPDATE companies SET ${keys.map((k) => `${k}=?`).join(",")}, updated_at=? WHERE id=(SELECT id FROM companies LIMIT 1)`, [...Object.values(b) as any[], now()]);
  if (b.monthly_goal) q.run("UPDATE goals SET target_revenue=? WHERE kind='main'", [b.monthly_goal]);
  audit(req.user!.id, "company.update", "company", null, b, req.ip);
  res.json(getCompany());
}));

v2.get("/period-reports", viewer, (_req, res) => res.json(periodReports()));
v2.post("/period-reports", operator, ah((req, res) => {
  const b = z.object({
    channel: z.string().default("mercadolivre"), date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    gross_sales: z.number().min(0), units: z.number().int().min(0).nullable().optional(), sales_count: z.number().int().min(0).nullable().optional(),
    visits: z.number().int().min(0).nullable().optional(), conversion_pct: z.number().min(0).max(100).nullable().optional(), avg_unit_price: z.number().min(0).nullable().optional(),
    notes: z.string().max(1000).optional(),
  }).parse(req.body);
  if (b.date_from > b.date_to) throw new HttpError(400, "Início posterior ao fim");
  const r = q.run(`INSERT INTO period_reports (channel, date_from, date_to, gross_sales, units, sales_count, visits, conversion_pct, avg_unit_price, source, notes) VALUES (?,?,?,?,?,?,?,?,?, 'manual', ?)`,
    [b.channel, b.date_from, b.date_to, b.gross_sales, b.units ?? null, b.sales_count ?? null, b.visits ?? null, b.conversion_pct ?? null, b.avg_unit_price ?? null, b.notes ?? null]);
  audit(req.user!.id, "period_report.create", "period_report", Number(r.lastInsertRowid), b, req.ip);
  res.json({ id: Number(r.lastInsertRowid) });
}));
v2.delete("/period-reports/:id", admin, ah((req, res) => {
  confirmSchema.parse(req.body);
  q.run("DELETE FROM period_reports WHERE id=?", [id(req.params.id)]);
  audit(req.user!.id, "period_report.delete", "period_report", req.params.id as string, null, req.ip);
  res.json({ ok: true });
}));

v2.get("/overview", viewer, ah((req, res) => {
  const { period = "30d", from, to, channel } = req.query as Record<string, string>;
  try { res.json(overview(period, from, to, channel)); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, (e as Error).message); }
}));

v2.get("/goals/progress", viewer, (req, res) => res.json(goalProgress(new Date(), req.query.channel as string | undefined)));
v2.get("/goals/simulation", viewer, (req, res) => {
  const n = (k: string) => (req.query[k] !== undefined && req.query[k] !== "" ? Number(req.query[k]) : undefined);
  const tickets = String(req.query.tickets ?? "").split(",").map(Number).filter((x) => x > 0);
  res.json(goalSimulation(n("goal"), tickets.length ? tickets : undefined, { units_per_order: n("units_per_order"), minutes_per_unit: n("minutes"), grams_per_unit: n("grams"), acos_pct: n("acos") }));
});
v2.get("/goals", viewer, (_req, res) => res.json(q.all("SELECT * FROM goals ORDER BY target_revenue")));
v2.post("/goals", operator, ah((req, res) => {
  const b = z.object({ name: z.string().min(2).max(120), target_revenue: z.number().positive(), deadline: z.string().nullable().optional(), notes: z.string().max(500).nullable().optional() }).parse(req.body);
  const r = q.run("INSERT INTO goals (name, target_revenue, deadline, kind, notes) VALUES (?,?,?, 'milestone', ?)", [b.name, b.target_revenue, b.deadline ?? null, b.notes ?? null]);
  audit(req.user!.id, "goal.create", "goal", Number(r.lastInsertRowid), b, req.ip);
  res.json({ id: Number(r.lastInsertRowid) });
}));
v2.delete("/goals/:id", operator, ah((req, res) => {
  confirmSchema.parse(req.body);
  q.run("DELETE FROM goals WHERE id=? AND kind != 'main'", [id(req.params.id)]);
  audit(req.user!.id, "goal.delete", "goal", req.params.id as string, null, req.ip);
  res.json({ ok: true });
}));
v2.get("/goals/export", viewer, ah(async (req, res) => {
  const s = goalSimulation();
  const g = goalProgress();
  await sendReport(res, {
    title: "Metas e crescimento", subtitle: subtitle(`Mês ${g.month}`),
    columns: [{ key: "ticket", header: "Ticket médio", fmt: "money" }, { key: "orders", header: "Pedidos/mês", fmt: "int" }, { key: "units", header: "Unidades/mês", fmt: "int" },
      { key: "daily_revenue", header: "Faturamento/dia", fmt: "money" }, { key: "print_hours", header: "Horas de impressão", fmt: "num" }, { key: "filament_kg", header: "Filamento (kg)", fmt: "num" }, { key: "ad_investment", header: "Investimento ads", fmt: "money" }],
    rows: s.rows, summary: [["Meta", brl(g.goal)], ["Faturamento do mês", brl(g.revenue)], ["Progresso", `${g.progress_pct?.toFixed(1) ?? "—"}%`], ["Projeção (estimativa)", brl(g.projection)]],
  }, String(req.query.format ?? "xlsx"), "metas");
}));

// ======================================================================
// Mercado Livre: status real da integração
// ======================================================================
v2.get("/ml/status", viewer, (_req, res) => {
  const acc = q.get<any>("SELECT id, nickname, status, last_error, expires_at, connected_at, scope FROM ml_accounts ORDER BY connected_at DESC LIMIT 1");
  const pending = q.get<{ n: number }>("SELECT COUNT(*) n FROM oauth_states WHERE created_at >= ?", [new Date(Date.now() - 15 * 60_000).toISOString()])!.n;
  let state: "not_configured" | "not_connected" | "awaiting_authorization" | "connected" | "auth_error" | "token_expired";
  if (!mlConfigured()) state = "not_configured";
  else if (acc?.status === "needs_reauth") state = /expir|invalid_grant|refresh/i.test(acc.last_error ?? "") ? "token_expired" : "auth_error";
  else if (acc?.status === "connected") state = "connected";
  else if (pending) state = "awaiting_authorization";
  else state = "not_connected";
  res.json({
    state, account: acc ? { id: acc.id, nickname: acc.nickname, connected_at: acc.connected_at, access_token_expires_at: acc.expires_at, scope: acc.scope, last_error: acc.last_error } : null,
    configured: { client_id: !!config.ml.clientId, client_secret: !!config.ml.clientSecret, redirect_uri: config.ml.redirectUri },
    sync: q.all("SELECT resource, status, last_run_at, last_success_at, message, processed FROM sync_state ORDER BY resource"),
    recent_api_errors: q.all("SELECT at, path, status, error FROM api_logs WHERE service='mercadolivre' AND (status >= 400 OR error IS NOT NULL) ORDER BY id DESC LIMIT 10"),
    ai: { configured: aiConfigured(), model: config.ai.model },
    other_integrations: [
      { name: "Shopee", status: "not_integrated", note: "Sem integração por API: importe os relatórios de vendas da Shopee na Central de Importação." },
      { name: "Google Trends", status: "not_integrated", note: "Não há API pública oficial. O Radar usa pesquisa web via IA (com links das fontes) e tendências do Mercado Livre." },
    ],
  });
});

// ======================================================================
// Central de anúncios
// ======================================================================
v2.get("/listings-center", viewer, (req, res) => {
  const { days, channel, search, status } = req.query as Record<string, string>;
  res.json(listingsCenter({ days: days ? Math.min(365, Number(days)) : 30, channel, search, status }));
});
v2.get("/listings-center/export", viewer, ah(async (req, res) => {
  const c = listingsCenter({ days: Number(req.query.days ?? 30) || 30, channel: req.query.channel as string });
  const which = req.query.list === "priority" ? c.priority : c.rows;
  await sendReport(res, {
    title: req.query.list === "priority" ? "Ranking — 20 anúncios prioritários" : "Central de anúncios", subtitle: subtitle(`Últimos ${c.days} dias`),
    columns: [{ key: "id", header: "Anúncio", width: 18 }, { key: "title", header: "Título", width: 45 }, { key: "sku", header: "SKU", width: 12 }, { key: "price", header: "Preço", fmt: "money" },
      { key: "available_quantity", header: "Estoque ML", fmt: "int" }, { key: "visits", header: "Visitas", fmt: "int" }, { key: "units_period", header: "Vendas", fmt: "int" },
      { key: "conversion_pct", header: "Conversão", fmt: "pct" }, { key: "quality_score", header: "Qualidade", fmt: "num" }, { key: "class_label", header: "Classe", width: 16 },
      { key: "margin_pct", header: "Margem", fmt: "pct" }, { key: "unit_profit", header: "Lucro/un.", fmt: "money" }, { key: "reasons_text", header: "Motivos", width: 40 }],
    rows: which.map((r) => ({ ...r, reasons_text: r.reasons.join("; ") })),
    summary: [["Anúncios", String(c.rows.length)], ["Conversão da loja", c.store_conversion_pct === null ? "—" : `${c.store_conversion_pct.toFixed(2)}%`], ...Object.entries(c.counts).map(([k, v]) => [k, String(v)] as [string, string])],
  }, String(req.query.format ?? "xlsx"), "anuncios");
}));
v2.get("/listings-center/:id", viewer, (req, res) => {
  const d = listingDetail(String(req.params.id));
  if (!d) throw new HttpError(404, "Anúncio não encontrado");
  res.json(d);
});
v2.put("/listings/:id/fees", operator, ah((req, res) => {
  const b = z.object({ fee_pct: z.number().min(0).max(60).nullable(), fixed_fee: z.number().min(0).nullable(), shipping_cost: z.number().min(0).nullable(), ads_pct: z.number().min(0).max(80).nullable(), notes: z.string().max(300).nullable().optional() }).parse(req.body);
  q.run(`INSERT INTO listing_fee_overrides (listing_id, fee_pct, fixed_fee, shipping_cost, ads_pct, notes, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(listing_id) DO UPDATE SET fee_pct=excluded.fee_pct, fixed_fee=excluded.fixed_fee, shipping_cost=excluded.shipping_cost, ads_pct=excluded.ads_pct, notes=excluded.notes, updated_at=excluded.updated_at`,
    [String(req.params.id), b.fee_pct, b.fixed_fee, b.shipping_cost, b.ads_pct, b.notes ?? null, now()]);
  audit(req.user!.id, "listing.fees_override", "listing", req.params.id as string, b, req.ip);
  res.json({ ok: true });
}));
v2.patch("/products/:id/specs", operator, ah((req, res) => {
  const b = z.object({ weight_g: z.number().positive().nullable().optional(), print_minutes: z.number().positive().nullable().optional(), material: z.string().max(20).nullable().optional(), units_per_plate: z.number().int().positive().nullable().optional(), sku: z.string().max(60).nullable().optional(), category: z.string().max(100).nullable().optional() }).parse(req.body);
  const keys = Object.keys(b);
  if (keys.length) q.run(`UPDATE products SET ${keys.map((k) => `${k}=?`).join(",")}, updated_at=? WHERE id=?`, [...Object.values(b) as any[], now(), id(req.params.id)]);
  audit(req.user!.id, "product.specs_update", "product", req.params.id as string, b, req.ip);
  res.json({ ok: true });
}));
v2.post("/products", operator, ah((req, res) => {
  const b = z.object({ name: z.string().min(2).max(200), sku: z.string().max(60).nullable().optional(), category: z.string().max(100).nullable().optional(), weight_g: z.number().positive().nullable().optional(), print_minutes: z.number().positive().nullable().optional(), material: z.string().max(20).nullable().optional(), made_to_order: z.boolean().default(true) }).parse(req.body);
  if (b.sku && q.get("SELECT 1 FROM products WHERE sku=?", [b.sku])) throw new HttpError(409, "SKU já cadastrado");
  const r = q.run("INSERT INTO products (name, sku, category, weight_g, print_minutes, material, made_to_order) VALUES (?,?,?,?,?,?,?)", [b.name, b.sku ?? null, b.category ?? null, b.weight_g ?? null, b.print_minutes ?? null, b.material ?? null, b.made_to_order ? 1 : 0]);
  audit(req.user!.id, "product.create", "product", Number(r.lastInsertRowid), b, req.ip);
  res.json({ id: Number(r.lastInsertRowid) });
}));

// ======================================================================
// Financeiro — CFO
// ======================================================================
const nullNum = z.number().min(0).nullable();
v2.get("/finance/cost-config", viewer, (_req, res) => res.json({ config: getCostConfig(), channels: listChannels() }));
v2.put("/finance/cost-config", admin, ah((req, res) => {
  const b = z.object({
    filament_price_per_kg: z.record(z.string().max(20), nullNum).optional(),
    energy_kwh_price: nullNum.optional(), printer_power_watts: nullNum.optional(), depreciation_per_hour: nullNum.optional(), maintenance_per_hour: nullNum.optional(),
    labor_per_hour: nullNum.optional(), labor_minutes_per_unit: nullNum.optional(), packaging_per_unit: nullNum.optional(), finishing_per_unit: nullNum.optional(),
    failure_rate_pct: z.number().min(0).max(90).nullable().optional(), ads_pct: z.number().min(0).max(90).nullable().optional(), tax_pct: z.number().min(0).max(60).nullable().optional(),
    seller_shipping_per_unit: nullNum.optional(), monthly_fixed_costs: nullNum.optional(), target_margin_pct: z.number().min(0).max(90).optional(), promo_margin_pct: z.number().min(0).max(90).optional(),
  }).parse(req.body);
  const saved = saveCostConfig(b);
  audit(req.user!.id, "finance.cost_config", "settings", "cost_config", b, req.ip);
  res.json(saved);
}));
v2.put("/channels/:id", admin, ah((req, res) => {
  const b = z.object({ fee_pct: z.number().min(0).max(60).nullable(), fixed_fee: nullNum, shipping_cost: nullNum, active: z.boolean().optional(), notes: z.string().max(300).nullable().optional() }).parse(req.body);
  const exists = q.get("SELECT 1 FROM channels WHERE id=?", [String(req.params.id)]);
  if (!exists) q.run("INSERT INTO channels (id, name) VALUES (?,?)", [String(req.params.id), String(req.params.id)]);
  q.run("UPDATE channels SET fee_pct=?, fixed_fee=?, shipping_cost=?, active=COALESCE(?, active), notes=COALESCE(?, notes), updated_at=? WHERE id=?", [b.fee_pct, b.fixed_fee, b.shipping_cost, b.active === undefined ? null : b.active ? 1 : 0, b.notes ?? null, now(), String(req.params.id)]);
  audit(req.user!.id, "channel.update", "channel", req.params.id as string, b, req.ip);
  res.json({ ok: true });
}));
const calcSchema = z.object({
  weight_g: z.number().positive().max(10000), print_minutes: z.number().positive().max(10000), material: z.string().max(20), sale_price: z.number().positive(),
  fee_pct: z.number().min(0).max(60).nullable().optional(), fixed_fee: z.number().min(0).nullable().optional(), packaging: z.number().min(0).nullable().optional(),
  other_costs: z.number().min(0).nullable().optional(), shipping: z.number().min(0).nullable().optional(), ads_pct: z.number().min(0).max(80).nullable().optional(),
  tax_pct: z.number().min(0).max(60).nullable().optional(), units_per_plate: z.number().int().positive().nullable().optional(),
});
v2.post("/finance/calc3d", viewer, ah((req, res) => {
  const b = z.object({ input: calcSchema, volumes: z.array(z.number().int().positive().max(100000)).max(10).optional(), channel: z.string().optional() }).parse(req.body);
  const input = { ...b.input } as CalcInput;
  if (b.channel && (input.fee_pct === undefined || input.fee_pct === null)) {
    const ch = q.get<any>("SELECT * FROM channels WHERE id=?", [b.channel]);
    if (ch) { input.fee_pct = ch.fee_pct; input.fixed_fee ??= ch.fixed_fee; input.shipping ??= ch.shipping_cost; }
  }
  const calc = calculate(input);
  const m = listMachines().filter((x) => x.status !== "inactive");
  res.json({ calc, scenarios: scenarios(calc, b.volumes, m[0]?.hours_per_day ?? 16, Math.max(1, m.length)) });
}));
v2.post("/finance/calc3d/save", operator, ah((req, res) => {
  const b = z.object({ product_id: z.number().int(), input: calcSchema }).parse(req.body);
  if (!q.get("SELECT 1 FROM products WHERE id=?", [b.product_id])) throw new HttpError(404, "Produto não encontrado");
  const c = calculate(b.input as CalcInput);
  const cfg = getCostConfig();
  q.tx(() => {
    q.run("UPDATE products SET weight_g=?, print_minutes=?, material=?, updated_at=? WHERE id=?", [b.input.weight_g, b.input.print_minutes, b.input.material, now(), b.product_id]);
    q.run(`INSERT INTO product_costs (product_id, material_cost, manufacturing_cost, energy_cost, production_minutes, labor_cost_per_hour, packaging_cost, operational_cost, shipping_cost_seller, ads_cost_per_unit, tax_rate_pct, other_cost, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET material_cost=excluded.material_cost, manufacturing_cost=excluded.manufacturing_cost, energy_cost=excluded.energy_cost,
      production_minutes=excluded.production_minutes, labor_cost_per_hour=excluded.labor_cost_per_hour, packaging_cost=excluded.packaging_cost, operational_cost=excluded.operational_cost,
      shipping_cost_seller=excluded.shipping_cost_seller, ads_cost_per_unit=excluded.ads_cost_per_unit, tax_rate_pct=excluded.tax_rate_pct, other_cost=excluded.other_cost, updated_at=excluded.updated_at`,
      [b.product_id, c.filament_cost, c.depreciation_cost + c.maintenance_cost, c.energy_cost, cfg.labor_minutes_per_unit ?? 0, cfg.labor_per_hour ?? 0, c.packaging_cost, c.finishing_cost,
        c.shipping_cost, c.ads_cost, b.input.tax_pct ?? cfg.tax_pct ?? 0, c.other_costs, now()]);
  });
  audit(req.user!.id, "finance.calc3d_save", "product", b.product_id, { input: b.input, missing: c.missing }, req.ip);
  res.json({ ok: true, missing: c.missing });
}));
v2.get("/finance/ranking", viewer, (_req, res) => res.json(profitabilityRanking()));
v2.get("/finance/dre", viewer, ah(async (req, res) => {
  const month = String(req.query.month ?? localDate(new Date()).slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "Mês inválido (AAAA-MM)");
  const d = dre(month);
  if (req.query.format) {
    return sendReport(res, { title: "DRE gerencial", subtitle: subtitle(`Mês ${month}`), columns: [{ key: "label", header: "Linha", width: 40 }, { key: "value", header: "Valor", fmt: "money" }, { key: "source", header: "Fonte", width: 50 }],
      rows: d.lines, summary: [["Margem operacional", d.margin_pct === null ? "pendente" : `${d.margin_pct.toFixed(1)}%`], ["Cobertura de custos", d.cost_coverage_pct === null ? "—" : `${d.cost_coverage_pct.toFixed(0)}%`]] }, String(req.query.format), `dre-${month}`);
  }
  res.json(d);
}));
v2.get("/expenses", viewer, (req, res) => res.json(q.all("SELECT * FROM expenses WHERE date LIKE ? ORDER BY date DESC LIMIT 500", [`${String(req.query.month ?? "")}%`])));
v2.post("/expenses", operator, ah((req, res) => {
  const b = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), category: z.string().min(2).max(60), description: z.string().max(300).optional(), amount: z.number().positive(), recurring: z.boolean().default(false) }).parse(req.body);
  const r = q.run("INSERT INTO expenses (date, category, description, amount, recurring, created_by) VALUES (?,?,?,?,?,?)", [b.date, b.category, b.description ?? null, b.amount, b.recurring ? 1 : 0, req.user!.id]);
  audit(req.user!.id, "expense.create", "expense", Number(r.lastInsertRowid), b, req.ip);
  res.json({ id: Number(r.lastInsertRowid) });
}));
v2.delete("/expenses/:id", operator, ah((req, res) => {
  confirmSchema.parse(req.body);
  q.run("DELETE FROM expenses WHERE id=?", [id(req.params.id)]);
  audit(req.user!.id, "expense.delete", "expense", req.params.id as string, null, req.ip);
  res.json({ ok: true });
}));

// ======================================================================
// Mind Factory — máquinas, filamentos e produção
// ======================================================================
const machineSchema = z.object({
  name: z.string().min(1).max(80), model: z.string().min(1).max(80), technology: z.string().max(20).default("FDM"), nozzle_mm: z.number().positive().max(2).nullable().optional(),
  materials: z.array(z.string().max(20)).max(10).default([]), build_volume: z.string().max(60).nullable().optional(), multicolor: z.string().max(80).nullable().optional(),
  status: z.enum(["available", "printing", "maintenance", "inactive"]).default("available"), hours_worked: z.number().min(0).default(0), hours_per_day: z.number().min(1).max(24).default(16),
  power_watts: z.number().positive().nullable().optional(), purchase_price: z.number().positive().nullable().optional(), lifetime_hours: z.number().positive().nullable().optional(), notes: z.string().max(1000).nullable().optional(),
});
v2.get("/factory/machines", viewer, (_req, res) => res.json(listMachines()));
v2.post("/factory/machines", operator, ah((req, res) => {
  const b = machineSchema.parse(req.body);
  const r = q.run(`INSERT INTO machines (name, model, technology, nozzle_mm, materials, build_volume, multicolor, status, hours_worked, hours_per_day, power_watts, purchase_price, lifetime_hours, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.name, b.model, b.technology, b.nozzle_mm ?? null, JSON.stringify(b.materials), b.build_volume ?? null, b.multicolor ?? null, b.status, b.hours_worked, b.hours_per_day, b.power_watts ?? null, b.purchase_price ?? null, b.lifetime_hours ?? null, b.notes ?? null]);
  audit(req.user!.id, "machine.create", "machine", Number(r.lastInsertRowid), b, req.ip);
  res.json({ id: Number(r.lastInsertRowid) });
}));
v2.put("/factory/machines/:id", operator, ah((req, res) => {
  const b = machineSchema.parse(req.body);
  q.run(`UPDATE machines SET name=?, model=?, technology=?, nozzle_mm=?, materials=?, build_volume=?, multicolor=?, status=?, hours_worked=?, hours_per_day=?, power_watts=?, purchase_price=?, lifetime_hours=?, notes=? WHERE id=?`,
    [b.name, b.model, b.technology, b.nozzle_mm ?? null, JSON.stringify(b.materials), b.build_volume ?? null, b.multicolor ?? null, b.status, b.hours_worked, b.hours_per_day, b.power_watts ?? null, b.purchase_price ?? null, b.lifetime_hours ?? null, b.notes ?? null, id(req.params.id)]);
  audit(req.user!.id, "machine.update", "machine", req.params.id as string, b, req.ip);
  res.json({ ok: true });
}));
v2.delete("/factory/machines/:id", admin, ah((req, res) => {
  confirmSchema.parse(req.body);
  q.run("DELETE FROM machines WHERE id=?", [id(req.params.id)]);
  audit(req.user!.id, "machine.delete", "machine", req.params.id as string, null, req.ip);
  res.json({ ok: true });
}));
v2.get("/factory/machines/:id/maintenance", viewer, (req, res) => res.json(q.all("SELECT * FROM machine_maintenance WHERE machine_id=? ORDER BY date DESC", [id(req.params.id)])));
v2.post("/factory/machines/:id/maintenance", operator, ah((req, res) => {
  const b = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), type: z.string().min(2).max(60), description: z.string().max(1000).optional(), cost: z.number().min(0).nullable().optional() }).parse(req.body);
  const m = q.get<any>("SELECT hours_worked FROM machines WHERE id=?", [id(req.params.id)]);
  if (!m) throw new HttpError(404, "Máquina não encontrada");
  q.run("INSERT INTO machine_maintenance (machine_id, date, type, description, cost, hours_at, created_by) VALUES (?,?,?,?,?,?,?)", [id(req.params.id), b.date, b.type, b.description ?? null, b.cost ?? null, m.hours_worked, req.user!.id]);
  audit(req.user!.id, "machine.maintenance", "machine", req.params.id as string, b, req.ip);
  res.json({ ok: true });
}));

const filamentSchema = z.object({
  brand: z.string().max(60).nullable().optional(), material: z.string().min(2).max(20), color: z.string().max(40).nullable().optional(),
  total_g: z.number().min(0), available_g: z.number().min(0), min_g: z.number().min(0).default(0), cost_per_kg: z.number().positive().nullable().optional(),
  purchased_at: z.string().nullable().optional(), notes: z.string().max(500).nullable().optional(),
});
v2.get("/factory/filaments", viewer, (_req, res) => res.json(listFilaments()));
v2.post("/factory/filaments", operator, ah((req, res) => {
  const b = filamentSchema.parse(req.body);
  if (b.available_g > b.total_g) throw new HttpError(400, "Peso disponível maior que o peso total");
  const r = q.run("INSERT INTO filaments (brand, material, color, total_g, available_g, min_g, cost_per_kg, purchased_at, notes) VALUES (?,?,?,?,?,?,?,?,?)",
    [b.brand ?? null, b.material.toUpperCase(), b.color ?? null, b.total_g, b.available_g, b.min_g, b.cost_per_kg ?? null, b.purchased_at ?? null, b.notes ?? null]);
  audit(req.user!.id, "filament.create", "filament", Number(r.lastInsertRowid), b, req.ip);
  res.json({ id: Number(r.lastInsertRowid) });
}));
v2.put("/factory/filaments/:id", operator, ah((req, res) => {
  const b = filamentSchema.omit({ available_g: true, total_g: true }).parse(req.body);
  q.run("UPDATE filaments SET brand=?, material=?, color=?, min_g=?, cost_per_kg=?, purchased_at=?, notes=? WHERE id=?", [b.brand ?? null, b.material.toUpperCase(), b.color ?? null, b.min_g, b.cost_per_kg ?? null, b.purchased_at ?? null, b.notes ?? null, id(req.params.id)]);
  audit(req.user!.id, "filament.update", "filament", req.params.id as string, b, req.ip);
  res.json({ ok: true });
}));
v2.post("/factory/filaments/:id/movements", operator, ah((req, res) => {
  const b = z.object({ type: z.enum(["purchase", "consumption", "adjust", "waste"]), grams: z.number().refine((n) => n !== 0, "Informe gramas diferentes de zero"), reason: z.string().max(200).optional(), confirm: z.literal(true) }).parse(req.body);
  moveFilament(id(req.params.id), b.type, b.grams, { reason: b.reason, userId: req.user!.id });
  audit(req.user!.id, "filament.movement", "filament", req.params.id as string, b, req.ip);
  res.json({ ok: true });
}));
v2.get("/factory/filaments/:id/movements", viewer, (req, res) => res.json(q.all("SELECT fm.*, u.name user_name FROM filament_movements fm LEFT JOIN users u ON u.id=fm.created_by WHERE filament_id=? ORDER BY fm.id DESC LIMIT 200", [id(req.params.id)])));
v2.delete("/factory/filaments/:id", operator, ah((req, res) => {
  confirmSchema.parse(req.body);
  q.run("UPDATE filaments SET active=0 WHERE id=?", [id(req.params.id)]);
  audit(req.user!.id, "filament.archive", "filament", req.params.id as string, null, req.ip);
  res.json({ ok: true });
}));

const poSchema = z.object({
  product_id: z.number().int().nullable().optional(), name: z.string().min(2).max(200), sku: z.string().max(60).nullable().optional(), quantity: z.number().int().positive().max(100000),
  material: z.string().max(20).nullable().optional(), color: z.string().max(40).nullable().optional(), filament_id: z.number().int().nullable().optional(), machine_id: z.number().int().nullable().optional(),
  weight_g_unit: z.number().positive().nullable().optional(), minutes_unit: z.number().positive().nullable().optional(), units_per_plate: z.number().int().positive().nullable().optional(),
  start_date: z.string().nullable().optional(), due_date: z.string().nullable().optional(), priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  sale_price_unit: z.number().positive().nullable().optional(), notes: z.string().max(1000).nullable().optional(),
});
const poCols = ["product_id", "name", "sku", "quantity", "material", "color", "filament_id", "machine_id", "weight_g_unit", "minutes_unit", "units_per_plate", "start_date", "due_date", "priority", "sale_price_unit", "notes"] as const;
v2.get("/factory/orders", viewer, (req, res) => res.json(listProductionOrders(req.query.status as string | undefined)));
v2.post("/factory/orders", operator, ah((req, res) => {
  const b = poSchema.parse(req.body);
  // Completa a partir do produto (peso/tempo/material) quando não informados
  if (b.product_id) {
    const p = q.get<any>("SELECT sku, weight_g, print_minutes, material, units_per_plate FROM products WHERE id=?", [b.product_id]);
    if (!p) throw new HttpError(404, "Produto não encontrado");
    b.sku ??= p.sku; b.weight_g_unit ??= p.weight_g; b.minutes_unit ??= p.print_minutes; b.material ??= p.material; b.units_per_plate ??= p.units_per_plate;
  }
  const r = q.run(`INSERT INTO production_orders (${poCols.join(",")}, status, created_by) VALUES (${poCols.map(() => "?").join(",")}, 'waiting', ?)`, [...poCols.map((k) => (b as any)[k] ?? null), req.user!.id]);
  audit(req.user!.id, "production_order.create", "production_order", Number(r.lastInsertRowid), b, req.ip);
  res.json({ id: Number(r.lastInsertRowid) });
}));
v2.put("/factory/orders/:id", operator, ah((req, res) => {
  const b = poSchema.parse(req.body);
  const po = q.get<any>("SELECT status FROM production_orders WHERE id=?", [id(req.params.id)]);
  if (!po) throw new HttpError(404, "Ordem não encontrada");
  if (["done", "cancelled"].includes(po.status)) throw new HttpError(409, "Ordens concluídas ou canceladas não podem ser editadas");
  q.run(`UPDATE production_orders SET ${poCols.map((k) => `${k}=?`).join(",")}, updated_at=? WHERE id=?`, [...poCols.map((k) => (b as any)[k] ?? null), now(), id(req.params.id)]);
  audit(req.user!.id, "production_order.update", "production_order", req.params.id as string, b, req.ip);
  res.json({ ok: true });
}));
v2.post("/factory/orders/:id/status", operator, ah((req, res) => {
  const b = z.object({ status: z.enum(PROD_STATUS), failed_units: z.number().int().min(0).optional(), confirm: z.literal(true) }).parse(req.body);
  const r = transitionOrder(id(req.params.id), b.status, req.user!.id, { failed_units: b.failed_units });
  audit(req.user!.id, "production_order.status", "production_order", req.params.id as string, { ...b, effects: r.effects }, req.ip);
  res.json(r);
}));
v2.get("/factory/planner", viewer, (_req, res) => res.json(productionPlanner()));
v2.post("/factory/planner/ai", operator, ah(async (_req, res) => {
  const plan = productionPlanner();
  const text = await analyze("Planeje a produção: o que imprimir primeiro, lotes possíveis, aproveitamento da mesa (A1: 256×256 mm), filamento necessário, tempo total e pedidos com risco de atraso. Priorize lucro por hora de máquina respeitando prazo e qualidade. Não compre nada: apenas recomende.", plan, "medium");
  res.json({ plan, analysis: text });
}));
v2.post("/factory/stock/:productId", operator, ah((req, res) => {
  const b = z.object({ type: z.enum(["in", "out", "adjust"]), qty: z.number().int().refine((n) => n !== 0), reason: z.string().max(200).optional(), confirm: z.literal(true) }).parse(req.body);
  recordMovement(id(req.params.productId), b.type, b.qty, { reason: b.reason, userId: req.user!.id });
  audit(req.user!.id, "stock.movement", "product", req.params.productId as string, b, req.ip);
  res.json({ ok: true });
}));
v2.get("/factory/export", viewer, ah(async (req, res) => {
  const kind = String(req.query.kind ?? "orders");
  if (kind === "filaments") {
    return sendReport(res, { title: "Estoque de filamentos", subtitle: subtitle(), columns: [{ key: "material", header: "Material" }, { key: "color", header: "Cor" }, { key: "brand", header: "Marca" }, { key: "total_g", header: "Total (g)", fmt: "int" }, { key: "available_g", header: "Disponível (g)", fmt: "int" }, { key: "min_g", header: "Mínimo (g)", fmt: "int" }, { key: "cost_per_kg", header: "R$/kg", fmt: "money" }, { key: "consumed_30d", header: "Consumo 30d (g)", fmt: "int" }],
      rows: listFilaments(), summary: [["Rolos", String(listFilaments().length)]] }, String(req.query.format ?? "xlsx"), "filamentos");
  }
  const rows = listProductionOrders("all");
  return sendReport(res, { title: "Ordens de produção", subtitle: subtitle(), columns: [{ key: "id", header: "OP", fmt: "int" }, { key: "name", header: "Produto", width: 40 }, { key: "sku", header: "SKU" }, { key: "quantity", header: "Qtd.", fmt: "int" }, { key: "material", header: "Material" }, { key: "total_minutes", header: "Tempo total (min)", fmt: "int" }, { key: "total_grams", header: "Filamento (g)", fmt: "int" }, { key: "due_date", header: "Prazo", fmt: "date" }, { key: "priority", header: "Prioridade" }, { key: "status", header: "Status" }],
    rows, summary: [["Ordens", String(rows.length)], ["Abertas", String(rows.filter((r) => !["done", "cancelled"].includes(r.status)).length)]] }, String(req.query.format ?? "xlsx"), "producao");
}));

// ======================================================================
// Laboratório de produtos
// ======================================================================
const labDir = path.join(config.dataDir, "lab");
fs.mkdirSync(labDir, { recursive: true });
const LAB_EXT = new Set([".stl", ".3mf", ".jpg", ".jpeg", ".png", ".webp", ".step", ".obj"]);
const labUpload = multer({
  storage: multer.diskStorage({ destination: labDir, filename: (_r, f, cb) => cb(null, `${Date.now()}-${randomToken(8)}${path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "")}`) }),
  limits: { fileSize: 80 * 1024 * 1024, files: 10 },
  fileFilter: (_r, f, cb) => cb(null, LAB_EXT.has(path.extname(f.originalname).toLowerCase())),
});
const labSchema = z.object({
  name: z.string().min(2).max(200), sku: z.string().max(60).nullable().optional(), category: z.string().max(100).nullable().optional(),
  model_supplier: z.string().max(200).nullable().optional(), license: z.string().max(200).nullable().optional(), weight_g: z.number().positive().nullable().optional(),
  print_minutes: z.number().positive().nullable().optional(), material: z.string().max(20).nullable().optional(), est_cost: z.number().min(0).nullable().optional(),
  sale_price: z.number().positive().nullable().optional(), status: z.enum(LAB_STATUS).default("idea"), description: z.string().max(5000).nullable().optional(), notes: z.string().max(5000).nullable().optional(),
});
const labCols = ["name", "sku", "category", "model_supplier", "license", "weight_g", "print_minutes", "material", "est_cost", "sale_price", "status", "description", "notes"] as const;
v2.get("/lab", viewer, (_req, res) => res.json({ items: listLab(), statuses: LAB_STATUS.map((s) => ({ value: s, label: LAB_STATUS_LABEL[s] })) }));
v2.get("/lab/:id", viewer, (req, res) => {
  const l = q.get<any>("SELECT * FROM lab_products WHERE id=?", [id(req.params.id)]);
  if (!l) throw new HttpError(404, "Produto não encontrado");
  res.json({ ...l, files: q.all("SELECT * FROM lab_files WHERE lab_product_id=? ORDER BY id", [l.id]), events: q.all("SELECT e.*, u.name user_name FROM lab_events e LEFT JOIN users u ON u.id=e.created_by WHERE lab_product_id=? ORDER BY e.id DESC", [l.id]) });
});
v2.post("/lab", operator, ah((req, res) => {
  const b = labSchema.parse(req.body);
  const r = q.run(`INSERT INTO lab_products (${labCols.join(",")}, created_by) VALUES (${labCols.map(() => "?").join(",")}, ?)`, [...labCols.map((k) => (b as any)[k] ?? null), req.user!.id]);
  const lid = Number(r.lastInsertRowid);
  labEvent(lid, "status", `Criado como "${LAB_STATUS_LABEL[b.status]}"`, req.user!.id);
  audit(req.user!.id, "lab.create", "lab_product", lid, b, req.ip);
  res.json({ id: lid });
}));
v2.put("/lab/:id", operator, ah((req, res) => {
  const b = labSchema.parse(req.body);
  const lid = id(req.params.id);
  const prev = q.get<any>("SELECT * FROM lab_products WHERE id=?", [lid]);
  if (!prev) throw new HttpError(404, "Produto não encontrado");
  q.run(`UPDATE lab_products SET ${labCols.map((k) => `${k}=?`).join(",")}, updated_at=? WHERE id=?`, [...labCols.map((k) => (b as any)[k] ?? null), now(), lid]);
  const changed = labCols.filter((k) => String(prev[k] ?? "") !== String((b as any)[k] ?? ""));
  if (prev.status !== b.status) labEvent(lid, "status", `Status: ${LAB_STATUS_LABEL[prev.status]} → ${LAB_STATUS_LABEL[b.status]}`, req.user!.id);
  const other = changed.filter((k) => k !== "status");
  if (other.length) labEvent(lid, "change", `Alterado: ${other.join(", ")}`, req.user!.id, other.map((k) => `${k}: ${prev[k] ?? "—"} → ${(b as any)[k] ?? "—"}`).join("\n"));
  audit(req.user!.id, "lab.update", "lab_product", lid, b, req.ip);
  res.json({ ok: true });
}));
v2.post("/lab/:id/events", operator, ah((req, res) => {
  const b = z.object({ kind: z.enum(["test", "change", "note"]), title: z.string().min(2).max(200), details: z.string().max(5000).optional(), result: z.enum(["aprovado", "reprovado", "ajustar"]).optional() }).parse(req.body);
  labEvent(id(req.params.id), b.kind, b.title, req.user!.id, b.details, b.result);
  q.run("UPDATE lab_products SET updated_at=? WHERE id=?", [now(), id(req.params.id)]);
  res.json({ ok: true });
}));
v2.post("/lab/:id/files", operator, labUpload.array("files", 10), ah((req, res) => {
  const lid = id(req.params.id);
  if (!q.get("SELECT 1 FROM lab_products WHERE id=?", [lid])) throw new HttpError(404, "Produto não encontrado");
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw new HttpError(400, "Envie arquivos STL, 3MF ou imagens (JPG, PNG, WEBP)");
  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    const kind = ext === ".stl" ? "stl" : ext === ".3mf" ? "3mf" : [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? "image" : "other";
    q.run("INSERT INTO lab_files (lab_product_id, kind, filename, original_name, size, created_by) VALUES (?,?,?,?,?,?)", [lid, kind, f.filename, f.originalname.slice(0, 200), f.size, req.user!.id]);
  }
  labEvent(lid, "change", `${files.length} arquivo(s) anexado(s)`, req.user!.id, files.map((f) => f.originalname).join(", "));
  res.json({ ok: true, count: files.length });
}));
v2.get("/lab-files/:file", viewer, (req, res) => {
  const name = path.basename(String(req.params.file));
  const rec = q.get<any>("SELECT * FROM lab_files WHERE filename=?", [name]);
  const f = path.join(labDir, name);
  if (!rec || !fs.existsSync(f)) throw new HttpError(404, "Arquivo não encontrado");
  if (rec.kind !== "image") res.setHeader("Content-Disposition", `attachment; filename="${String(rec.original_name ?? name).replace(/[^\w.\- ]/g, "_")}"`);
  res.sendFile(f);
});
v2.delete("/lab-files/:id", operator, ah((req, res) => {
  confirmSchema.parse(req.body);
  const rec = q.get<any>("SELECT * FROM lab_files WHERE id=?", [id(req.params.id)]);
  if (!rec) throw new HttpError(404, "Arquivo não encontrado");
  q.run("DELETE FROM lab_files WHERE id=?", [rec.id]);
  fs.rmSync(path.join(labDir, rec.filename), { force: true });
  labEvent(rec.lab_product_id, "change", `Arquivo removido: ${rec.original_name}`, req.user!.id);
  res.json({ ok: true });
}));
v2.post("/lab/:id/convert", admin, ah((req, res) => {
  confirmSchema.parse(req.body);
  const pid = convertLabToProduct(id(req.params.id), req.user!.id);
  audit(req.user!.id, "lab.convert", "lab_product", req.params.id as string, { product_id: pid }, req.ip);
  res.json({ product_id: pid });
}));
v2.delete("/lab/:id", admin, ah((req, res) => {
  confirmSchema.parse(req.body);
  const lid = id(req.params.id);
  for (const f of q.all<any>("SELECT filename FROM lab_files WHERE lab_product_id=?", [lid])) fs.rmSync(path.join(labDir, f.filename), { force: true });
  q.run("DELETE FROM lab_products WHERE id=?", [lid]);
  audit(req.user!.id, "lab.delete", "lab_product", lid, null, req.ip);
  res.json({ ok: true });
}));

// ======================================================================
// Radar de produtos 3D
// ======================================================================
v2.get("/radar", viewer, (_req, res) => res.json({
  items: listOpportunities(), categories: RADAR_CATEGORIES,
  sources: { mercadolivre: !!getAccount(), web_research: aiConfigured(), google_trends: false },
}));
v2.post("/radar", operator, ah((req, res) => {
  const oid = saveOpportunity(oppSchema.parse({ ...req.body, source: "manual" }));
  audit(req.user!.id, "radar.create", "opportunity", oid, req.body, req.ip);
  res.json({ id: oid });
}));
v2.put("/radar/:id", operator, ah((req, res) => {
  const prev = q.get<any>("SELECT source FROM opportunities WHERE id=?", [id(req.params.id)]);
  if (!prev) throw new HttpError(404, "Oportunidade não encontrada");
  saveOpportunity(oppSchema.parse({ ...req.body, source: prev.source }), id(req.params.id));
  audit(req.user!.id, "radar.update", "opportunity", req.params.id as string, req.body, req.ip);
  res.json({ ok: true });
}));
v2.patch("/radar/:id/status", operator, ah((req, res) => {
  const { status } = z.object({ status: z.enum(["new", "watching", "planned", "discarded"]) }).parse(req.body);
  q.run("UPDATE opportunities SET status=? WHERE id=?", [status, id(req.params.id)]);
  res.json({ ok: true });
}));
v2.post("/radar/research/ml", operator, ah(async (req, res) => {
  const b = z.object({ term: z.string().min(2).max(120), category: z.string().max(100).nullable().optional() }).parse(req.body);
  const oid = await radarFromMl(b.term, b.category ?? null, req.user!.id);
  audit(req.user!.id, "radar.research_ml", "opportunity", oid, b, req.ip);
  res.json({ id: oid });
}));
v2.post("/radar/research/web", operator, ah(async (req, res) => {
  const b = z.object({ category: z.string().min(2).max(100), context: z.string().max(1000).default("") }).parse(req.body);
  const r = await radarWebResearch(b.category, b.context);
  audit(req.user!.id, "radar.research_web", "opportunity", null, { ...b, created: r?.created }, req.ip);
  res.json(r);
}));
v2.post("/radar/estimate", viewer, ah((req, res) => {
  const b = z.object({ price: z.number().positive(), weight_g: z.number().positive(), print_minutes: z.number().positive(), material: z.string().default("PLA") }).parse(req.body);
  res.json(estimateMargin(b.price, b.weight_g, b.print_minutes, b.material));
}));
v2.post("/radar/:id/to-lab", operator, ah((req, res) => {
  const lid = addOpportunityToLab(id(req.params.id), req.user!.id);
  audit(req.user!.id, "radar.to_lab", "opportunity", req.params.id as string, { lab_product_id: lid }, req.ip);
  res.json({ lab_product_id: lid });
}));
v2.delete("/radar/:id", operator, ah((req, res) => {
  confirmSchema.parse(req.body);
  q.run("DELETE FROM opportunities WHERE id=?", [id(req.params.id)]);
  res.json({ ok: true });
}));

// ======================================================================
// Concorrência
// ======================================================================
const compSchema = z.object({
  name: z.string().min(1).max(120), product: z.string().max(200).nullable().optional(), price: z.number().positive().nullable().optional(), url: z.string().url().max(1000).nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(), reviews: z.number().int().min(0).nullable().optional(), public_sales: z.string().max(100).nullable().optional(),
  differentials: z.string().max(2000).nullable().optional(), photos_note: z.string().max(1000).nullable().optional(), our_listing_id: z.string().max(40).nullable().optional(),
  our_price: z.number().positive().nullable().optional(), analyzed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), notes: z.string().max(2000).nullable().optional(),
});
const compCols = ["name", "product", "price", "url", "rating", "reviews", "public_sales", "differentials", "photos_note", "our_listing_id", "our_price", "analyzed_at", "notes"] as const;
function compareRow(c: any) {
  const ours = c.our_price ?? (c.our_listing_id ? q.get<{ price: number }>("SELECT price FROM listings WHERE id=?", [c.our_listing_id])?.price : null) ?? null;
  const diff = ours && c.price ? ((c.price - ours) / ours) * 100 : null;
  const flags: string[] = [];
  if (diff !== null && diff <= -20) flags.push("preço muito abaixo do nosso");
  if (diff !== null && diff >= 15) flags.push("espaço para posicionamento premium/competitivo");
  if (c.differentials && c.differentials.length > 60) flags.push("diferenciais declarados — comparar com os nossos");
  if (!c.differentials) flags.push("pouca diferenciação registrada");
  return { ...c, our_effective_price: ours, price_diff_pct: diff, flags };
}
v2.get("/competitors", viewer, (_req, res) => res.json(q.all("SELECT * FROM competitors ORDER BY analyzed_at DESC, id DESC").map(compareRow)));
v2.post("/competitors", operator, ah((req, res) => {
  const b = compSchema.parse(req.body);
  b.analyzed_at ??= localDate(new Date());
  const r = q.run(`INSERT INTO competitors (${compCols.join(",")}, source, created_by) VALUES (${compCols.map(() => "?").join(",")}, 'manual', ?)`, [...compCols.map((k) => (b as any)[k] ?? null), req.user!.id]);
  audit(req.user!.id, "competitor.create", "competitor", Number(r.lastInsertRowid), b, req.ip);
  res.json({ id: Number(r.lastInsertRowid) });
}));
v2.put("/competitors/:id", operator, ah((req, res) => {
  const b = compSchema.parse(req.body);
  b.analyzed_at ??= localDate(new Date());
  q.run(`UPDATE competitors SET ${compCols.map((k) => `${k}=?`).join(",")} WHERE id=?`, [...compCols.map((k) => (b as any)[k] ?? null), id(req.params.id)]);
  res.json({ ok: true });
}));
v2.delete("/competitors/:id", operator, ah((req, res) => {
  confirmSchema.parse(req.body);
  q.run("DELETE FROM competitors WHERE id=?", [id(req.params.id)]);
  res.json({ ok: true });
}));
/** Importa links públicos de anúncios. Com o ML conectado, lê os dados públicos do item pela API oficial. */
v2.post("/competitors/import-links", operator, ah(async (req, res) => {
  const { urls, our_listing_id } = z.object({ urls: z.array(z.string().url()).min(1).max(30), our_listing_id: z.string().max(40).nullable().optional() }).parse(req.body);
  const results: { url: string; id?: number; status: string }[] = [];
  for (const url of urls) {
    const m = url.match(/ML[A-Z]-?\d{6,}/i);
    const mlId = m ? m[0].toUpperCase().replace("-", "") : null;
    let data: any = null;
    let note = "link registrado — preencha preço e dados manualmente";
    if (mlId && getAccount()) {
      try {
        const r = await ml<any[]>(`/items?ids=${mlId}&attributes=id,title,price,seller_id,permalink,thumbnail,sold_quantity`);
        data = r[0]?.code === 200 ? r[0].body : null;
        note = data ? "dados públicos lidos pela API oficial" : "item não acessível pela API";
      } catch (e) { note = `API indisponível: ${(e as Error).message}`; }
    } else if (mlId) note = "ML não conectado — preencha os dados manualmente";
    const r = q.run(`INSERT INTO competitors (name, product, price, url, ml_item_id, thumbnail, public_sales, our_listing_id, analyzed_at, source, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
      data?.seller_id ? `Vendedor ${data.seller_id}` : new URL(url).hostname, data?.title ?? null, data?.price ?? null, url, mlId, data?.thumbnail ?? null,
      typeof data?.sold_quantity === "number" ? `${data.sold_quantity} vendidos (API)` : null, our_listing_id ?? null, localDate(new Date()), data ? "ml_api" : "link", note, req.user!.id,
    ]);
    results.push({ url, id: Number(r.lastInsertRowid), status: note });
  }
  audit(req.user!.id, "competitor.import_links", "competitor", null, { count: urls.length }, req.ip);
  res.json({ results });
}));
v2.post("/competitors/analyze", operator, ah(async (_req, res) => {
  const comps = q.all("SELECT * FROM competitors ORDER BY analyzed_at DESC LIMIT 60").map(compareRow);
  if (!comps.length) throw new HttpError(400, "Cadastre concorrentes antes de pedir a análise.");
  const text = await analyze("Analise a concorrência: produtos com preço muito abaixo do nosso, concorrentes com diferenciais superiores, oportunidades de posicionamento premium, produtos com pouca diferenciação e oportunidades de kits. Use apenas dados públicos cadastrados.", comps, "medium");
  res.json({ analysis: text });
}));

// ======================================================================
// Central de importação
// ======================================================================
const importDir = path.join(config.dataDir, "imports");
fs.mkdirSync(importDir, { recursive: true });
const importUpload = multer({
  storage: multer.diskStorage({ destination: importDir, filename: (_r, f, cb) => cb(null, `${Date.now()}-${randomToken(8)}${path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "")}`) }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_r, f, cb) => cb(null, [".csv", ".txt", ".xlsx", ".pdf"].includes(path.extname(f.originalname).toLowerCase())),
});

async function previewFor(imp: any, kind: string, mapping?: Record<string, number | null>) {
  const file = path.join(importDir, imp.filename);
  if (!fs.existsSync(file)) throw new HttpError(410, "Arquivo da importação não está mais disponível");
  const data = await readFileRows(file, imp.original_name);
  let preview;
  let pdfNote: string | null = null;
  if (data.type === "pdf") {
    const values = parseMetricsText(data.text ?? "");
    const found = Object.values(values).filter((v) => v !== null).length;
    pdfNote = found ? `${found} valor(es) identificados no PDF. Confira antes de importar.` : "Nenhum indicador reconhecido no PDF. Exporte o relatório em CSV/XLSX ou cadastre manualmente.";
    preview = buildPreview("period_report", [], undefined, values);
    kind = "period_report";
  } else {
    preview = buildPreview(kind, data.rows, mapping);
  }
  const issues = preview.parsed.flatMap((r) => [...r.errors.map((m) => ({ row: r.row, level: "error", message: m })), ...r.warnings.map((m) => ({ row: r.row, level: "warning", message: m }))]);
  q.run("UPDATE imports SET kind=?, mapping=?, headers=?, rows_total=?, issues=? WHERE id=?", [kind, JSON.stringify(preview.mapping), JSON.stringify(preview.headers), preview.parsed.length, JSON.stringify(issues.slice(0, 500)), imp.id]);
  return {
    import_id: imp.id, kind, file_type: data.type, pdf_note: pdfNote,
    fields: preview.def.fields.map((f) => ({ key: f.key, label: f.label, required: !!f.required, type: f.type })),
    headers: preview.headers, mapping: preview.mapping, missing_required: (preview as any).missingRequired ?? [],
    rows: preview.parsed.slice(0, 50).map((r) => ({ row: r.row, values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, v && typeof v === "object" && "day" in v ? v.day : v])), errors: r.errors, warnings: r.warnings })),
    totals: { rows: preview.parsed.length, valid: preview.parsed.filter((r) => !r.errors.length).length, with_errors: preview.parsed.filter((r) => r.errors.length).length, duplicates: preview.parsed.filter((r) => r.duplicate).length, warnings: preview.parsed.filter((r) => r.warnings.length).length },
    issues: issues.slice(0, 200),
  };
}

v2.get("/imports/kinds", viewer, (_req, res) => res.json(Object.values(IMPORT_KINDS).map((k) => ({ key: k.key, label: k.label, description: k.description, fields: k.fields.map((f) => ({ key: f.key, label: f.label, required: !!f.required })) }))));
v2.get("/imports", viewer, (_req, res) => res.json(q.all("SELECT i.id, i.kind, i.original_name, i.file_type, i.status, i.rows_total, i.rows_imported, i.rows_skipped, i.created_at, i.imported_at, i.undone_at, u.name user_name FROM imports i LEFT JOIN users u ON u.id=i.created_by ORDER BY i.id DESC LIMIT 200")));
v2.post("/imports", operator, importUpload.single("file"), ah(async (req, res) => {
  const f = req.file;
  if (!f) throw new HttpError(400, "Envie um arquivo CSV, XLSX ou PDF");
  const ext = path.extname(f.originalname).toLowerCase().slice(1);
  const r = q.run("INSERT INTO imports (kind, filename, original_name, file_type, created_by) VALUES (?,?,?,?,?)", ["orders", f.filename, f.originalname.slice(0, 200), ext, req.user!.id]);
  const imp = q.get<any>("SELECT * FROM imports WHERE id=?", [Number(r.lastInsertRowid)])!;
  let kind = String(req.body.kind || "");
  if (!kind || kind === "auto") {
    if (ext === "pdf") kind = "period_report";
    else {
      const data = await readFileRows(path.join(importDir, f.filename), f.originalname);
      const headerGuess = data.rows.slice(0, 20).sort((a, b) => b.filter(Boolean).length - a.filter(Boolean).length)[0] ?? [];
      kind = guessKind(headerGuess);
    }
  }
  if (!IMPORT_KINDS[kind]) throw new HttpError(400, "Tipo de importação inválido");
  audit(req.user!.id, "import.upload", "import", imp.id, { name: f.originalname, kind }, req.ip);
  res.json(await previewFor(imp, kind));
}));
v2.post("/imports/:id/preview", operator, ah(async (req, res) => {
  const b = z.object({ kind: z.string(), mapping: z.record(z.string(), z.number().int().min(0).nullable()).optional() }).parse(req.body);
  const imp = q.get<any>("SELECT * FROM imports WHERE id=?", [id(req.params.id)]);
  if (!imp) throw new HttpError(404, "Importação não encontrada");
  if (imp.status !== "preview") throw new HttpError(409, "Esta importação já foi processada");
  res.json(await previewFor(imp, b.kind, b.mapping));
}));
v2.post("/imports/:id/commit", operator, ah(async (req, res) => {
  const b = z.object({ kind: z.string(), mapping: z.record(z.string(), z.number().int().min(0).nullable()).optional(), confirm: z.literal(true), values: z.record(z.string(), z.any()).optional() }).parse(req.body);
  const imp = q.get<any>("SELECT * FROM imports WHERE id=?", [id(req.params.id)]);
  if (!imp) throw new HttpError(404, "Importação não encontrada");
  if (imp.status !== "preview") throw new HttpError(409, "Esta importação já foi processada");
  const file = path.join(importDir, imp.filename);
  const data = await readFileRows(file, imp.original_name);
  let parsed;
  if (data.type === "pdf") {
    // valores do PDF podem ser corrigidos pelo usuário na prévia
    const values = { ...parseMetricsText(data.text ?? ""), ...(b.values ?? {}) };
    parsed = buildPreview("period_report", [], undefined, values).parsed;
  } else parsed = buildPreview(b.kind, data.rows, b.mapping).parsed;
  if (!parsed.some((r) => !r.errors.length)) throw new HttpError(400, "Nenhuma linha válida para importar. Corrija o mapeamento ou o arquivo.");
  const r = commitImport(imp.id, data.type === "pdf" ? "period_report" : b.kind, parsed, req.user!.id);
  audit(req.user!.id, "import.commit", "import", imp.id, r, req.ip);
  res.json(r);
}));
v2.post("/imports/:id/undo", admin, ah((req, res) => {
  confirmSchema.parse(req.body);
  const r = undoImport(id(req.params.id));
  audit(req.user!.id, "import.undo", "import", req.params.id as string, r, req.ip);
  res.json(r);
}));
v2.get("/imports/:id", viewer, (req, res) => {
  const imp = q.get<any>("SELECT * FROM imports WHERE id=?", [id(req.params.id)]);
  if (!imp) throw new HttpError(404, "Importação não encontrada");
  res.json({ ...imp, mapping: json.parse(imp.mapping, {}), headers: json.parse(imp.headers, []), issues: json.parse(imp.issues, []), summary: json.parse(imp.summary, null) });
});

// ======================================================================
// Marketing: gerador de anúncios, plano de fotos e publicidade
// ======================================================================
const PHOTO_PLAN = [
  "Foto principal em fundo branco", "Produto em uso", "Foto com dimensões", "Detalhes de acabamento", "Benefícios em destaque", "Variações de cores", "Embalagem",
];
v2.get("/marketing", viewer, (_req, res) => res.json(q.all("SELECT id, name, product_id, lab_product_id, listing_id, photo_plan, created_at, updated_at FROM marketing_contents ORDER BY updated_at DESC").map((m: any) => ({ ...m, photo_plan: json.parse(m.photo_plan, []) }))));
v2.get("/marketing/:id", viewer, (req, res) => {
  const m = q.get<any>("SELECT * FROM marketing_contents WHERE id=?", [id(req.params.id)]);
  if (!m) throw new HttpError(404, "Conteúdo não encontrado");
  res.json({ ...m, content: json.parse(m.content, {}), photo_plan: json.parse(m.photo_plan, []) });
});
v2.post("/marketing/generate", operator, ah(async (req, res) => {
  const b = z.object({
    product_id: z.number().int().optional(), lab_product_id: z.number().int().optional(), listing_id: z.string().optional(),
    name: z.string().max(200).optional(), details: z.string().max(4000).optional(), material: z.string().max(20).optional(),
    weight_g: z.number().positive().optional(), print_minutes: z.number().positive().optional(), reference_price: z.number().positive().optional(), channel: z.string().default("mercadolivre"),
  }).parse(req.body);
  let product: any = { nome: b.name, detalhes: b.details, material: b.material, peso_g: b.weight_g, tempo_impressao_min: b.print_minutes };
  if (b.product_id) {
    const p = q.get<any>("SELECT * FROM products WHERE id=?", [b.product_id]);
    if (!p) throw new HttpError(404, "Produto não encontrado");
    product = { ...product, nome: p.name, sku: p.sku, categoria: p.category, material: p.material ?? b.material, peso_g: p.weight_g ?? b.weight_g, tempo_impressao_min: p.print_minutes ?? b.print_minutes, notas: p.notes };
  } else if (b.lab_product_id) {
    const l = q.get<any>("SELECT * FROM lab_products WHERE id=?", [b.lab_product_id]);
    if (!l) throw new HttpError(404, "Produto do laboratório não encontrado");
    product = { ...product, nome: l.name, sku: l.sku, categoria: l.category, material: l.material, peso_g: l.weight_g, tempo_impressao_min: l.print_minutes, descricao: l.description, licenca_modelo: l.license };
  } else if (b.listing_id) {
    const l = listingDetail(b.listing_id);
    if (!l) throw new HttpError(404, "Anúncio não encontrado");
    product = { ...product, nome: l.title, sku: l.sku, preco_atual: l.price, preco_original: l.original_price, atributos: l.attributes, qualidade: l.quality_score, conversao_pct: l.conversion_pct, peso_g: l.weight_g, tempo_impressao_min: l.print_minutes };
  }
  if (!product.nome) throw new HttpError(400, "Informe o produto");
  const comps = q.all<{ price: number }>("SELECT price FROM competitors WHERE price IS NOT NULL AND (product LIKE ? OR name LIKE ?)", [`%${String(product.nome).slice(0, 30)}%`, `%${String(product.nome).slice(0, 30)}%`]);
  let pricing: any = { nota: "Preço sugerido indisponível: informe peso, tempo e preço de referência e configure os custos no Financeiro." };
  const refPrice = b.reference_price ?? product.preco_atual ?? null;
  if (product.peso_g && product.tempo_impressao_min) {
    const ch = q.get<any>("SELECT * FROM channels WHERE id=?", [b.channel]);
    const c = calculate({ weight_g: product.peso_g, print_minutes: product.tempo_impressao_min, material: product.material ?? "PLA", sale_price: refPrice ?? 1, fee_pct: ch?.fee_pct ?? null, fixed_fee: ch?.fixed_fee ?? null, shipping: ch?.shipping_cost ?? null });
    pricing = { preco_minimo: c.min_price, preco_recomendado: c.recommended_price, preco_promocional: c.promo_price, custo_variavel_no_preco_ref: refPrice ? c.total_variable_cost : null, itens_de_custo_faltando: c.missing, precos_concorrentes_cadastrados: comps.map((x) => x.price) };
  }
  const out = await generateListingCopy(product, pricing);
  const plan = (out!.content.plano_fotos.length ? out!.content.plano_fotos.map((p) => ({ title: p.tipo, description: p.descricao })) : PHOTO_PLAN.map((t) => ({ title: t, description: "" }))).map((p) => ({ ...p, done: false }));
  const r = q.run("INSERT INTO marketing_contents (product_id, lab_product_id, listing_id, name, content, photo_plan, model, created_by) VALUES (?,?,?,?,?,?,?,?)",
    [b.product_id ?? null, b.lab_product_id ?? null, b.listing_id ?? null, String(product.nome).slice(0, 200), JSON.stringify({ ...out!.content, pricing }), JSON.stringify(plan), out!.model, req.user!.id]);
  audit(req.user!.id, "marketing.generate", "marketing_content", Number(r.lastInsertRowid), { name: product.nome }, req.ip);
  res.json({ id: Number(r.lastInsertRowid) });
}));
v2.patch("/marketing/:id/photos", operator, ah((req, res) => {
  const b = z.object({ index: z.number().int().min(0).max(20), done: z.boolean() }).parse(req.body);
  const m = q.get<any>("SELECT photo_plan FROM marketing_contents WHERE id=?", [id(req.params.id)]);
  if (!m) throw new HttpError(404, "Conteúdo não encontrado");
  const plan = json.parse<any[]>(m.photo_plan, []);
  if (!plan[b.index]) throw new HttpError(400, "Foto inexistente");
  plan[b.index].done = b.done;
  q.run("UPDATE marketing_contents SET photo_plan=?, updated_at=? WHERE id=?", [JSON.stringify(plan), now(), id(req.params.id)]);
  res.json({ photo_plan: plan });
}));
v2.delete("/marketing/:id", operator, ah((req, res) => {
  confirmSchema.parse(req.body);
  q.run("DELETE FROM marketing_contents WHERE id=?", [id(req.params.id)]);
  res.json({ ok: true });
}));
/** Análise de publicidade somente leitura: nunca altera campanhas. */
v2.get("/marketing/ads", viewer, ah((req, res) => {
  const { period = "30d", from, to } = req.query as Record<string, string>;
  const r = resolvePeriod(period, from, to);
  const camps = q.all<any>(`SELECT c.id, c.name, c.status, c.budget, c.import_id, SUM(d.prints) prints, SUM(d.clicks) clicks, SUM(d.cost) cost, SUM(d.total_amount) total_amount, SUM(d.units) units
    FROM ads_campaigns c JOIN ads_campaign_daily d ON d.campaign_id=c.id WHERE d.date BETWEEN ? AND ? GROUP BY c.id ORDER BY cost DESC`, [r.from, r.to]);
  const ranking = profitabilityRanking();
  const avgMargin = (() => { const k = ranking.filter((p) => p.calc?.complete); return k.length ? k.reduce((s, p) => s + p.calc!.margin_pct, 0) / k.length : null; })();
  const rows = camps.map((c) => {
    const d = adsDerived(c);
    const marginAfterAds = avgMargin !== null && c.total_amount ? (avgMargin / 100) * c.total_amount - c.cost : null;
    return { ...c, ...d, cpc: c.clicks ? c.cost / c.clicks : null, acos_pct: c.total_amount ? (c.cost / c.total_amount) * 100 : null, roas: c.cost ? (c.total_amount ?? 0) / c.cost : null, margin_after_ads: marginAfterAds, source: c.import_id ? "importado" : "API" };
  });
  const totals = rows.reduce((s, c) => ({ prints: s.prints + (c.prints ?? 0), clicks: s.clicks + (c.clicks ?? 0), cost: s.cost + (c.cost ?? 0), revenue: s.revenue + (c.total_amount ?? 0) }), { prints: 0, clicks: 0, cost: 0, revenue: 0 });
  res.json({
    range: r, campaigns: rows,
    totals: { ...totals, cpc: totals.clicks ? totals.cost / totals.clicks : null, acos_pct: totals.revenue ? (totals.cost / totals.revenue) * 100 : null, roas: totals.cost ? totals.revenue / totals.cost : null, ctr_pct: totals.prints ? (totals.clicks / totals.prints) * 100 : null },
    avg_product_margin_pct: avgMargin,
    daily: q.all("SELECT date, SUM(cost) cost, SUM(total_amount) revenue, SUM(clicks) clicks FROM ads_campaign_daily WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date", [r.from, r.to]),
    note: "Somente leitura. Alterações de campanha devem ser feitas no Mercado Livre/Shopee após sua decisão.",
  });
}));

// ======================================================================
// Mind AI
// ======================================================================
v2.get("/mind/conversations", viewer, (req, res) => res.json(listConversations(req.user!.id)));
v2.get("/mind/conversations/:id", viewer, (req, res) => res.json(getConversation(id(req.params.id), req.user!.id)));
v2.delete("/mind/conversations/:id", viewer, ah((req, res) => {
  getConversation(id(req.params.id), req.user!.id);
  q.run("DELETE FROM ai_conversations WHERE id=?", [id(req.params.id)]);
  res.json({ ok: true });
}));
v2.post("/mind/chat", viewer, ah(async (req, res) => {
  const b = z.object({ conversation_id: z.number().int().optional(), agent: z.enum(["mind", "ceo"]).default("mind"), message: z.string().min(2).max(6000) }).parse(req.body);
  res.json(await chat({ conversationId: b.conversation_id, agent: b.agent, message: b.message, userId: req.user!.id }));
}));
v2.get("/mind/diagnosis", viewer, (_req, res) => res.json(latestDiagnosis()));
v2.post("/mind/diagnosis", operator, ah(async (req, res) => {
  const r = await ceoDiagnosis(req.user!.id);
  audit(req.user!.id, "ai.ceo_diagnosis", "ai_report", r?.id ?? null, null, req.ip);
  res.json(r);
}));
/** Transparência: exatamente o que a IA recebe como contexto. */
v2.get("/mind/context", viewer, (_req, res) => res.json(companySnapshot()));

// ======================================================================
// Alertas configuráveis e rotinas
// ======================================================================
v2.get("/alert-rules", viewer, (_req, res) => res.json(q.all("SELECT * FROM alert_rules ORDER BY label")));
v2.put("/alert-rules/:type", admin, ah((req, res) => {
  const b = z.object({ enabled: z.boolean(), severity: z.enum(["info", "opportunity", "warning", "critical"]).nullable(), threshold: z.number().nullable().optional() }).parse(req.body);
  q.run("UPDATE alert_rules SET enabled=?, severity=?, threshold=COALESCE(?, threshold) WHERE type=?", [b.enabled ? 1 : 0, b.severity, b.threshold ?? null, String(req.params.type)]);
  audit(req.user!.id, "alert_rule.update", "alert_rule", req.params.type as string, b, req.ip);
  res.json({ ok: true });
}));
v2.get("/routines", viewer, (_req, res) => res.json({ routines: listRoutines(), scheduler: { mode: "internal", note: "Agendamento interno do servidor (verificação a cada 5 min, horário de São Paulo). Requer o processo do servidor em execução contínua.", ai: aiConfigured() } }));
v2.put("/routines/:key", admin, ah((req, res) => {
  const b = z.object({ enabled: z.boolean(), hour: z.number().int().min(0).max(23), weekday: z.number().int().min(0).max(6).nullable().optional(), use_ai: z.boolean(), webhook_url: z.string().url().max(500).nullable().optional() }).parse(req.body);
  const r = q.get<any>("SELECT frequency FROM routines WHERE key=?", [String(req.params.key)]);
  if (!r) throw new HttpError(404, "Rotina inexistente");
  q.run("UPDATE routines SET enabled=?, hour=?, weekday=?, use_ai=?, webhook_url=? WHERE key=?", [b.enabled ? 1 : 0, b.hour, r.frequency === "weekly" ? b.weekday ?? null : null, b.use_ai ? 1 : 0, b.webhook_url ?? null, String(req.params.key)]);
  audit(req.user!.id, "routine.update", "routine", req.params.key as string, b, req.ip);
  res.json({ ok: true });
}));
v2.post("/routines/:key/run", operator, ah(async (req, res) => {
  const r = await runRoutine(String(req.params.key), "manual");
  audit(req.user!.id, "routine.run", "routine", req.params.key as string, r, req.ip);
  res.json(r);
}));
v2.get("/routines/:key/preview", viewer, (req, res) => res.json(routineData(String(req.params.key))));
v2.get("/routines/:key/runs", viewer, (req, res) => res.json(q.all("SELECT id, started_at, finished_at, status, trigger, error FROM routine_runs WHERE routine_key=? ORDER BY id DESC LIMIT 30", [String(req.params.key)])));
v2.get("/routine-runs/:id", viewer, (req, res) => {
  const r = q.get<any>("SELECT * FROM routine_runs WHERE id=?", [id(req.params.id)]);
  if (!r) throw new HttpError(404, "Execução não encontrada");
  res.json({ ...r, data: json.parse(r.data, null) });
});

// ======================================================================
// Atividades e busca global ampliada
// ======================================================================
v2.get("/activity", viewer, (req, res) => {
  res.json(q.all("SELECT a.id, a.at, a.action, a.entity, a.entity_id, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT ?", [Math.min(Number(req.query.limit ?? 50), 200)]));
});
v2.get("/search2", viewer, (req, res) => {
  const term = String(req.query.q ?? "").trim();
  if (term.length < 2) return res.json([]);
  const s = `%${term}%`;
  res.json([
    ...q.all("SELECT 'listing' type, id, title label, status extra FROM listings WHERE title LIKE ? OR id LIKE ? OR sku LIKE ? LIMIT 6", [s, s, s]),
    ...q.all("SELECT 'product' type, CAST(id AS TEXT) id, name label, sku extra FROM products WHERE name LIKE ? OR sku LIKE ? LIMIT 5", [s, s]),
    ...q.all("SELECT 'order' type, CAST(id AS TEXT) id, 'Pedido ' || id label, status extra FROM orders WHERE CAST(id AS TEXT) LIKE ? LIMIT 4", [s]),
    ...q.all("SELECT 'lab' type, CAST(id AS TEXT) id, name label, status extra FROM lab_products WHERE name LIKE ? OR sku LIKE ? LIMIT 4", [s, s]),
    ...q.all("SELECT 'opportunity' type, CAST(id AS TEXT) id, name label, CAST(ROUND(score) AS TEXT) extra FROM opportunities WHERE name LIKE ? LIMIT 4", [s]),
    ...q.all("SELECT 'competitor' type, CAST(id AS TEXT) id, name || COALESCE(' · ' || product,'') label, NULL extra FROM competitors WHERE name LIKE ? OR product LIKE ? LIMIT 4", [s, s]),
    ...q.all("SELECT 'production' type, CAST(id AS TEXT) id, 'OP #' || id || ' ' || name label, status extra FROM production_orders WHERE name LIKE ? OR sku LIKE ? LIMIT 4", [s, s]),
  ]);
});

void IntegrationUnavailable;
