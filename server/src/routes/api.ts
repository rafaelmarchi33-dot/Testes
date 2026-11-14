import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { z } from "zod";
import { q, json, getSetting, setSetting } from "../db/index.ts";
import { ah, HttpError, IntegrationUnavailable } from "../lib/errors.ts";
import { audit } from "../lib/audit.ts";
import { requireRole } from "../auth/index.ts";
import { config, aiConfigured, mlConfigured } from "../config.ts";
import { randomToken } from "../lib/crypto.ts";
import { resolvePeriod, localDate } from "../lib/dates.ts";
import { dashboard, ensureCategoryNames, dataGaps } from "../services/metrics.ts";
import { runSync, processNotification } from "../ml/sync.ts";
import { getAccount } from "../ml/client.ts";
import { adsOverview } from "../ml/ads.ts";
import { categoryAttributes, predictCategory, categoryInfo, validateDraft, type DraftFinal } from "../ml/publish.ts";
import { createAction, approveAction, rejectAction, refreshListing, actionSchemas, type ActionType } from "../services/actions.ts";
import { listAlerts, evaluateAlerts } from "../services/alerts.ts";
import { productionPlan, stockTurnover } from "../services/inventory.ts";
import {
  simulate, priceForMargin, fetchFee, recommendPrice, profitByListing, getProductCosts, emptyCosts, financeDefaults, breakEvenUnits, productionCost,
  type CostProfile, type FeeInfo,
} from "../services/finance.ts";
import { askManager, generateDailyReport, latestDailyReport } from "../ai/manager.ts";
import { ai, common, checkStop, textOf, aiError } from "../ai/claude.ts";
import { identifyProduct, composeListing, type ProductInput } from "../ai/listing.ts";
import { research, generateOpportunities, siteTrends, DEFAULT_3D_SEEDS } from "../services/market.ts";
import { buildReport, toExcel, toPdf, REPORTS, type ReportKey } from "../services/reports.ts";
import { logger } from "../lib/logger.ts";
import { runBackup, listBackups } from "../services/backup.ts";

export const api = Router();
const viewer = requireRole("viewer");
const operator = requireRole("operator");
const admin = requireRole("admin");
const num = (v: unknown, d: number) => (v === undefined || v === "" ? d : Number(v));

// ======================================================================
// Sistema
// ======================================================================
api.get("/system/status", viewer, (_req, res) => {
  res.json({
    ml_configured: mlConfigured(),
    ai_configured: aiConfigured(),
    ai_model: config.ai.model,
    account: getAccount() ? { id: getAccount()!.id, nickname: getAccount()!.nickname, status: getAccount()!.status } : null,
    sync: q.all("SELECT resource, status, last_run_at, last_success_at, message, processed FROM sync_state ORDER BY resource"),
    data_gaps: dataGaps(),
    pending_actions: q.get<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE status='pending'")!.n,
    open_alerts: q.get<{ n: number }>("SELECT COUNT(*) n FROM alerts WHERE status='open'")!.n,
  });
});

api.get("/settings", viewer, (_req, res) => res.json({ ...financeDefaults(), stale_days: getSetting("stale_days", 21) }));
api.put(
  "/settings",
  admin,
  ah((req, res) => {
    const body = z.object({
      target_margin_pct: z.number().min(0).max(95).optional(), min_margin_pct: z.number().min(-50).max(95).optional(),
      default_listing_type: z.enum(["gold_special", "gold_pro", "free"]).optional(), monthly_fixed_costs: z.number().min(0).optional(),
      default_tax_rate_pct: z.number().min(0).max(60).optional(), energy_kwh_price: z.number().min(0).optional(),
      labor_cost_per_hour: z.number().min(0).optional(), stale_days: z.number().int().min(3).max(365).optional(),
    }).parse(req.body);
    for (const [k, v] of Object.entries(body)) setSetting(k, v);
    audit(req.user!.id, "settings.update", "settings", null, body, req.ip);
    res.json({ ok: true });
  }),
);

api.get("/audit", admin, (req, res) => {
  res.json(q.all(
    "SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT ? OFFSET ?",
    [Math.min(num(req.query.limit, 200), 1000), num(req.query.offset, 0)],
  ).map((r: any) => ({ ...r, details: json.parse(r.details, null) })));
});
api.get("/logs/api", admin, (_req, res) => res.json(q.all("SELECT * FROM api_logs ORDER BY id DESC LIMIT 300")));
api.get("/backups", admin, (_req, res) => res.json(listBackups()));
api.post("/backups", admin, ah((req, res) => {
  const file = runBackup();
  audit(req.user!.id, "backup.create", "backup", file, null, req.ip);
  res.json({ file });
}));

// ======================================================================
// Sincronização com o Mercado Livre
// ======================================================================
api.post(
  "/sync",
  operator,
  ah(async (req, res) => {
    const body = z.object({ full: z.boolean().optional(), only: z.array(z.string()).optional() }).parse(req.body ?? {});
    audit(req.user!.id, "sync.manual", "sync", null, body, req.ip);
    const results = await runSync(body);
    ensureCategoryNames().catch(() => undefined);
    res.json({ results });
  }),
);

