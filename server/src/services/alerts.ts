import { q, json, getSetting } from "../db/index.ts";
import { resolvePeriod, previousRange, localDate, addDays } from "../lib/dates.ts";
import { goalProgress } from "./company.ts";
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

  const cfg = new Map(q.all<{ type: string; enabled: number; severity: string | null; threshold: number | null }>("SELECT type, enabled, severity, threshold FROM alert_rules").map((r) => [r.type, r]));
  const rule = (type: string, build: () => AlertInput[]) => {
    const c = cfg.get(type);
    if (c && !c.enabled) { resolveStale(type, new Set()); return; }
    const list = build().map((a) => (c?.severity ? { ...a, severity: c.severity as Severity } : a));
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

  const th = (type: string, d: number) => cfg.get(type)?.threshold ?? d;

  // 13. Margem negativa
  rule("negative_margin", () =>
    profit.filter((p) => (p.margin_pct ?? 0) < th("negative_margin", 0)).map((p) => ({
      type: "negative_margin", severity: "critical" as const, title: "Produto com margem negativa",
      message: `"${p.title}": margem de ${p.margin_pct?.toFixed(1)}% nos últimos 30 dias — cada venda dá prejuízo de ${fmt((p.profit ?? 0) / Math.max(1, p.units))}.`,
      entity: "listing", entity_id: p.listing_id, key: `negative_margin:${p.listing_id}`, data: p,
    })),
  );

  // 14. Produto campeão com estoque baixo (cobertura em dias pela velocidade de 30d)
  rule("champion_low_stock", () => {
    const minDays = th("champion_low_stock", 7);
    return q.all<any>(
      `SELECT p.id, p.name, p.stock_qty, SUM(oi.quantity) units FROM products p JOIN listings l ON l.product_id=p.id JOIN order_items oi ON oi.listing_id=l.id JOIN orders o ON o.id=oi.order_id
       WHERE p.made_to_order=0 AND o.status='paid' AND o.date_created >= ? GROUP BY p.id HAVING units >= 5`,
      [new Date(now.getTime() - 30 * 86_400_000).toISOString()],
    ).filter((p) => p.stock_qty / (p.units / 30) < minDays).map((p) => ({
      type: "champion_low_stock", severity: "critical" as const, title: "Produto campeão com estoque baixo",
      message: `"${p.name}" vende ${(p.units / 30).toFixed(1)} un./dia e tem ${p.stock_qty} un. — cobertura de ${(p.stock_qty / (p.units / 30)).toFixed(1)} dias. Programe produção.`,
      entity: "product", entity_id: String(p.id), key: `champion_low_stock:${p.id}`,
    }));
  });

  // 15. Filamento abaixo do mínimo
  rule("filament_low", () =>
    q.all<any>("SELECT * FROM filaments WHERE active=1 AND min_g > 0 AND available_g <= min_g").map((f) => ({
      type: "filament_low", severity: "warning" as const, title: "Filamento abaixo do mínimo",
      message: `${f.material} ${f.color ?? ""} ${f.brand ?? ""}: ${Math.round(f.available_g)} g disponíveis (mínimo ${Math.round(f.min_g)} g). Avalie reposição — compras não são feitas automaticamente.`,
      entity: "filament", entity_id: String(f.id), key: `filament_low:${f.id}`,
    })),
  );

  // 16. Risco de atraso na produção
  rule("production_delay", () => {
    const today = localDate(now);
    return q.all<any>("SELECT id, name, due_date, status FROM production_orders WHERE status NOT IN ('done','cancelled') AND due_date IS NOT NULL AND due_date <= ?", [addDays(today, 1)]).map((o) => ({
      type: "production_delay", severity: "critical" as const, title: o.due_date < today ? "Ordem de produção atrasada" : "Ordem de produção vence em até 1 dia",
      message: `OP #${o.id} "${o.name}" (${o.status}) — prazo ${o.due_date.split("-").reverse().join("/")}.`,
      entity: "production_order", entity_id: String(o.id), key: `production_delay:${o.id}`,
    }));
  });

  // 17. Campanha consumindo orçamento sem retorno (ACOS acima do limite em 14 dias)
  rule("campaign_no_return", () => {
    const maxAcos = th("campaign_no_return", 35);
    const since = addDays(localDate(now), -13);
    return q.all<any>("SELECT c.id, c.name, SUM(d.cost) cost, SUM(d.total_amount) amount FROM ads_campaigns c JOIN ads_campaign_daily d ON d.campaign_id=c.id WHERE d.date >= ? GROUP BY c.id HAVING cost > 0", [since])
      .filter((c) => !c.amount || (c.cost / c.amount) * 100 > maxAcos).map((c) => ({
        type: "campaign_no_return", severity: "warning" as const, title: "Campanha sem retorno adequado",
        message: `"${c.name}": ${fmt(c.cost)} investidos em 14 dias com ${fmt(c.amount ?? 0)} em vendas atribuídas (ACOS ${c.amount ? ((c.cost / c.amount) * 100).toFixed(0) + "%" : "∞"}; limite ${maxAcos}%). Nenhuma alteração é feita sem sua aprovação.`,
        entity: "campaign", entity_id: c.id, key: `campaign_no_return:${c.id}`,
      }));
  });

  // 18. Queda de conversão (7d vs 7d anteriores, com visitas registradas)
  rule("conversion_drop", () => {
    const cur = resolvePeriod("7d", undefined, undefined, now);
    const prev = previousRange(cur);
    const conv = (r: typeof cur) => {
      const v = q.get<{ v: number | null }>("SELECT SUM(visits) v FROM visits_daily WHERE scope='store' AND date BETWEEN ? AND ?", [r.from, r.to])!.v;
      const o = q.get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE status='paid' AND date_created >= ? AND date_created < ?", [r.fromUtc, r.toUtc])!.n;
      // dias sem pedidos individuais usam as vendas das métricas diárias importadas
      const m = q.get<{ n: number | null }>(
        `SELECT SUM(sales_count) n FROM daily_metrics d WHERE date BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.status='paid' AND date(datetime(o.date_created, '-180 minutes')) = d.date)`, [r.from, r.to])!.n ?? 0;
      return v ? ((o + m) / v) * 100 : null;
    };
    const a = conv(cur), b = conv(prev);
    const out: AlertInput[] = [];
    if (a !== null && b !== null && b - a >= th("conversion_drop", 2)) {
      out.push({ type: "conversion_drop", severity: "warning", title: "Queda de conversão", message: `Conversão de ${a.toFixed(1)}% nos últimos 7 dias contra ${b.toFixed(1)}% na semana anterior (−${(b - a).toFixed(1)} p.p.).`, key: `conversion_drop:${cur.to}` });
    }
    // Relatórios importados também sinalizam queda
    for (const r of q.all<any>("SELECT * FROM period_reports WHERE var_conversion_pp IS NOT NULL AND var_conversion_pp <= ?", [-th("conversion_drop", 2)])) {
      out.push({ type: "conversion_drop", severity: "warning", title: "Queda de conversão (relatório importado)",
        message: `Período ${r.date_from.split("-").reverse().join("/")}–${r.date_to.split("-").reverse().join("/")}: conversão de ${r.conversion_pct}% (${r.var_conversion_pp} p.p.), enquanto as visitas variaram ${r.var_visits_pct ?? "—"}%. Mais tráfego com menor conversão: revise anúncios que recebem as novas visitas.`,
        key: `conversion_drop:report:${r.id}`, entity: "period_report", entity_id: String(r.id) });
    }
    return out;
  });

  // 19. Abaixo da trajetória da meta
  rule("below_goal", () => {
    const g = goalProgress(now);
    const min = th("below_goal", 90);
    if (g.trajectory_pct === null || g.trajectory_pct >= min || g.today.slice(8, 10) < "03") return [];
    return [{ type: "below_goal", severity: "warning" as const, title: "Faturamento abaixo da trajetória da meta",
      message: `${fmt(g.revenue)} no mês (${g.trajectory_pct.toFixed(0)}% do esperado até hoje: ${fmt(g.expected_to_date)}). Para atingir ${fmt(g.goal)} são necessários ${g.needed_per_day !== null ? fmt(g.needed_per_day) : "—"}/dia.`,
      key: `below_goal:${g.month}`, data: { revenue: g.revenue, expected: g.expected_to_date } }];
  });

  // 20. Oportunidade de mercado identificada no radar
  rule("market_opportunity", () =>
    q.all<any>("SELECT id, name, score FROM opportunities WHERE score >= ? AND status IN ('new','watching')", [th("market_opportunity", 75)]).map((o) => ({
      type: "market_opportunity", severity: "opportunity" as const, title: "Oportunidade de mercado identificada",
      message: `"${o.name}" recebeu nota ${Math.round(o.score)} no Radar de Produtos. Avalie enviar ao Laboratório.`,
      entity: "opportunity", entity_id: String(o.id), key: `market_opportunity:${o.id}`,
    })),
  );
}

export function listAlerts(status?: string) {
  return q.all(
    `SELECT * FROM alerts ${status ? "WHERE status = ?" : "WHERE status != 'resolved'"} ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'opportunity' THEN 2 ELSE 3 END, updated_at DESC LIMIT 500`,
    status ? [status] : [],
  ).map((a: any) => ({ ...a, data: json.parse(a.data, null) }));
}
