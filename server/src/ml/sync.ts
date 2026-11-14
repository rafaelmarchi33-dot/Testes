import { q, json } from "../db/index.ts";
import { logger } from "../lib/logger.ts";
import { ml, requireAccount, chunk, mapLimit, MLApiError } from "./client.ts";
import { applyOrderStock } from "../services/inventory.ts";
import { syncAds } from "./ads.ts";
import { evaluateAlerts } from "../services/alerts.ts";

const now = () => new Date().toISOString();

// ------------------------------------------------------------------
// Estado de sincronização por recurso (com trava contra execução simultânea)
// ------------------------------------------------------------------
function begin(resource: string, accountId: number): boolean {
  const row = q.get<{ status: string; last_run_at: string }>("SELECT status, last_run_at FROM sync_state WHERE resource=? AND account_id=?", [resource, accountId]);
  // Trava expira após 30 min (processo interrompido).
  if (row?.status === "running" && Date.parse(row.last_run_at) > Date.now() - 30 * 60_000) return false;
  q.run(
    `INSERT INTO sync_state (resource, account_id, status, last_run_at) VALUES (?,?, 'running', ?)
     ON CONFLICT(resource, account_id) DO UPDATE SET status='running', last_run_at=excluded.last_run_at, message=NULL`,
    [resource, accountId, now()],
  );
  return true;
}
function finish(resource: string, accountId: number, processed: number, cursor?: string | null) {
  q.run(
    `UPDATE sync_state SET status='ok', last_success_at=?, processed=?, cursor=COALESCE(?, cursor), message=NULL WHERE resource=? AND account_id=?`,
    [now(), processed, cursor ?? null, resource, accountId],
  );
}
function fail(resource: string, accountId: number, err: unknown) {
  const msg = err instanceof MLApiError && (err.mlStatus === 403 || err.mlStatus === 401)
    ? `Sem permissão para este recurso (${err.message}). Verifique os escopos do aplicativo.`
    : (err as Error).message;
  q.run("UPDATE sync_state SET status='error', message=? WHERE resource=? AND account_id=?", [msg.slice(0, 1000), resource, accountId]);
  logger.warn("sync_failed", { resource, error: msg });
}
export const getCursor = (resource: string, accountId: number) =>
  q.get<{ cursor: string | null }>("SELECT cursor FROM sync_state WHERE resource=? AND account_id=?", [resource, accountId])?.cursor ?? null;

async function step(resource: string, accountId: number, fn: () => Promise<{ processed: number; cursor?: string | null }>) {
  if (!begin(resource, accountId)) return { resource, skipped: true };
  try {
    const r = await fn();
    finish(resource, accountId, r.processed, r.cursor);
    return { resource, ...r };
  } catch (e) {
    fail(resource, accountId, e);
    return { resource, error: (e as Error).message };
  }
}

// ------------------------------------------------------------------
// Anúncios
// ------------------------------------------------------------------
export function extractSku(item: any): string | null {
  if (item.seller_custom_field) return String(item.seller_custom_field);
  const attr = (item.attributes ?? []).find((a: any) => a.id === "SELLER_SKU");
  return attr?.value_name ?? null;
}

