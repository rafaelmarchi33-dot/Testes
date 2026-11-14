import { q } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";
import { addDays, localDate } from "../lib/dates.ts";

export type MovementType = "in" | "out" | "adjust" | "sale" | "sale_reversal" | "production";

/**
 * Registra uma movimentação e atualiza o saldo atomicamente.
 * Com `ref`, a movimentação é idempotente (mesmo produto+tipo+ref não é aplicado duas vezes).
 * Retorna false se já existia.
 */
export function recordMovement(productId: number, type: MovementType, qty: number, opts: { reason?: string; ref?: string; userId?: number } = {}): boolean {
  if (!Number.isInteger(qty) || qty === 0) throw new HttpError(400, "Quantidade deve ser um inteiro diferente de zero");
  const signed = type === "out" || type === "sale" ? -Math.abs(qty) : type === "adjust" ? qty : Math.abs(qty);
  return q.tx(() => {
    if (opts.ref && q.get("SELECT 1 FROM stock_movements WHERE product_id=? AND type=? AND ref=?", [productId, type, opts.ref])) return false;
    q.run("INSERT INTO stock_movements (product_id, type, qty, reason, ref, created_by) VALUES (?,?,?,?,?,?)", [
      productId, type, signed, opts.reason ?? null, opts.ref ?? null, opts.userId ?? null,
    ]);
    q.run("UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?", [signed, new Date().toISOString(), productId]);
    return true;
  });
}

/**
 * Baixa automática por venda confirmada (pedido pago) e estorno em cancelamento.
 * Idempotente por pedido+anúncio. Produtos sob demanda não têm saldo físico baixado.
 */
export function applyOrderStock(orderId: number, status: string, items: { listing_id: string; variation_id: string; quantity: number }[]) {
  for (const it of items) {
    const p = q.get<{ id: number; made_to_order: number }>(
      "SELECT p.id, p.made_to_order FROM listings l JOIN products p ON p.id = l.product_id WHERE l.id = ?",
      [it.listing_id],
    );
    if (!p || p.made_to_order) continue;
    const ref = `order:${orderId}:${it.listing_id}:${it.variation_id}`;
    if (status === "paid") {
      recordMovement(p.id, "sale", it.quantity, { ref, reason: `Venda ${orderId}` });
    } else if (status === "cancelled") {
      const sold = q.get("SELECT 1 FROM stock_movements WHERE product_id=? AND type='sale' AND ref=?", [p.id, ref]);
      if (sold) recordMovement(p.id, "sale_reversal", it.quantity, { ref, reason: `Cancelamento ${orderId}` });
    }
  }
}

export interface ProductionPlanRow {
  product_id: number;
  name: string;
  sku: string | null;
  made_to_order: boolean;
  stock: number;
  min_stock: number;
  units_30d: number;
  daily_velocity: number;
  days_of_cover: number | null;
  lead_time_days: number;
  suggested_production: number;
  priority: "urgente" | "alta" | "normal" | "baixa";
  reason: string;
  last_sale: string | null;
}

/**
 * Planejamento de produção baseado em velocidade de vendas (30 dias),
 * estoque atual, estoque mínimo e prazo de produção. Alvo: cobrir lead time + 14 dias.
 */
export function productionPlan(now = new Date(), coverDays = 14): ProductionPlanRow[] {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const rows = q.all<any>(
    `SELECT p.id, p.name, p.sku, p.made_to_order, p.stock_qty, p.min_stock, p.lead_time_days,
       COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN listings l ON l.id = oi.listing_id
                 WHERE l.product_id = p.id AND o.status = 'paid' AND o.date_created >= ?), 0) AS units_30d,
       (SELECT MAX(o.date_created) FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN listings l ON l.id = oi.listing_id
                 WHERE l.product_id = p.id AND o.status = 'paid') AS last_sale
     FROM products p ORDER BY p.name`,
    [since],
  );
  return rows.map((r) => {
    const velocity = r.units_30d / 30;
    const cover = velocity > 0 ? r.stock_qty / velocity : null;
    const target = Math.ceil(velocity * (r.lead_time_days + coverDays));
    let suggested = r.made_to_order ? 0 : Math.max(0, Math.max(target, r.min_stock) - r.stock_qty);
    let priority: ProductionPlanRow["priority"] = "baixa";
    let reason = "Estoque suficiente para o ritmo atual de vendas.";
    if (r.made_to_order) {
      reason = "Produto sob demanda: produção acontece a cada pedido.";
      suggested = 0;
    } else if (r.stock_qty <= 0 && velocity > 0) {
      priority = "urgente";
      reason = "Sem estoque e com vendas recentes.";
    } else if (cover !== null && cover <= r.lead_time_days) {
      priority = "urgente";
      reason = `Estoque cobre ${cover.toFixed(1)} dias, menos que o prazo de produção (${r.lead_time_days} dias).`;
    } else if (r.stock_qty <= r.min_stock) {
      priority = "alta";
      reason = `Estoque (${r.stock_qty}) no mínimo definido (${r.min_stock}) ou abaixo.`;
    } else if (cover !== null && cover <= r.lead_time_days + coverDays) {
      priority = "normal";
      reason = `Estoque cobre ${cover.toFixed(1)} dias; repor para manter ${coverDays} dias de cobertura.`;
    } else if (velocity === 0) {
      reason = "Sem vendas nos últimos 30 dias.";
    }
    return {
      product_id: r.id, name: r.name, sku: r.sku, made_to_order: !!r.made_to_order, stock: r.stock_qty, min_stock: r.min_stock,
      units_30d: r.units_30d, daily_velocity: Number(velocity.toFixed(3)), days_of_cover: cover === null ? null : Number(cover.toFixed(1)),
      lead_time_days: r.lead_time_days, suggested_production: suggested, priority, reason,
      last_sale: r.last_sale ? localDate(r.last_sale) : null,
    };
  }).sort((a, b) => ["urgente", "alta", "normal", "baixa"].indexOf(a.priority) - ["urgente", "alta", "normal", "baixa"].indexOf(b.priority) || b.daily_velocity - a.daily_velocity);
}

/** Giro e produtos parados. */
export function stockTurnover(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return q.all(
    `SELECT p.id, p.name, p.sku, p.stock_qty,
       COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN listings l ON l.id=oi.listing_id
                 WHERE l.product_id=p.id AND o.status='paid' AND o.date_created >= ?),0) AS units,
       (SELECT MAX(o.date_created) FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN listings l ON l.id=oi.listing_id
                 WHERE l.product_id=p.id AND o.status='paid') AS last_sale
     FROM products p ORDER BY units DESC`,
    [since],
  ).map((r: any) => ({
    ...r,
    turnover: r.stock_qty > 0 ? Number((r.units / r.stock_qty).toFixed(2)) : null,
    days_without_sale: r.last_sale ? Math.floor((Date.now() - Date.parse(r.last_sale)) / 86_400_000) : null,
  }));
}

