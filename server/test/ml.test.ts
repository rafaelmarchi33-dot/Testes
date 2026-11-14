import { mockMl, connectFakeAccount } from "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { ml, MLApiError } = await import("../src/ml/client.ts");
const { q } = await import("../src/db/index.ts");
const { upsertOrder, upsertListing, upsertShipment, paymentStatus } = await import("../src/ml/sync.ts");
const { profitByListing } = await import("../src/services/finance.ts");
const { resolvePeriod } = await import("../src/lib/dates.ts");
const { evaluateAlerts } = await import("../src/services/alerts.ts");
const { createAction, approveAction, rejectAction } = await import("../src/services/actions.ts");

test("sem conta conectada, nenhuma chamada é simulada", async () => {
  await assert.rejects(ml("/users/me"), /Nenhuma conta do Mercado Livre conectada/);
});

test("cliente ML: renova token expirado (refresh de uso único) e repete 429", async () => {
  await connectFakeAccount(-10); // token já expirado
  let n429 = 0;
  const calls = await mockMl((url, init) => {
    if (url.endsWith("/oauth/token")) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "RT-1");
      return { body: { access_token: "AT-2", refresh_token: "RT-2", expires_in: 21600, user_id: 999 } };
    }
    if (url.endsWith("/users/me")) {
      assert.equal((init?.headers as any).authorization, "Bearer AT-2");
      if (n429++ === 0) return { status: 429, headers: { "retry-after": "0" }, body: { message: "too many" } };
      return { body: { id: 999, nickname: "LOJA" } };
    }
  });
  const me = await ml("/users/me");
  assert.equal(me.nickname, "LOJA");
  assert.equal(calls.filter((c) => c.url.endsWith("/oauth/token")).length, 1);
  // refresh token novo foi persistido (criptografado)
  const { decrypt } = await import("../src/lib/crypto.ts");
  assert.equal(decrypt(q.get<any>("SELECT refresh_token_enc FROM ml_accounts WHERE id=999")!.refresh_token_enc), "RT-2");
});

test("cliente ML: erro 400 não é repetido e preserva corpo", async () => {
  const calls = await mockMl(() => ({ status: 400, body: { message: "invalid price", cause: [] } }));
  await assert.rejects(ml("/items/X", { method: "PUT", body: { price: -1 } }), (e) => e instanceof MLApiError && e.mlStatus === 400);
  assert.equal(calls.length, 1);
});

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Produto ${id}`, category_id: "MLB1234", price: 100, currency_id: "BRL", available_quantity: 10, sold_quantity: 5,
  status: "active", listing_type_id: "gold_special", permalink: `https://x/${id}`, thumbnail: "http://img", condition: "new",
  date_created: "2026-01-01T00:00:00Z", last_updated: "2026-01-01T00:00:00Z", seller_custom_field: `SKU-${id}`, ...extra,
});
const order = (id: number, listing: string, status: string, qty = 2, date = new Date().toISOString()) => ({
  id, status, date_created: date, last_updated: date, total_amount: 100 * qty, currency_id: "BRL",
  buyer: { id: 1, nickname: "COMPRADOR" }, shipping: { id: id + 1 },
  payments: [{ status: status === "paid" ? "approved" : "cancelled", transaction_amount: 100 * qty }],
  order_items: [{ item: { id: listing, title: `Produto ${listing}`, category_id: "MLB1234" }, quantity: qty, unit_price: 100, sale_fee: 14 }],
});

test("importação: anúncio cria produto vinculado por SKU com saldo inicial", () => {
  upsertListing(item("MLB1"), 999);
  upsertListing(item("MLB1", { price: 110 }), 999); // atualização não duplica produto
  const l = q.get<any>("SELECT * FROM listings WHERE id='MLB1'")!;
  assert.equal(l.price, 110);
  assert.equal(l.thumbnail, "https://img");
  const p = q.get<any>("SELECT * FROM products WHERE id=?", [l.product_id])!;
  assert.equal(p.sku, "SKU-MLB1");
  assert.equal(p.stock_qty, 10);
});

