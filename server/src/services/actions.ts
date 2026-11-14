import { z } from "zod";
import { q, json } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";
import { audit } from "../lib/audit.ts";
import { ml, requireAccount } from "../ml/client.ts";
import { publishDraft } from "../ml/publish.ts";
import { fetchItems, upsertListing, upsertQuestion } from "../ml/sync.ts";
import { recordMovement } from "./inventory.ts";

/**
 * Central de aprovações. Toda operação comercial que altera a loja ou o estoque
 * é registrada como ação PENDENTE e só é executada após aprovação explícita de um administrador.
 */
export const actionSchemas = {
  publish_listing: z.object({ draft_id: z.number().int() }),
  update_price: z.object({ listing_id: z.string(), price: z.number().positive(), current_price: z.number().optional() }),
  update_status: z.object({ listing_id: z.string(), status: z.enum(["active", "paused", "closed"]) }),
  update_ml_stock: z.object({ listing_id: z.string(), available_quantity: z.number().int().min(0) }),
  stock_adjust: z.object({ product_id: z.number().int(), type: z.enum(["in", "out", "adjust", "production"]), qty: z.number().int(), reason: z.string().max(300).optional() }),
  answer_question: z.object({ question_id: z.number().int(), text: z.string().min(2).max(2000) }),
  // Recomendações de publicidade: o sistema nunca altera campanhas sozinho; ao aprovar, a ação fica registrada para execução manual no Mercado Ads.
  ads_recommendation: z.object({ campaign_id: z.string().optional(), recommendation: z.string() }),
} as const;
export type ActionType = keyof typeof actionSchemas;

const titles: Record<ActionType, (p: any) => string> = {
  publish_listing: (p) => `Publicar anúncio do rascunho #${p.draft_id}`,
  update_price: (p) => `Alterar preço de ${p.listing_id} para R$ ${Number(p.price).toFixed(2)}`,
  update_status: (p) => `${p.status === "paused" ? "Pausar" : p.status === "closed" ? "Encerrar" : "Reativar"} anúncio ${p.listing_id}`,
  update_ml_stock: (p) => `Atualizar estoque de ${p.listing_id} no Mercado Livre para ${p.available_quantity}`,
  stock_adjust: (p) => `Movimentar estoque do produto #${p.product_id}: ${p.type} ${p.qty}`,
  answer_question: (p) => `Responder pergunta #${p.question_id}`,
  ads_recommendation: (p) => `Recomendação de publicidade${p.campaign_id ? ` (campanha ${p.campaign_id})` : ""}`,
};

export function createAction(type: ActionType, payload: unknown, opts: { userId?: number; source?: "user" | "ai" | "system"; rationale?: string; title?: string } = {}) {
  const schema = actionSchemas[type];
  if (!schema) throw new HttpError(400, `Tipo de ação desconhecido: ${type}`);
  const data = schema.parse(payload);
  const dup = q.get<{ id: number }>("SELECT id FROM actions WHERE type=? AND payload=? AND status='pending'", [type, JSON.stringify(data)]);
  if (dup) return dup.id;
  const r = q.run("INSERT INTO actions (type, title, payload, source, rationale, created_by) VALUES (?,?,?,?,?,?)", [
    type, opts.title ?? titles[type](data), JSON.stringify(data), opts.source ?? "user", opts.rationale ?? null, opts.userId ?? null,
  ]);
  const id = Number(r.lastInsertRowid);
  if (type === "publish_listing") q.run("UPDATE listing_drafts SET status='pending_approval' WHERE id=? AND status IN ('draft','failed')", [(data as any).draft_id]);
  audit(opts.userId, "action.create", "action", id, { type, payload: data, source: opts.source ?? "user" });
  return id;
}

async function execute(type: ActionType, p: any, userId: number): Promise<unknown> {
  switch (type) {
    case "publish_listing":
      return publishDraft(p.draft_id);
    case "update_price": {
      const r = await ml(`/items/${p.listing_id}`, { method: "PUT", body: { price: p.price }, retries: 0 });
      upsertListing(r, requireAccount().id);
      return { listing_id: p.listing_id, price: r.price };
    }
    case "update_status": {
      const r = await ml(`/items/${p.listing_id}`, { method: "PUT", body: { status: p.status }, retries: 0 });
      upsertListing(r, requireAccount().id);
      return { listing_id: p.listing_id, status: r.status };
    }
    case "update_ml_stock": {
      const r = await ml(`/items/${p.listing_id}`, { method: "PUT", body: { available_quantity: p.available_quantity }, retries: 0 });
      upsertListing(r, requireAccount().id);
      return { listing_id: p.listing_id, available_quantity: r.available_quantity };
    }
    case "stock_adjust": {
      recordMovement(p.product_id, p.type, p.qty, { reason: p.reason, userId });
      return q.get("SELECT id, name, stock_qty FROM products WHERE id=?", [p.product_id]);
    }
    case "answer_question": {
      await ml("/answers", { method: "POST", body: { question_id: p.question_id, text: p.text }, retries: 0 });
      const fresh = await ml(`/questions/${p.question_id}?api_version=4`).catch(() => null);
      if (fresh) upsertQuestion(fresh);
      else q.run("UPDATE questions SET status='ANSWERED', answer_text=?, answer_date=? WHERE id=?", [p.text, new Date().toISOString(), p.question_id]);
      return { question_id: p.question_id };
    }
    case "ads_recommendation":
      return { note: "Recomendação aceita. Aplique o ajuste manualmente no Mercado Ads — o sistema não altera campanhas." };
  }
}

export async function approveAction(id: number, userId: number) {
  const a = q.get<any>("SELECT * FROM actions WHERE id=?", [id]);
  if (!a) throw new HttpError(404, "Ação não encontrada");
  // Transição atômica pending -> approved evita execução dupla.
  const changed = q.run("UPDATE actions SET status='approved', decided_by=?, decided_at=? WHERE id=? AND status='pending'", [userId, new Date().toISOString(), id]);
  if (!changed.changes) throw new HttpError(409, `Ação já está com status "${a.status}"`);
  audit(userId, "action.approve", "action", id, { type: a.type });
  try {
    const result = await execute(a.type, json.parse(a.payload, {}), userId);
    q.run("UPDATE actions SET status='executed', executed_at=?, result=? WHERE id=?", [new Date().toISOString(), json.str(result), id]);
    audit(userId, "action.executed", "action", id, { type: a.type, result });
    return { status: "executed", result };
  } catch (e) {
    q.run("UPDATE actions SET status='failed', error=? WHERE id=?", [(e as Error).message, id]);
    audit(userId, "action.failed", "action", id, { type: a.type, error: (e as Error).message });
    throw e;
  }
}

export function rejectAction(id: number, userId: number, reason?: string) {
  const r = q.run("UPDATE actions SET status='rejected', decided_by=?, decided_at=?, error=? WHERE id=? AND status='pending'", [userId, new Date().toISOString(), reason ?? null, id]);
  if (!r.changes) throw new HttpError(409, "Ação não está pendente");
  const a = q.get<any>("SELECT type, payload FROM actions WHERE id=?", [id])!;
  if (a.type === "publish_listing") q.run("UPDATE listing_drafts SET status='draft' WHERE id=? AND status='pending_approval'", [json.parse<any>(a.payload, {}).draft_id]);
  audit(userId, "action.reject", "action", id, { reason });
}

/** Re-sincroniza um anúncio antes de propor alteração (garante preço atual correto). */
export async function refreshListing(id: string) {
  const [item] = await fetchItems([id]);
  if (item) upsertListing(item, requireAccount().id);
  return item;
}