/** Webhook de notificações do ML. Responde 200 imediatamente e processa de forma assíncrona. */
api.post("/ml/notifications", (req, res) => {
  const b = req.body ?? {};
  const acc = getAccount();
  res.status(200).end();
  if (!acc || String(b.user_id) !== String(acc.id) || (config.ml.clientId && b.application_id && String(b.application_id) !== config.ml.clientId)) return;
  const r = q.run("INSERT INTO ml_notifications (topic, resource, user_id, application_id) VALUES (?,?,?,?)", [b.topic, b.resource, b.user_id, String(b.application_id ?? "")]);
  const id = Number(r.lastInsertRowid);
  processNotification(String(b.topic), String(b.resource))
    .then(() => q.run("UPDATE ml_notifications SET processed_at=? WHERE id=?", [new Date().toISOString(), id]))
    .catch((e) => {
      q.run("UPDATE ml_notifications SET error=? WHERE id=?", [(e as Error).message, id]);
      logger.warn("notification_failed", { topic: b.topic, error: e });
    });
});

// ======================================================================
// Dashboard
// ======================================================================
api.get("/dashboard", viewer, ah((req, res) => {
  const { period = "30d", from, to } = req.query as Record<string, string>;
  try {
    res.json(dashboard(period, from, to));
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}));

// ======================================================================
// Anúncios e produtos
// ======================================================================
api.get("/listings", viewer, (req, res) => {
  const { status, search } = req.query as Record<string, string>;
  const where: string[] = [];
  const params: any[] = [];
  if (status && status !== "all") { where.push("l.status = ?"); params.push(status); }
  if (search) { where.push("(l.title LIKE ? OR l.id LIKE ? OR l.sku LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  res.json(q.all(
    `SELECT l.id, l.title, l.status, l.sub_status, l.price, l.original_price, l.available_quantity, l.sold_quantity, l.listing_type_id, l.permalink,
       l.thumbnail, l.health, l.sku, l.free_shipping, l.logistic_type, l.category_id, c.name category_name, l.last_updated, l.product_id,
       p.stock_qty, p.min_stock, p.made_to_order, (pc.product_id IS NOT NULL) has_costs,
       COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.listing_id=l.id AND o.status='paid' AND o.date_created >= ?),0) units_30d,
       (SELECT SUM(visits) FROM visits_daily v WHERE v.scope=l.id) visits_30d
     FROM listings l LEFT JOIN products p ON p.id=l.product_id LEFT JOIN product_costs pc ON pc.product_id=l.product_id LEFT JOIN categories c ON c.id=l.category_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY CASE l.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, units_30d DESC, l.sold_quantity DESC`,
    [since30, ...params],
  ).map((r: any) => ({ ...r, sub_status: json.parse(r.sub_status, []) })));
});

api.get("/listings/:id", viewer, ah(async (req, res) => {
  const l = q.get<any>("SELECT * FROM listings WHERE id=?", [String(req.params.id)]);
  if (!l) throw new HttpError(404, "Anúncio não encontrado");
  const sales = q.all(
    `SELECT date(datetime(o.date_created, '-180 minutes')) date, SUM(oi.quantity) units, SUM(oi.quantity*oi.unit_price) revenue
     FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.listing_id=? AND o.status='paid' AND o.date_created >= ? GROUP BY 1 ORDER BY 1`,
    [l.id, new Date(Date.now() - 90 * 86_400_000).toISOString()],
  );
  const visits = q.all("SELECT date, visits FROM visits_daily WHERE scope=? ORDER BY date", [l.id]);
  const raw = json.parse<any>(l.raw, {});
  res.json({ ...l, raw: undefined, pictures: (raw.pictures ?? []).map((p: any) => p.secure_url ?? p.url), attributes: raw.attributes ?? [], sales, visits });
}));

api.get("/products", viewer, (_req, res) => {
  res.json(q.all(
    `SELECT p.*, (SELECT GROUP_CONCAT(id) FROM listings WHERE product_id=p.id) listing_ids,
       (SELECT thumbnail FROM listings WHERE product_id=p.id LIMIT 1) thumbnail, (pc.product_id IS NOT NULL) has_costs
     FROM products p LEFT JOIN product_costs pc ON pc.product_id=p.id ORDER BY p.name`,
  ));
});

api.patch("/products/:id", operator, ah((req, res) => {
  const body = z.object({
    name: z.string().min(1).max(200).optional(), sku: z.string().max(60).nullable().optional(), category: z.string().max(100).nullable().optional(),
    made_to_order: z.boolean().optional(), min_stock: z.number().int().min(0).optional(), lead_time_days: z.number().int().min(0).max(120).optional(), notes: z.string().max(2000).nullable().optional(),
  }).parse(req.body);
  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (!sets.length) return res.json({ ok: true });
  q.run(`UPDATE products SET ${sets.join(", ")}, updated_at=? WHERE id=?`, [...Object.values(body).map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)) as any[], new Date().toISOString(), Number(req.params.id)]);
  audit(req.user!.id, "product.update", "product", req.params.id as string, body, req.ip);
  res.json({ ok: true });
}));