/** Grava/atualiza um anúncio e garante vínculo com um produto interno (por SKU ou criação automática). */
export function upsertListing(item: any, accountId: number) {
  const sku = extractSku(item);
  q.tx(() => {
    q.run(
      `INSERT INTO listings (id, account_id, title, category_id, price, original_price, currency_id, available_quantity, sold_quantity, status, sub_status,
         listing_type_id, permalink, thumbnail, condition, health, catalog_listing, logistic_type, free_shipping, sku, date_created, last_updated, raw, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, category_id=excluded.category_id, price=excluded.price, original_price=excluded.original_price,
         currency_id=excluded.currency_id, available_quantity=excluded.available_quantity, sold_quantity=excluded.sold_quantity, status=excluded.status,
         sub_status=excluded.sub_status, listing_type_id=excluded.listing_type_id, permalink=excluded.permalink, thumbnail=excluded.thumbnail,
         condition=excluded.condition, health=excluded.health, catalog_listing=excluded.catalog_listing, logistic_type=excluded.logistic_type,
         free_shipping=excluded.free_shipping, sku=excluded.sku, last_updated=excluded.last_updated, raw=excluded.raw, synced_at=excluded.synced_at`,
      [
        item.id, accountId, item.title, item.category_id, item.price, item.original_price ?? null, item.currency_id, item.available_quantity,
        item.sold_quantity, item.status, json.str(item.sub_status ?? []), item.listing_type_id, item.permalink,
        (item.secure_thumbnail ?? item.thumbnail ?? "").replace(/^http:/, "https:"), item.condition, item.health ?? null,
        item.catalog_listing ? 1 : 0, item.shipping?.logistic_type ?? null, item.shipping?.free_shipping ? 1 : 0, sku,
        item.date_created, item.last_updated, JSON.stringify(item), now(),
      ],
    );
    const linked = q.get<{ product_id: number | null }>("SELECT product_id FROM listings WHERE id=?", [item.id]);
    if (!linked?.product_id) {
      let productId = sku ? q.get<{ id: number }>("SELECT id FROM products WHERE sku=?", [sku])?.id : undefined;
      if (!productId) {
        const r = q.run("INSERT INTO products (sku, name, category, stock_qty) VALUES (?,?,?,?)", [
          sku, item.title, item.category_id, item.available_quantity ?? 0,
        ]);
        productId = Number(r.lastInsertRowid);
        q.run("INSERT INTO stock_movements (product_id, type, qty, reason, ref) VALUES (?, 'adjust', ?, 'Saldo inicial importado do Mercado Livre', ?)", [
          productId, item.available_quantity ?? 0, `import:${item.id}`,
        ]);
      }
      q.run("UPDATE listings SET product_id=? WHERE id=?", [productId, item.id]);
    }
  });
}

export async function fetchItems(ids: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const group of chunk(ids, 20)) {
    const res = await ml<{ code: number; body: any }[]>(`/items?ids=${group.join(",")}`);
    for (const r of res) if (r.code === 200 && r.body) out.push(r.body);
  }
  return out;
}

async function listItemIds(accountId: number, status: string): Promise<string[]> {
  const ids: string[] = [];
  let scrollId: string | undefined;
  for (let guard = 0; guard < 500; guard++) {
    const qs = new URLSearchParams({ status, search_type: "scan", limit: "100" });
    if (scrollId) qs.set("scroll_id", scrollId);
    const r = await ml<{ results: string[]; scroll_id?: string }>(`/users/${accountId}/items/search?${qs}`);
    if (!r.results?.length) break;
    ids.push(...r.results);
    scrollId = r.scroll_id;
    if (!scrollId) break;
  }
  return ids;
}

export async function syncListings(accountId: number, full: boolean) {
  const statuses = full ? ["active", "paused", "closed", "under_review", "inactive"] : ["active", "paused", "under_review"];
  let processed = 0;
  for (const status of statuses) {
    let ids: string[];
    try {
      ids = await listItemIds(accountId, status);
    } catch (e) {
      if (e instanceof MLApiError && e.mlStatus === 400) continue; // status não suportado nesta conta
      throw e;
    }
    for (const group of chunk(ids, 100)) {
      for (const item of await fetchItems(group)) {
        upsertListing(item, accountId);
        processed++;
      }
    }
  }
  return { processed };
}

