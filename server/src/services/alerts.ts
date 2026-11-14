import { q, json, getSetting } from "../db/index.ts";
import { resolvePeriod, previousRange, localDate } from "../lib/dates.ts";
import { profitByListing } from "./finance.ts";

type Severity = "info" | "warning" | "critical" | "opportunity";
interface AlertInput {
  type: string;
  severity: Severity;
  title: string;
  message: string;
  entity?: string;
  entity_id?: string;
  data?: unknown;
  /** Chave de deduplicação: o mesmo alerta não é recriado enquanto estiver aberto/lido. */
  key: string;
}

export function raise(a: AlertInput) {
  const existing = q.get<{ id: number; status: string }>("SELECT id, status FROM alerts WHERE dedupe_key=?", [a.key]);
  if (existing) {
    if (existing.status === "resolved") {
      q.run("UPDATE alerts SET status='open', title=?, message=?, data=?, severity=?, updated_at=? WHERE id=?", [
        a.title, a.message, json.str(a.data), a.severity, new Date().toISOString(), existing.id,
      ]);
      enqueueNotifications(existing.id, a.severity);
    } else {
      q.run("UPDATE alerts SET message=?, data=?, updated_at=? WHERE id=?", [a.message, json.str(a.data), new Date().toISOString(), existing.id]);
    }
    return;
  }
  const r = q.run(
    "INSERT INTO alerts (type, severity, title, message, entity, entity_id, data, dedupe_key) VALUES (?,?,?,?,?,?,?,?)",
    [a.type, a.severity, a.title, a.message, a.entity ?? null, a.entity_id ?? null, json.str(a.data), a.key],
  );
  enqueueNotifications(Number(r.lastInsertRowid), a.severity);
}

/** Resolve automaticamente alertas de um tipo cuja condição deixou de existir. */
function resolveStale(type: string, activeKeys: Set<string>) {
  for (const a of q.all<{ id: number; dedupe_key: string }>("SELECT id, dedupe_key FROM alerts WHERE type=? AND status!='resolved'", [type])) {
    if (!activeKeys.has(a.dedupe_key)) q.run("UPDATE alerts SET status='resolved', updated_at=? WHERE id=?", [new Date().toISOString(), a.id]);
  }
}

const sevRank: Record<string, number> = { info: 1, opportunity: 2, warning: 3, critical: 4 };

/** Estrutura para notificações futuras por e-mail/WhatsApp: enfileira para canais habilitados. */
function enqueueNotifications(alertId: number, severity: Severity) {
  for (const ch of q.all<{ id: number; min_severity: string }>("SELECT id, min_severity FROM notification_channels WHERE enabled=1")) {
    if (sevRank[severity]! >= (sevRank[ch.min_severity] ?? 3)) {
      q.run("INSERT INTO notification_outbox (alert_id, channel_id) VALUES (?,?)", [alertId, ch.id]);
    }
  }
}