/** Vincula um anúncio a outro produto (útil quando o mesmo produto tem vários anúncios). */
api.post("/listings/:id/link", operator, ah((req, res) => {
  const { product_id } = z.object({ product_id: z.number().int() }).parse(req.body);
  q.run("UPDATE listings SET product_id=? WHERE id=?", [product_id, req.params.id as string]);
  audit(req.user!.id, "listing.link_product", "listing", req.params.id as string, { product_id }, req.ip);
  res.json({ ok: true });
}));

// ======================================================================
// Financeiro
// ======================================================================
const costSchema = z.object({
  material_cost: z.number().min(0), manufacturing_cost: z.number().min(0), energy_cost: z.number().min(0), production_minutes: z.number().min(0),
  labor_cost_per_hour: z.number().min(0), packaging_cost: z.number().min(0), operational_cost: z.number().min(0), shipping_cost_seller: z.number().min(0),
  ads_cost_per_unit: z.number().min(0), tax_rate_pct: z.number().min(0).max(80), other_cost: z.number().min(0),
});

api.get("/products/:id/costs", viewer, (req, res) => {
  const costs = getProductCosts(Number(req.params.id));
  res.json({ costs: costs ?? { ...emptyCosts(), tax_rate_pct: financeDefaults().default_tax_rate_pct, labor_cost_per_hour: financeDefaults().labor_cost_per_hour }, exists: !!costs });
});

api.put("/products/:id/costs", operator, ah((req, res) => {
  const c = costSchema.parse(req.body);
  const id = Number(req.params.id);
  if (!q.get("SELECT 1 FROM products WHERE id=?", [id])) throw new HttpError(404, "Produto não encontrado");
  const cols = Object.keys(c);
  q.run(
    `INSERT INTO product_costs (product_id, ${cols.join(",")}, updated_at) VALUES (?, ${cols.map(() => "?").join(",")}, ?)
     ON CONFLICT(product_id) DO UPDATE SET ${cols.map((k) => `${k}=excluded.${k}`).join(",")}, updated_at=excluded.updated_at`,
    [id, ...Object.values(c), new Date().toISOString()],
  );
  audit(req.user!.id, "product.costs_update", "product", id, c, req.ip);
  res.json({ ok: true, production_cost: productionCost(c) });
}));

/** Tarifa oficial do ML para um preço/categoria. */
api.get("/finance/fee", viewer, ah(async (req, res) => {
  const { price, category_id, listing_type_id } = req.query as Record<string, string>;
  res.json(await fetchFee(Number(price), category_id || undefined, listing_type_id || "gold_special"));
}));

/** Calculadora: simula vários preços e calcula preço mínimo e recomendado. */
api.post("/finance/simulate", viewer, ah(async (req, res) => {
  const body = z.object({
    costs: costSchema,
    prices: z.array(z.number().positive()).max(20).default([]),
    target_margin_pct: z.number().min(0).max(90).default(financeDefaults().target_margin_pct),
    category_id: z.string().optional(),
    listing_type_id: z.string().default("gold_special"),
    manual_fee: z.object({ percentage: z.number().min(0).max(1), fixed: z.number().min(0) }).optional(),
    monthly_fixed: z.number().min(0).optional(),
  }).parse(req.body);
  const feeFor = async (price: number): Promise<FeeInfo> =>
    body.manual_fee ? { ...body.manual_fee, source: "manual" } : fetchFee(price, body.category_id, body.listing_type_id);
  let recommended: { price: number | null; fee: FeeInfo; simulation: ReturnType<typeof simulate> | null };
  if (body.manual_fee) {
    const fee: FeeInfo = { ...body.manual_fee, source: "manual" };
    const p = priceForMargin(body.target_margin_pct, body.costs, fee);
    recommended = { price: p, fee, simulation: p ? simulate(p, body.costs, fee) : null };
  } else {
    recommended = await recommendPrice(body.costs, body.category_id, body.listing_type_id, body.target_margin_pct);
  }
  const sims = [];
  for (const p of body.prices) sims.push(simulate(p, body.costs, await feeFor(p)));
  const monthly = body.monthly_fixed ?? financeDefaults().monthly_fixed_costs;
  res.json({
    production_cost: productionCost(body.costs),
    recommended,
    min_price: recommended.simulation?.min_price ?? null,
    break_even_units_month: recommended.simulation ? breakEvenUnits(monthly, recommended.simulation) : null,
    monthly_fixed: monthly,
    simulations: sims,
  });
}));