// ------------------------------------------------------------------
// Pedidos, itens e envios
// ------------------------------------------------------------------
export function paymentStatus(order: any): string {
  const ps: any[] = order.payments ?? [];
  if (ps.some((p) => p.status === "approved")) return "approved";
  if (ps.some((p) => p.status === "refunded" || p.status === "charged_back")) return "refunded";
  if (ps.some((p) => p.status === "in_process" || p.status === "pending" || p.status === "authorized")) return "pending";
  if (ps.some((p) => p.status === "rejected" || p.status === "cancelled")) return "rejected";
  return ps[0]?.status ?? "unknown";
}

export function upsertOrder(o: any, accountId: number) {
  const items = (o.order_items ?? []).map((it: any) => ({
    listing_id: it.item?.id,
    variation_id: it.item?.variation_id ? String(it.item.variation_id) : "",
    title: it.item?.title,
    quantity: it.quantity,
    unit_price: it.unit_price,
    sale_fee: it.sale_fee ?? null,
    listing_type_id: it.listing_type_id ?? null,
    category_id: it.item?.category_id ?? null,
    seller_sku: it.item?.seller_sku ?? it.item?.seller_custom_field ?? null,
  }));
  const paid = (o.payments ?? []).filter((p: any) => p.status === "approved").reduce((s: number, p: any) => s + (p.transaction_amount ?? 0), 0);
  q.tx(() => {
    q.run(
      `INSERT INTO orders (id, account_id, status, status_detail, payment_status, date_created, date_closed, last_updated, total_amount, paid_amount,
         currency_id, buyer_id, buyer_nickname, shipping_id, pack_id, tags, raw, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, status_detail=excluded.status_detail, payment_status=excluded.payment_status,
         date_closed=excluded.date_closed, last_updated=excluded.last_updated, total_amount=excluded.total_amount, paid_amount=excluded.paid_amount,
         shipping_id=excluded.shipping_id, pack_id=excluded.pack_id, tags=excluded.tags, raw=excluded.raw, synced_at=excluded.synced_at`,
      [
        o.id, accountId, o.status, json.str(o.status_detail), paymentStatus(o), o.date_created, o.date_closed ?? null,
        o.last_updated ?? o.date_last_updated ?? null, o.total_amount, paid, o.currency_id, o.buyer?.id ?? null, o.buyer?.nickname ?? null,
        o.shipping?.id ?? null, o.pack_id ?? null, json.str(o.tags ?? []), JSON.stringify(o), now(),
      ],
    );
    for (const it of items) {
      if (!it.listing_id) continue;
      q.run(
        `INSERT INTO order_items (order_id, listing_id, variation_id, title, quantity, unit_price, sale_fee, listing_type_id, category_id, seller_sku)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(order_id, listing_id, variation_id) DO UPDATE SET quantity=excluded.quantity, unit_price=excluded.unit_price, sale_fee=excluded.sale_fee`,
        [o.id, it.listing_id, it.variation_id, it.title, it.quantity, it.unit_price, it.sale_fee, it.listing_type_id, it.category_id, it.seller_sku],
      );
    }
  });
  applyOrderStock(o.id, o.status, items.filter((i: any) => i.listing_id));
}

export function upsertShipment(s: any, orderId: number | null, sellerCost: number | null) {
  q.run(
    `INSERT INTO shipments (id, order_id, status, substatus, logistic_type, mode, tracking_number, tracking_method, date_created, handling_limit, delivery_estimate, seller_cost, raw, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, substatus=excluded.substatus, tracking_number=excluded.tracking_number,
       tracking_method=excluded.tracking_method, handling_limit=excluded.handling_limit, delivery_estimate=excluded.delivery_estimate,
       seller_cost=COALESCE(excluded.seller_cost, seller_cost), raw=excluded.raw, synced_at=excluded.synced_at`,
    [
      s.id, orderId ?? s.order_id ?? null, s.status, s.substatus ?? null, s.logistic_type ?? s.logistic?.type ?? null, s.mode ?? s.logistic?.mode ?? null,
      s.tracking_number ?? null, s.tracking_method ?? null, s.date_created ?? null,
      s.shipping_option?.estimated_handling_limit?.date ?? s.lead_time?.estimated_handling_limit?.date ?? null,
      s.shipping_option?.estimated_delivery_time?.date ?? s.lead_time?.estimated_delivery_time?.date ?? null,
      sellerCost, JSON.stringify(s), now(),
    ],
  );
}