/** Avalia todas as regras de alerta sobre os dados sincronizados. */
export function evaluateAlerts(now = new Date()) {
  const minMargin = getSetting<number>("min_margin_pct", 10);
  const staleDays = getSetting<number>("stale_days", 21);
  const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const rule = (type: string, build: () => AlertInput[]) => {
    const list = build();
    for (const a of list) raise(a);
    resolveStale(type, new Set(list.map((a) => a.key)));
  };

  // 1. Sem estoque
  rule("out_of_stock", () =>
    q.all<any>("SELECT id, title FROM listings WHERE status IN ('active','paused') AND available_quantity <= 0").map((l) => ({
      type: "out_of_stock", severity: "critical" as const, title: "Anúncio sem estoque",
      message: `"${l.title}" está sem unidades disponíveis no Mercado Livre.`, entity: "listing", entity_id: l.id, key: `out_of_stock:${l.id}`,
    })),
  );

  // 2. Estoque interno abaixo do mínimo
  rule("low_stock", () =>
    q.all<any>("SELECT id, name, stock_qty, min_stock FROM products WHERE made_to_order=0 AND min_stock > 0 AND stock_qty <= min_stock AND stock_qty > 0").map((p) => ({
      type: "low_stock", severity: "warning" as const, title: "Estoque baixo",
      message: `"${p.name}" tem ${p.stock_qty} unidade(s); mínimo definido: ${p.min_stock}.`, entity: "product", entity_id: String(p.id), key: `low_stock:${p.id}`,
      data: { stock: p.stock_qty, min: p.min_stock },
    })),
  );

  // 3. Perguntas aguardando resposta
  rule("unanswered_questions", () => {
    const n = q.get<{ n: number; oldest: string | null }>("SELECT COUNT(*) n, MIN(date_created) oldest FROM questions WHERE status='UNANSWERED'")!;
    if (!n.n) return [];
    const hours = n.oldest ? Math.floor((now.getTime() - Date.parse(n.oldest)) / 3_600_000) : 0;
    return [{
      type: "unanswered_questions", severity: hours >= 12 ? "critical" : "warning", title: "Perguntas aguardando resposta",
      message: `${n.n} pergunta(s) sem resposta. A mais antiga aguarda há ${hours}h.`, key: "unanswered_questions", data: { count: n.n, hours },
    }];
  });

  // 4. Pedidos próximos do prazo de postagem
  rule("shipping_deadline", () =>
    q.all<any>(
      `SELECT s.id, s.order_id, s.handling_limit FROM shipments s JOIN orders o ON o.id=s.order_id
       WHERE o.status='paid' AND s.status IN ('ready_to_ship','handling') AND s.handling_limit IS NOT NULL AND s.handling_limit < ?`,
      [new Date(now.getTime() + 24 * 3_600_000).toISOString()],
    ).map((s) => {
      const late = Date.parse(s.handling_limit) < now.getTime();
      return {
        type: "shipping_deadline", severity: "critical" as const, title: late ? "Postagem atrasada" : "Prazo de postagem em menos de 24h",
        message: `Pedido ${s.order_id}: postar até ${new Date(s.handling_limit).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
        entity: "order", entity_id: String(s.order_id), key: `shipping_deadline:${s.id}`,
      };
    }),
  );

  // 5. Produto vendeu acima da média (últimos 7 dias vs média diária de 30 dias anteriores)
  rule("sales_spike", () => {
    const d7 = resolvePeriod("7d", undefined, undefined, now);
    const base = { fromUtc: new Date(Date.parse(d7.fromUtc) - 30 * 86_400_000).toISOString(), toUtc: d7.fromUtc };
    const rows = q.all<any>(
      `SELECT oi.listing_id, MAX(oi.title) title,
         SUM(CASE WHEN o.date_created >= ? THEN oi.quantity ELSE 0 END) recent,
         SUM(CASE WHEN o.date_created < ? THEN oi.quantity ELSE 0 END) base
       FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='paid' AND o.date_created >= ? GROUP BY oi.listing_id`,
      [d7.fromUtc, base.toUtc, base.fromUtc],
    );
    return rows.filter((r) => r.recent >= 3 && r.recent / 7 > 1.5 * (r.base / 30)).map((r) => ({
      type: "sales_spike", severity: "opportunity" as const, title: "Produto vendendo acima da média",
      message: `"${r.title}": ${r.recent} un. nos últimos 7 dias (média anterior: ${((r.base / 30) * 7).toFixed(1)} un./semana). Verifique estoque e considere reforçar a divulgação.`,
      entity: "listing", entity_id: r.listing_id, key: `sales_spike:${r.listing_id}:${localDate(now).slice(0, 7)}`, data: r,
    }));
  });

  // 6. Queda de desempenho (30d vs 30d anteriores, queda >= 40% com base mínima)
  rule("performance_drop", () => {
    const cur = resolvePeriod("30d", undefined, undefined, now);
    const prev = previousRange(cur);
    const rows = q.all<any>(
      `SELECT oi.listing_id, MAX(oi.title) title,
         SUM(CASE WHEN o.date_created >= ? THEN oi.quantity ELSE 0 END) cur,
         SUM(CASE WHEN o.date_created < ? THEN oi.quantity ELSE 0 END) prev
       FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='paid' AND o.date_created >= ? GROUP BY oi.listing_id`,
      [cur.fromUtc, cur.fromUtc, prev.fromUtc],
    );
    return rows.filter((r) => r.prev >= 5 && r.cur <= r.prev * 0.6).map((r) => ({
      type: "performance_drop", severity: "warning" as const, title: "Anúncio perdeu desempenho",
      message: `"${r.title}": ${r.cur} un. nos últimos 30 dias contra ${r.prev} un. no período anterior (${(((r.cur - r.prev) / r.prev) * 100).toFixed(0)}%).`,
      entity: "listing", entity_id: r.listing_id, key: `performance_drop:${r.listing_id}`, data: r,
    }));
  });

  // 7. Muitos dias sem vender
  rule("stale_listing", () =>
    q.all<any>(
      `SELECT l.id, l.title, l.date_created,
         (SELECT MAX(o.date_created) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.listing_id=l.id AND o.status='paid') last_sale
       FROM listings l WHERE l.status='active'`,
    ).filter((l) => {
      const ref = l.last_sale ?? l.date_created;
      return ref && now.getTime() - Date.parse(ref) > staleDays * 86_400_000;
    }).map((l) => {
      const days = Math.floor((now.getTime() - Date.parse(l.last_sale ?? l.date_created)) / 86_400_000);
      return {
        type: "stale_listing", severity: "info" as const, title: "Anúncio parado",
        message: `"${l.title}" está há ${days} dias sem vender${l.last_sale ? "" : " (nenhuma venda registrada)"}.`,
        entity: "listing", entity_id: l.id, key: `stale_listing:${l.id}`, data: { days },
      };
    }),
  );

  // 8. Margem abaixo do esperado / 9. oportunidade de aumentar preço
  const profit = profitByListing(resolvePeriod("30d", undefined, undefined, now)).filter((p) => p.cost_known && p.units >= 2);
  rule("low_margin", () =>
    profit.filter((p) => (p.margin_pct ?? 0) < minMargin).map((p) => ({
      type: "low_margin", severity: "warning" as const, title: "Margem abaixo do esperado",
      message: `"${p.title}": margem de ${p.margin_pct?.toFixed(1)}% nos últimos 30 dias (mínimo configurado: ${minMargin}%). Lucro: ${fmt(p.profit ?? 0)}.`,
      entity: "listing", entity_id: p.listing_id, key: `low_margin:${p.listing_id}`, data: p,
    })),
  );
  rule("price_increase_opportunity", () => {
    const visits = new Map(q.all<{ scope: string; v: number }>("SELECT scope, SUM(visits) v FROM visits_daily WHERE scope != 'store' GROUP BY scope").map((x) => [x.scope, x.v]));
    return profit.filter((p) => {
      const v = visits.get(p.listing_id);
      return p.units >= 10 && v && p.orders / v >= 0.05; // conversão >= 5% e volume relevante
    }).map((p) => ({
      type: "price_increase_opportunity", severity: "opportunity" as const, title: "Oportunidade de testar aumento de preço",
      message: `"${p.title}": ${p.units} un. em 30 dias com conversão de ${((p.orders / (visits.get(p.listing_id) ?? 1)) * 100).toFixed(1)}%. Demanda forte pode suportar um teste de +5% no preço.`,
      entity: "listing", entity_id: p.listing_id, key: `price_up:${p.listing_id}`, data: p,
    }));
  });

  // 10. Aumento de cancelamentos
  rule("cancellations", () => {
    const cur = resolvePeriod("7d", undefined, undefined, now);
    const c = q.get<any>(
      "SELECT SUM(status='cancelled') cancelled, COUNT(*) total FROM orders WHERE date_created >= ? AND date_created < ?",
      [cur.fromUtc, cur.toUtc],
    )!;
    if (!c.total || c.cancelled < 2 || c.cancelled / c.total < 0.08) return [];
    return [{
      type: "cancellations", severity: "warning" as const, title: "Aumento de cancelamentos",
      message: `${c.cancelled} de ${c.total} pedidos cancelados nos últimos 7 dias (${((c.cancelled / c.total) * 100).toFixed(1)}%). Cancelamentos afetam a reputação.`,
      key: "cancellations", data: c,
    }];
  });

  // 11. Potencial para campanha: bom volume e margem, sem publicidade
  rule("campaign_potential", () => {
    const advertised = new Set(q.all<{ listing_id: string }>("SELECT DISTINCT listing_id FROM ads_item_metrics").map((x) => x.listing_id));
    const hasAds = q.get("SELECT 1 FROM ads_campaigns");
    if (!hasAds) return [];
    return profit.filter((p) => !advertised.has(p.listing_id) && p.units >= 5 && (p.margin_pct ?? 0) >= minMargin + 10).map((p) => ({
      type: "campaign_potential", severity: "opportunity" as const, title: "Produto com potencial para campanha",
      message: `"${p.title}" tem margem de ${p.margin_pct?.toFixed(1)}% e ${p.units} vendas em 30 dias, mas não está em nenhuma campanha.`,
      entity: "listing", entity_id: p.listing_id, key: `campaign_potential:${p.listing_id}`,
    }));
  });

  // 12. Conta precisa de reautorização
  rule("ml_reauth", () => {
    const acc = q.get<any>("SELECT id, last_error FROM ml_accounts WHERE status='needs_reauth'");
    return acc ? [{ type: "ml_reauth", severity: "critical" as const, title: "Reconecte o Mercado Livre", message: "A autorização expirou ou foi revogada. A sincronização está parada.", key: "ml_reauth" }] : [];
  });
}

export function listAlerts(status?: string) {
  return q.all(
    `SELECT * FROM alerts ${status ? "WHERE status = ?" : "WHERE status != 'resolved'"} ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'opportunity' THEN 2 ELSE 3 END, updated_at DESC LIMIT 500`,
    status ? [status] : [],
  ).map((a: any) => ({ ...a, data: json.parse(a.data, null) }));
}