api.get("/finance/profitability", viewer, ah((req, res) => {
  const { period = "30d", from, to } = req.query as Record<string, string>;
  const range = resolvePeriod(period, from, to);
  const rows = profitByListing(range);
  const sum = (k: "revenue" | "sale_fees" | "shipping" | "taxes" | "ads") => rows.reduce((s, r) => s + r[k], 0);
  const known = rows.filter((r) => r.cost_known);
  res.json({
    range,
    totals: {
      revenue: sum("revenue"), sale_fees: sum("sale_fees"), shipping: sum("shipping"), taxes: sum("taxes"), ads: sum("ads"),
      production_cost: known.reduce((s, r) => s + (r.production_cost ?? 0), 0), profit: known.reduce((s, r) => s + (r.profit ?? 0), 0),
      revenue_with_costs: known.reduce((s, r) => s + r.revenue, 0), products_without_costs: rows.length - known.length,
    },
    rows,
  });
}));

// ======================================================================
// Estoque e produção
// ======================================================================
api.get("/inventory", viewer, (_req, res) => {
  res.json({ plan: productionPlan(), turnover: stockTurnover(30) });
});
api.get("/inventory/movements", viewer, (req, res) => {
  const pid = req.query.product_id ? Number(req.query.product_id) : null;
  res.json(q.all(
    `SELECT m.*, p.name product_name, u.name user_name FROM stock_movements m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.created_by
     ${pid ? "WHERE m.product_id = ?" : ""} ORDER BY m.id DESC LIMIT 500`,
    pid ? [pid] : [],
  ));
});

// ======================================================================
// Pedidos, envios e perguntas
// ======================================================================
api.get("/orders", viewer, ah((req, res) => {
  const { period = "30d", from, to, status, shipping, search } = req.query as Record<string, string>;
  const range = resolvePeriod(period, from, to);
  const where = ["o.date_created >= ?", "o.date_created < ?"];
  const params: any[] = [range.fromUtc, range.toUtc];
  if (status && status !== "all") { where.push("o.status = ?"); params.push(status); }
  if (shipping && shipping !== "all") { where.push("s.status = ?"); params.push(shipping); }
  if (search) { where.push("(CAST(o.id AS TEXT) LIKE ? OR o.buyer_nickname LIKE ? OR EXISTS (SELECT 1 FROM order_items x WHERE x.order_id=o.id AND x.title LIKE ?))"); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const rows = q.all<any>(
    `SELECT o.id, o.status, o.payment_status, o.date_created, o.total_amount, o.buyer_nickname, o.pack_id, o.tags,
       s.id shipment_id, s.status ship_status, s.substatus ship_substatus, s.tracking_number, s.tracking_method, s.handling_limit, s.delivery_estimate, s.logistic_type, s.seller_cost
     FROM orders o LEFT JOIN shipments s ON s.id=o.shipping_id WHERE ${where.join(" AND ")} ORDER BY o.date_created DESC LIMIT 1000`,
    params,
  );
  const items = rows.length
    ? q.all<any>(`SELECT order_id, listing_id, title, quantity, unit_price, sale_fee FROM order_items WHERE order_id IN (${rows.map(() => "?").join(",")})`, rows.map((r) => r.id))
    : [];
  const now = Date.now();
  res.json(rows.map((r) => {
    const its = items.filter((i) => i.order_id === r.id);
    const attention: string[] = [];
    if (r.status === "paid" && ["ready_to_ship", "handling"].includes(r.ship_status) && r.handling_limit) {
      const h = (Date.parse(r.handling_limit) - now) / 3_600_000;
      if (h < 0) attention.push("Postagem atrasada");
      else if (h < 24) attention.push("Postar em menos de 24h");
    }
    if (r.payment_status === "pending") attention.push("Pagamento pendente");
    if (r.ship_status === "not_delivered" || r.ship_substatus === "returning_to_sender") attention.push("Problema na entrega");
    return { ...r, tags: json.parse(r.tags, []), items: its, attention };
  }));
}));

api.get("/questions", viewer, (req, res) => {
  const status = (req.query.status as string) || "UNANSWERED";
  res.json(q.all(
    `SELECT qq.id, qq.listing_id, qq.text, qq.status, qq.date_created, qq.answer_text, qq.answer_date, l.title, l.thumbnail, l.permalink
     FROM questions qq LEFT JOIN listings l ON l.id=qq.listing_id ${status === "all" ? "" : "WHERE qq.status = ?"} ORDER BY qq.date_created DESC LIMIT 300`,
    status === "all" ? [] : [status],
  ));
});

/** IA sugere resposta (rascunho); o envio exige aprovação. */
api.post("/questions/:id/suggest", operator, ah(async (req, res) => {
  const qq = q.get<any>("SELECT qq.*, l.raw FROM questions qq LEFT JOIN listings l ON l.id=qq.listing_id WHERE qq.id=?", [Number(req.params.id)]);
  if (!qq) throw new HttpError(404, "Pergunta não encontrada");
  const item = json.parse<any>(qq.raw, {});
  const msg = await ai().beta.messages.create({
    ...common(),
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: "Você responde perguntas de compradores do Mercado Livre em nome de uma loja. Seja cordial, objetivo e responda apenas com base nos dados do anúncio. Se a informação não estiver nos dados, diga que vai verificar e não invente. Não inclua contatos externos, links ou pedidos para negociar fora do Mercado Livre. Máximo 350 caracteres. Responda só com o texto da resposta.",
    messages: [{ role: "user", content: `Anúncio: ${JSON.stringify({ title: item.title, price: item.price, attributes: (item.attributes ?? []).map((a: any) => `${a.name}: ${a.value_name}`), available_quantity: item.available_quantity, shipping: item.shipping?.free_shipping ? "frete grátis" : undefined })}\n\nPergunta do comprador: ${qq.text}` }],
  });
  checkStop(msg);
  res.json({ suggestion: textOf(msg.content) });
}));

// ======================================================================
// Publicidade
// ======================================================================
api.get("/ads", viewer, (_req, res) => res.json(adsOverview()));

// ======================================================================
// Central de aprovações
// ======================================================================
api.get("/actions", viewer, (req, res) => {
  const status = (req.query.status as string) || "pending";
  res.json(q.all(
    `SELECT a.*, u.name created_by_name, d.name decided_by_name FROM actions a LEFT JOIN users u ON u.id=a.created_by LEFT JOIN users d ON d.id=a.decided_by
     ${status === "all" ? "" : "WHERE a.status = ?"} ORDER BY a.id DESC LIMIT 300`,
    status === "all" ? [] : [status],
  ).map((a: any) => ({ ...a, payload: json.parse(a.payload, {}), result: json.parse(a.result, null) })));
});

api.post("/actions", operator, ah(async (req, res) => {
  const body = z.object({ type: z.enum(Object.keys(actionSchemas) as [ActionType, ...ActionType[]]), payload: z.unknown(), rationale: z.string().max(4000).optional(), source: z.enum(["user", "ai"]).optional() }).parse(req.body);
  if (body.type === "update_price") {
    const p = body.payload as any;
    const item = await refreshListing(p.listing_id).catch(() => null);
    if (item) p.current_price = item.price;
  }
  const id = createAction(body.type, body.payload, { userId: req.user!.id, rationale: body.rationale, source: body.source });
  res.json({ id });
}));

api.post("/actions/:id/approve", admin, ah(async (req, res) => {
  const { confirm } = z.object({ confirm: z.literal(true) }).parse(req.body);
  void confirm;
  res.json(await approveAction(Number(req.params.id), req.user!.id));
}));
api.post("/actions/:id/reject", admin, ah((req, res) => {
  const { reason } = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});
  rejectAction(Number(req.params.id), req.user!.id, reason);
  res.json({ ok: true });
}));