test("pedidos: baixa de estoque idempotente e estorno no cancelamento", () => {
  const pid = q.get<any>("SELECT product_id FROM listings WHERE id='MLB1'")!.product_id;
  upsertOrder(order(5001, "MLB1", "paid", 2), 999);
  upsertOrder(order(5001, "MLB1", "paid", 2), 999); // reprocessado (webhook + sync)
  assert.equal(q.get<any>("SELECT stock_qty FROM products WHERE id=?", [pid])!.stock_qty, 8);
  upsertOrder(order(5001, "MLB1", "cancelled", 2), 999);
  upsertOrder(order(5001, "MLB1", "cancelled", 2), 999);
  assert.equal(q.get<any>("SELECT stock_qty FROM products WHERE id=?", [pid])!.stock_qty, 10);
  assert.equal(paymentStatus({ payments: [{ status: "rejected" }, { status: "approved" }] }), "approved");
});

test("rentabilidade: lucro só com ficha de custos; frete rateado pelo envio", () => {
  upsertOrder(order(6001, "MLB1", "paid", 3), 999);
  upsertShipment({ id: 6002, status: "shipped" }, 6001, 25);
  const range = resolvePeriod("7d");
  let row = profitByListing(range).find((r) => r.listing_id === "MLB1")!;
  assert.equal(row.revenue, 300);
  assert.equal(row.sale_fees, 42);
  assert.equal(row.shipping, 25);
  assert.equal(row.profit, null, "sem custos cadastrados o lucro não é inventado");
  const pid = q.get<any>("SELECT product_id FROM listings WHERE id='MLB1'")!.product_id;
  q.run("INSERT INTO product_costs (product_id, material_cost, packaging_cost, tax_rate_pct) VALUES (?, 20, 3, 5)", [pid]);
  row = profitByListing(range).find((r) => r.listing_id === "MLB1")!;
  // 300 - 42 - 25 - 69 - 15 = 149
  assert.equal(row.profit, 149);
});

test("alertas: sem estoque é gerado e resolvido automaticamente", () => {
  upsertListing(item("MLB2", { available_quantity: 0, seller_custom_field: "SKU-2" }), 999);
  evaluateAlerts();
  assert.equal(q.get<any>("SELECT status FROM alerts WHERE dedupe_key='out_of_stock:MLB2'")!.status, "open");
  evaluateAlerts();
  assert.equal(q.get<any>("SELECT COUNT(*) n FROM alerts WHERE dedupe_key='out_of_stock:MLB2'")!.n, 1);
  upsertListing(item("MLB2", { available_quantity: 4, seller_custom_field: "SKU-2" }), 999);
  evaluateAlerts();
  assert.equal(q.get<any>("SELECT status FROM alerts WHERE dedupe_key='out_of_stock:MLB2'")!.status, "resolved");
});

test("aprovações: nada é enviado ao ML antes da aprovação; aprovação executa uma única vez", async () => {
  q.run("INSERT OR IGNORE INTO users (id, email, name, password_hash, role) VALUES (1,'a@a.com','A','x','admin')");
  const calls = await mockMl((url, init) => {
    if (url.includes("/items/MLB1") && init?.method === "PUT") return { body: { ...item("MLB1"), price: 120 } };
  });
  const id = createAction("update_price", { listing_id: "MLB1", price: 120 }, { userId: 1 });
  assert.equal(calls.length, 0, "criar a ação não altera a loja");
  assert.equal(createAction("update_price", { listing_id: "MLB1", price: 120 }, { userId: 1 }), id, "deduplica pendentes");
  const r = await approveAction(id, 1);
  assert.equal(r.status, "executed");
  assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
  assert.equal(q.get<any>("SELECT price FROM listings WHERE id='MLB1'")!.price, 120);
  await assert.rejects(approveAction(id, 1), /já está/);
  const id2 = createAction("update_status", { listing_id: "MLB1", status: "paused" }, { userId: 1 });
  rejectAction(id2, 1, "não agora");
  assert.equal(q.get<any>("SELECT status FROM actions WHERE id=?", [id2])!.status, "rejected");
  assert.ok(q.get("SELECT 1 FROM audit_log WHERE action='action.executed' AND entity_id=?", [String(id)]));
});