export async function syncShipment(shipmentId: number, orderId: number | null) {
  const s = await ml(`/shipments/${shipmentId}`, { headers: { "x-format-new": "true" } });
  let sellerCost: number | null = null;
  try {
    const costs = await ml<any>(`/shipments/${shipmentId}/costs`);
    sellerCost = (costs?.senders ?? []).reduce((sum: number, x: any) => sum + (x.cost ?? 0), 0);
  } catch {
    /* custos nem sempre disponíveis (ex.: envio próprio) */
  }
  upsertShipment(s, orderId, sellerCost);
}

export async function syncOrders(accountId: number) {
  const cursor = getCursor("orders", accountId);
  // Primeira carga: 12 meses. Depois: incremental por data de atualização (com sobreposição de 10 min).
  const from = cursor ? new Date(Date.parse(cursor) - 10 * 60_000) : new Date(Date.now() - 365 * 86_400_000);
  const startedAt = now();
  let offset = 0, processed = 0;
  const touched: { order: number; shipping: number | null }[] = [];
  for (;;) {
    const qs = new URLSearchParams({ seller: String(accountId), "order.date_last_updated.from": from.toISOString(), sort: "date_asc", limit: "50", offset: String(offset) });
    const r = await ml<{ results: any[]; paging: { total: number } }>(`/orders/search?${qs}`);
    for (const o of r.results ?? []) {
      upsertOrder(o, accountId);
      touched.push({ order: o.id, shipping: o.shipping?.id ?? null });
      processed++;
    }
    offset += 50;
    if (!r.results?.length || offset >= (r.paging?.total ?? 0) || offset >= 10_000) break;
  }
  await mapLimit(touched.filter((t) => t.shipping), 3, async (t) => {
    try { await syncShipment(t.shipping!, t.order); } catch (e) { logger.warn("shipment_sync_failed", { shipment: t.shipping, error: e }); }
  });
  return { processed, cursor: startedAt };
}

// ------------------------------------------------------------------
// Perguntas, reputação, visitas
// ------------------------------------------------------------------
export function upsertQuestion(qq: any) {
  q.run(
    `INSERT INTO questions (id, listing_id, text, status, date_created, answer_text, answer_date, from_id, raw, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, answer_text=excluded.answer_text, answer_date=excluded.answer_date, raw=excluded.raw, synced_at=excluded.synced_at`,
    [qq.id, qq.item_id, qq.text, qq.status, qq.date_created, qq.answer?.text ?? null, qq.answer?.date_created ?? null, qq.from?.id ?? null, JSON.stringify(qq), now()],
  );
}

export async function syncQuestions(accountId: number) {
  let processed = 0;
  for (let offset = 0; offset < 1000; offset += 50) {
    const qs = new URLSearchParams({ seller_id: String(accountId), api_version: "4", sort_fields: "date_created", sort_types: "DESC", limit: "50", offset: String(offset) });
    const r = await ml<{ questions: any[]; total: number }>(`/questions/search?${qs}`);
    for (const qq of r.questions ?? []) { upsertQuestion(qq); processed++; }
    if (!r.questions?.length || offset + 50 >= (r.total ?? 0)) break;
  }
  return { processed };
}

export async function syncReputation(accountId: number) {
  const u = await ml<any>(`/users/${accountId}`);
  const rep = u.seller_reputation ?? {};
  q.run("INSERT INTO reputation_snapshots (account_id, level_id, power_seller_status, transactions, metrics) VALUES (?,?,?,?,?)", [
    accountId, rep.level_id ?? null, rep.power_seller_status ?? null, json.str(rep.transactions), json.str(rep.metrics),
  ]);
  q.run("UPDATE ml_accounts SET nickname=?, site_id=? WHERE id=?", [u.nickname, u.site_id, accountId]);
  return { processed: 1 };
}