// ======================================================================
// Alertas
// ======================================================================
api.get("/alerts", viewer, (req, res) => res.json(listAlerts(req.query.status as string | undefined)));
api.post("/alerts/evaluate", operator, ah((_req, res) => { evaluateAlerts(); res.json({ ok: true }); }));
api.patch("/alerts/:id", operator, ah((req, res) => {
  const { status } = z.object({ status: z.enum(["open", "read", "resolved"]) }).parse(req.body);
  q.run("UPDATE alerts SET status=?, updated_at=? WHERE id=?", [status, new Date().toISOString(), Number(req.params.id)]);
  res.json({ ok: true });
}));
api.post("/alerts/read-all", operator, (_req, res) => { q.run("UPDATE alerts SET status='read' WHERE status='open'"); res.json({ ok: true }); });
api.get("/notification-channels", admin, (_req, res) => res.json(q.all("SELECT * FROM notification_channels")));
api.post("/notification-channels", admin, ah((req, res) => {
  const b = z.object({ type: z.enum(["email", "whatsapp", "webhook"]), target: z.string().min(3).max(200), min_severity: z.enum(["info", "opportunity", "warning", "critical"]), enabled: z.boolean() }).parse(req.body);
  const r = q.run("INSERT INTO notification_channels (type, target, min_severity, enabled) VALUES (?,?,?,?)", [b.type, b.target, b.min_severity, b.enabled ? 1 : 0]);
  audit(req.user!.id, "notification_channel.create", "notification_channel", Number(r.lastInsertRowid), b, req.ip);
  res.json({ id: Number(r.lastInsertRowid), note: "Canal registrado. Os alertas são enfileirados em notification_outbox; o envio requer configurar o provedor (ver docs)." });
}));

// ======================================================================
// IA — Gerente da loja
// ======================================================================
api.post("/ai/ask", viewer, ah(async (req, res) => {
  const body = z.object({ question: z.string().min(2).max(4000), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20000) })).max(20).default([]) }).parse(req.body);
  res.json(await askManager(body.question, body.history, req.user!.id));
}));
api.get("/ai/daily-report", viewer, (_req, res) => res.json(latestDailyReport()));
api.post("/ai/daily-report", operator, ah(async (req, res) => {
  const r = await generateDailyReport(req.user!.id);
  audit(req.user!.id, "ai.daily_report", "ai_report", r.id, null, req.ip);
  res.json(r);
}));
api.get("/ai/history", viewer, (req, res) => {
  res.json(q.all("SELECT id, kind, created_at, question, content FROM ai_reports WHERE kind='chat' AND created_by=? ORDER BY id DESC LIMIT 30", [req.user!.id]));
});

