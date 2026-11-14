import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { encrypt, decrypt, hashPassword, verifyPassword, pkcePair } = await import("../src/lib/crypto.ts");
const { resolvePeriod, previousRange, localDate } = await import("../src/lib/dates.ts");
const { simulate, priceForMargin, productionCost, breakEvenUnits, emptyCosts } = await import("../src/services/finance.ts");

test("criptografia AES-GCM: ida e volta e detecção de adulteração", () => {
  const c = encrypt("token-secreto");
  assert.notEqual(c, "token-secreto");
  assert.equal(decrypt(c), "token-secreto");
  const parts = c.split(".");
  parts[3] = Buffer.from("xxxx").toString("base64");
  assert.throws(() => decrypt(parts.join(".")));
});

test("hash de senha scrypt", () => {
  const h = hashPassword("minha-senha-123");
  assert.ok(verifyPassword("minha-senha-123", h));
  assert.ok(!verifyPassword("outra", h));
});

test("PKCE gera challenge S256 válido", async () => {
  const { verifier, challenge } = pkcePair();
  const { createHash } = await import("node:crypto");
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), challenge);
});

test("períodos no fuso da loja (UTC-3)", () => {
  const now = new Date("2026-03-10T02:00:00Z"); // 09/03 23h em São Paulo
  assert.equal(localDate(now), "2026-03-09");
  const r = resolvePeriod("7d", undefined, undefined, now);
  assert.equal(r.from, "2026-03-03");
  assert.equal(r.to, "2026-03-09");
  assert.equal(r.fromUtc, "2026-03-03T03:00:00.000Z");
  assert.equal(r.toUtc, "2026-03-10T03:00:00.000Z");
  const p = previousRange(r);
  assert.equal(p.to, "2026-03-02");
  assert.equal(p.days, 7);
  assert.throws(() => resolvePeriod("custom", "2026-01-01"));
});

test("financeiro: custo, simulação, preço mínimo e preço para margem", () => {
  const costs = { ...emptyCosts(), material_cost: 8, energy_cost: 1, packaging_cost: 2, production_minutes: 60, labor_cost_per_hour: 10, tax_rate_pct: 6 };
  assert.equal(productionCost(costs), 21);
  const fee = { percentage: 0.14, fixed: 6.75, source: "manual" as const };
  const sim = simulate(80, costs, fee);
  // 80 - (21 + 6.75 + 80*0.14 + 80*0.06) = 80 - 43.75 = 36.25
  assert.equal(sim.net_profit, 36.25);
  assert.equal(sim.margin_pct, 45.31);
  // preço mínimo: (21 + 6.75) / (1 - 0.14 - 0.06) = 34.6875
  assert.equal(sim.min_price, 34.69);
  assert.equal(simulate(sim.min_price, costs, fee).net_profit, 0);
  const p = priceForMargin(25, costs, fee)!;
  assert.ok(Math.abs(simulate(p, costs, fee).margin_pct - 25) < 0.05);
  assert.equal(breakEvenUnits(1000, sim), Math.ceil(1000 / 36.25));
  assert.equal(priceForMargin(90, costs, fee), null);
});