export async function syncVisits(accountId: number) {
  let processed = 0;
  const store = await ml<{ results: { date: string; total: number }[] }>(`/users/${accountId}/items_visits/time_window?last=30&unit=day`);
  for (const r of store.results ?? []) {
    q.run("INSERT INTO visits_daily (scope, date, visits) VALUES ('store', ?, ?) ON CONFLICT(scope, date) DO UPDATE SET visits=excluded.visits", [r.date.slice(0, 10), r.total]);
    processed++;
  }
  // Visitas por anúncio: os 60 anúncios ativos mais vendidos (equilíbrio entre detalhe e limite de requisições).
  const top = q.all<{ id: string }>("SELECT id FROM listings WHERE status='active' ORDER BY sold_quantity DESC LIMIT 60");
  await mapLimit(top, 3, async ({ id }) => {
    try {
      const r = await ml<{ results: { date: string; total: number }[] }>(`/items/${id}/visits/time_window?last=30&unit=day`);
      for (const d of r.results ?? []) {
        q.run("INSERT INTO visits_daily (scope, date, visits) VALUES (?, ?, ?) ON CONFLICT(scope, date) DO UPDATE SET visits=excluded.visits", [id, d.date.slice(0, 10), d.total]);
      }
      processed++;
    } catch (e) { logger.warn("item_visits_failed", { id, error: e }); }
  });
  return { processed };
}

// ------------------------------------------------------------------
// Orquestração
// ------------------------------------------------------------------
let lastFullListingSync = 0;

export async function runSync(opts: { full?: boolean; only?: string[] } = {}) {
  const acc = requireAccount();
  const want = (r: string) => !opts.only || opts.only.includes(r);
  const full = opts.full || Date.now() - lastFullListingSync > 6 * 3_600_000;
  const results = [];
  if (want("reputation")) results.push(await step("reputation", acc.id, () => syncReputation(acc.id)));
  if (want("listings")) {
    results.push(await step("listings", acc.id, () => syncListings(acc.id, full)));
    if (full) lastFullListingSync = Date.now();
  }
  if (want("orders")) results.push(await step("orders", acc.id, () => syncOrders(acc.id)));
  if (want("questions")) results.push(await step("questions", acc.id, () => syncQuestions(acc.id)));
  if (want("visits")) results.push(await step("visits", acc.id, () => syncVisits(acc.id)));
  if (want("ads")) results.push(await step("ads", acc.id, () => syncAds(acc.id)));
  try { evaluateAlerts(); } catch (e) { logger.error("alerts_failed", { error: e }); }
  logger.info("sync_done", { results: JSON.stringify(results) });
  return results;
}

/** Processa uma notificação (webhook) do Mercado Livre atualizando apenas o recurso afetado. */
export async function processNotification(topic: string, resource: string) {
  const acc = requireAccount();
  if (topic === "orders_v2" || topic === "orders") {
    const id = resource.split("/").pop();
    const o = await ml(`/orders/${id}`);
    upsertOrder(o, acc.id);
    if (o.shipping?.id) await syncShipment(o.shipping.id, o.id).catch(() => undefined);
  } else if (topic === "items") {
    const id = resource.split("/").pop()!;
    const [item] = await fetchItems([id]);
    if (item) upsertListing(item, acc.id);
  } else if (topic === "questions") {
    const id = resource.split("/").pop();
    upsertQuestion(await ml(`/questions/${id}?api_version=4`));
  } else if (topic === "shipments") {
    const id = Number(resource.split("/").pop());
    const order = q.get<{ id: number }>("SELECT id FROM orders WHERE shipping_id=?", [id]);
    await syncShipment(id, order?.id ?? null);
  }
  evaluateAlerts();
}