// ======================================================================
// Central de criação de anúncios
// ======================================================================
const uploadDir = path.join(config.dataDir, "uploads");
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomToken(8)}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".jpg"}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});

api.get("/uploads/:file", viewer, (req, res) => {
  const f = path.join(uploadDir, path.basename(req.params.file as string));
  if (!fs.existsSync(f)) throw new HttpError(404, "Arquivo não encontrado");
  res.sendFile(f);
});

const inputSchema = z.object({
  name: z.string().max(200).optional(), material: z.string().max(200).optional(), dimensions: z.string().max(200).optional(),
  weight_g: z.number().min(0).optional(), features: z.string().max(3000).optional(), category_hint: z.string().max(200).optional(),
  quantity: z.number().int().min(0).optional(), package_contents: z.string().max(500).optional(), usage: z.string().max(1000).optional(),
  manufacturing_cost: z.number().min(0).optional(), packaging_cost: z.number().min(0).optional(), material_cost: z.number().min(0).optional(),
  production_minutes: z.number().min(0).optional(),
});

api.get("/drafts", viewer, (_req, res) => {
  res.json(q.all("SELECT id, status, input, images, final, ml_item_id, permalink, ml_status, error, created_at, updated_at FROM listing_drafts ORDER BY id DESC").map((d: any) => ({
    ...d, input: json.parse(d.input, {}), images: json.parse(d.images, []), final: json.parse(d.final, null),
  })));
});
api.get("/drafts/:id", viewer, (req, res) => {
  const d = q.get<any>("SELECT * FROM listing_drafts WHERE id=?", [Number(req.params.id)]);
  if (!d) throw new HttpError(404, "Rascunho não encontrado");
  res.json({ ...d, input: json.parse(d.input, {}), images: json.parse(d.images, []), ai_output: json.parse(d.ai_output, null), final: json.parse(d.final, null) });
});

api.post("/drafts", operator, upload.array("images", 12), ah((req, res) => {
  const input = inputSchema.parse(json.parse(req.body.input, {}));
  const files = ((req.files as Express.Multer.File[]) ?? []).map((f) => f.filename);
  if (!files.length && !input.name) throw new HttpError(400, "Envie ao menos uma foto ou o nome do produto");
  const r = q.run("INSERT INTO listing_drafts (input, images, created_by) VALUES (?,?,?)", [JSON.stringify(input), JSON.stringify(files), req.user!.id]);
  audit(req.user!.id, "draft.create", "draft", Number(r.lastInsertRowid), { images: files.length }, req.ip);
  res.json({ id: Number(r.lastInsertRowid) });
}));

api.post("/drafts/:id/images", operator, upload.array("images", 12), ah((req, res) => {
  const id = Number(req.params.id);
  const d = q.get<any>("SELECT images FROM listing_drafts WHERE id=?", [id]);
  if (!d) throw new HttpError(404, "Rascunho não encontrado");
  const images = [...json.parse<string[]>(d.images, []), ...((req.files as Express.Multer.File[]) ?? []).map((f) => f.filename)].slice(0, 12);
  q.run("UPDATE listing_drafts SET images=?, updated_at=? WHERE id=?", [JSON.stringify(images), new Date().toISOString(), id]);
  res.json({ images });
}));

/** Pipeline de IA: identificação visual → categoria oficial → atributos → redação → preço calculado. */
api.post("/drafts/:id/generate", operator, ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = q.get<any>("SELECT * FROM listing_drafts WHERE id=?", [id]);
  if (!d) throw new HttpError(404, "Rascunho não encontrado");
  const input = json.parse<ProductInput & Record<string, any>>(d.input, {});
  const images = json.parse<string[]>(d.images, []);
  const notes: string[] = [];

  const identification = images.length || input.name ? await identifyProduct(input, images) : null;
  const searchTerm = input.name || identification?.termo_busca_categoria || "";

  let categories: Awaited<ReturnType<typeof predictCategory>> = [];
  let category: Awaited<ReturnType<typeof categoryInfo>> | null = null;
  let attributes: Awaited<ReturnType<typeof categoryAttributes>> = [];
  let marketTitles: string[] = [];
  let marketStats = null;
  if (getAccount()) {
    try {
      categories = await predictCategory(`${searchTerm} ${input.category_hint ?? ""}`.trim());
      if (categories[0]) {
        category = await categoryInfo(categories[0].category_id);
        attributes = await categoryAttributes(category.id);
      }
    } catch (e) { notes.push(`Categoria/atributos indisponíveis: ${(e as Error).message}`); }
    try {
      const m = await research(searchTerm, req.user!.id);
      marketTitles = m.items.map((i) => i.title);
      marketStats = { ...m.stats, limitations: m.limitations, research_id: m.id };
    } catch (e) { notes.push(`Pesquisa de concorrência indisponível: ${(e as Error).message}`); }
  } else {
    notes.push("Mercado Livre não conectado: categoria, atributos obrigatórios, tarifas e concorrência não puderam ser consultados.");
  }

  const comp = await composeListing({ input, images, identification, category, attributes, marketTitles });

  // Preço sugerido calculado (não inventado pela IA): custos informados + tarifa oficial + margem-alvo
  const defaults = financeDefaults();
  const costs: CostProfile = {
    ...emptyCosts(),
    material_cost: input.material_cost ?? 0, manufacturing_cost: input.manufacturing_cost ?? 0, packaging_cost: input.packaging_cost ?? 0,
    production_minutes: input.production_minutes ?? 0, labor_cost_per_hour: defaults.labor_cost_per_hour, tax_rate_pct: defaults.default_tax_rate_pct,
  };
  let pricing: any = null;
  if (productionCost(costs) > 0 && category && getAccount()) {
    try {
      pricing = await recommendPrice(costs, category.id, defaults.default_listing_type, defaults.target_margin_pct);
    } catch (e) { notes.push(`Cálculo de preço indisponível: ${(e as Error).message}`); }
  } else if (productionCost(costs) <= 0) {
    notes.push("Informe custos de fabricação/embalagem para obter um preço sugerido calculado.");
  }

  const aiOutput = { identification, categories, category, attributes_meta: attributes, composition: comp, pricing, market: marketStats, notes, generated_at: new Date().toISOString() };
  const attrMeta = new Map(attributes.map((a) => [a.id, a]));
  const final: DraftFinal = {
    title: comp.titulo,
    category_id: category?.id ?? "",
    price: pricing?.price ?? marketStats?.price_median ?? 0,
    available_quantity: input.quantity ?? 1,
    listing_type_id: defaults.default_listing_type,
    condition: "new",
    description: comp.descricao,
    sku: comp.sku_sugerido,
    attributes: comp.atributos.filter((a) => a.valor).map((a) => {
      const meta = attrMeta.get(a.id);
      const match = meta?.values.find((v: { id: string; name: string }) => v.name.toLowerCase() === a.valor.toLowerCase());
      return match ? { id: a.id, value_id: match.id, value_name: match.name } : { id: a.id, value_name: a.valor };
    }),
    free_shipping: undefined,
  };
  q.run("UPDATE listing_drafts SET ai_output=?, final=?, updated_at=? WHERE id=?", [JSON.stringify(aiOutput), JSON.stringify(final), new Date().toISOString(), id]);
  audit(req.user!.id, "draft.ai_generate", "draft", id, { category: category?.id }, req.ip);
  res.json({ ai_output: aiOutput, final });
}));

api.put("/drafts/:id", operator, ah((req, res) => {
  const id = Number(req.params.id);
  const final = z.object({
    title: z.string().min(1).max(120), category_id: z.string(), price: z.number().min(0), available_quantity: z.number().int().min(0),
    listing_type_id: z.string(), condition: z.enum(["new", "used"]), description: z.string().max(50000), sku: z.string().max(60).optional(),
    family_name: z.string().max(120).optional(), free_shipping: z.boolean().optional(), warranty_type: z.string().optional(), warranty_time: z.string().optional(),
    attributes: z.array(z.object({ id: z.string(), value_name: z.string().optional(), value_id: z.string().optional() })),
    image_order: z.array(z.string()).optional(),
  }).parse(req.body);
  const d = q.get<any>("SELECT status FROM listing_drafts WHERE id=?", [id]);
  if (!d) throw new HttpError(404, "Rascunho não encontrado");
  if (["published", "publishing"].includes(d.status)) throw new HttpError(409, "Rascunho já publicado não pode ser editado");
  q.run("UPDATE listing_drafts SET final=?, status=CASE WHEN status='failed' THEN 'draft' ELSE status END, updated_at=? WHERE id=?", [JSON.stringify(final), new Date().toISOString(), id]);
  audit(req.user!.id, "draft.edit", "draft", id, null, req.ip);
  res.json({ ok: true });
}));

api.post("/drafts/:id/validate", operator, ah(async (req, res) => res.json(await validateDraft(Number(req.params.id)))));

/** Solicita publicação: cria ação pendente. A publicação só ocorre após aprovação explícita. */
api.post("/drafts/:id/request-publish", operator, ah((req, res) => {
  const id = Number(req.params.id);
  const actionId = createAction("publish_listing", { draft_id: id }, { userId: req.user!.id });
  res.json({ action_id: actionId });
}));

api.delete("/drafts/:id", operator, ah((req, res) => {
  const id = Number(req.params.id);
  const d = q.get<any>("SELECT status FROM listing_drafts WHERE id=?", [id]);
  if (d?.status === "published") throw new HttpError(409, "Rascunhos publicados são mantidos como histórico");
  q.run("UPDATE actions SET status='rejected', error='Rascunho excluído' WHERE type='publish_listing' AND status='pending' AND json_extract(payload,'$.draft_id')=?", [id]);
  q.run("DELETE FROM listing_drafts WHERE id=?", [id]);
  audit(req.user!.id, "draft.delete", "draft", id, null, req.ip);
  res.json({ ok: true });
}));

api.get("/ml/categories/predict", viewer, ah(async (req, res) => res.json(await predictCategory(String(req.query.q ?? "")))));
api.get("/ml/categories/:id/attributes", viewer, ah(async (req, res) => res.json(await categoryAttributes(req.params.id as string))));
api.get("/ml/categories/:id", viewer, ah(async (req, res) => res.json(await categoryInfo(req.params.id as string))));

// ======================================================================
// Inteligência de mercado
// ======================================================================
api.post("/market/research", operator, ah(async (req, res) => {
  const { query } = z.object({ query: z.string().min(2).max(120) }).parse(req.body);
  if (!getAccount()) throw new IntegrationUnavailable("Conecte o Mercado Livre para pesquisar o mercado com dados oficiais.");
  res.json(await research(query, req.user!.id));
}));
api.post("/market/discover", operator, ah(async (req, res) => {
  const { queries } = z.object({ queries: z.array(z.string().min(2).max(120)).max(15).optional() }).parse(req.body ?? {});
  if (!getAccount()) throw new IntegrationUnavailable("Conecte o Mercado Livre para pesquisar o mercado com dados oficiais.");
  const ids: number[] = [];
  const errors: string[] = [];
  for (const term of queries?.length ? queries : DEFAULT_3D_SEEDS) {
    try { ids.push((await research(term, req.user!.id)).id); } catch (e) { errors.push(`${term}: ${(e as Error).message}`); }
  }
  res.json({ research_ids: ids, errors });
}));
api.get("/market/research", viewer, (_req, res) => {
  res.json(q.all("SELECT id, query, category_id, created_at, data, limitations FROM market_research ORDER BY id DESC LIMIT 50").map((r: any) => {
    const d = json.parse<any>(r.data, {});
    return { id: r.id, query: r.query, created_at: r.created_at, category: d.category, stats: d.stats, total_results: d.total_results, trends: d.trends, items: d.items, source: d.source, limitations: json.parse(r.limitations, []) };
  }));
});
api.post("/market/opportunities", operator, ah(async (req, res) => {
  const b = z.object({ research_ids: z.array(z.number().int()).default([]), context: z.string().max(1000).default("") }).parse(req.body ?? {});
  try {
    res.json(await generateOpportunities(b.research_ids, b.context));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, (e as Error).message);
  }
}));
api.get("/market/opportunities", viewer, (_req, res) => {
  res.json(q.all("SELECT * FROM opportunities ORDER BY CASE potential WHEN 'alto' THEN 0 WHEN 'médio' THEN 1 ELSE 2 END, margin_pct DESC, id DESC").map((o: any) => ({ ...o, evidence: json.parse(o.evidence, {}) })));
});
api.patch("/market/opportunities/:id", operator, ah((req, res) => {
  const { status } = z.object({ status: z.enum(["new", "watching", "planned", "discarded"]) }).parse(req.body);
  q.run("UPDATE opportunities SET status=? WHERE id=?", [status, Number(req.params.id)]);
  res.json({ ok: true });
}));
api.get("/market/trends", viewer, ah(async (req, res) => res.json(await siteTrends((req.query.category as string) || undefined))));

// ======================================================================
// Relatórios e exportações
// ======================================================================
api.get("/reports", viewer, (_req, res) => res.json(REPORTS));
api.get("/reports/:key", viewer, ah(async (req, res) => {
  const key = req.params.key as ReportKey;
  if (!(key in REPORTS)) throw new HttpError(404, "Relatório inexistente");
  const { period = "30d", from, to, format = "json" } = req.query as Record<string, string>;
  const report = buildReport(key, resolvePeriod(period, from, to));
  const fname = `${key}-${localDate(new Date())}`;
  audit(req.user!.id, "report.export", "report", key, { period, format }, req.ip);
  if (format === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}.xlsx"`);
    return res.send(await toExcel(report));
  }
  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}.pdf"`);
    return res.send(await toPdf(report));
  }
  res.json(report);
}));

// ======================================================================
// Busca global
// ======================================================================
api.get("/search", viewer, (req, res) => {
  const s = `%${String(req.query.q ?? "").trim()}%`;
  if (s.length < 4) return res.json([]);
  const out = [
    ...q.all("SELECT 'listing' type, id, title label, status extra FROM listings WHERE title LIKE ? OR id LIKE ? OR sku LIKE ? LIMIT 8", [s, s, s]),
    ...q.all("SELECT 'order' type, CAST(id AS TEXT) id, 'Pedido ' || id label, status extra FROM orders WHERE CAST(id AS TEXT) LIKE ? OR buyer_nickname LIKE ? LIMIT 5", [s, s]),
    ...q.all("SELECT 'product' type, CAST(id AS TEXT) id, name label, sku extra FROM products WHERE name LIKE ? OR sku LIKE ? LIMIT 5", [s, s]),
    ...q.all("SELECT 'draft' type, CAST(id AS TEXT) id, COALESCE(json_extract(final,'$.title'), json_extract(input,'$.name'), 'Rascunho ' || id) label, status extra FROM listing_drafts WHERE final LIKE ? OR input LIKE ? LIMIT 5", [s, s]),
  ];
  res.json(out);
});
