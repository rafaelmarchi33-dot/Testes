// Servidor simulado do Mercado Livre e da API da Anthropic — somente para a auditoria.
const http = require("http");
const log = [];
const now = Date.now();
const iso = (daysAgo, h = 15) => new Date(now - daysAgo * 86400000 - (new Date(now).getUTCHours() - h) * 3600000).toISOString();
const items = {
  MLB111: { id: "MLB111", title: "Ímã de reposição Hollyland Lark M2", category_id: "MLB1234", price: 45, original_price: 50, currency_id: "BRL", available_quantity: 949, sold_quantity: 120, status: "active", listing_type_id: "gold_special", permalink: "https://produto.mercadolivre.com.br/MLB-111", thumbnail: "http://x/a.jpg", condition: "new", health: 0.94, seller_custom_field: "M2M-LARKM2", attributes: [], date_created: "2026-01-01T00:00:00Z", last_updated: iso(1), shipping: { free_shipping: false, logistic_type: "xd_drop_off" } },
  MLB222: { id: "MLB222", title: "Suporte de headset para mesa", category_id: "MLB9999", price: 59.9, currency_id: "BRL", available_quantity: 10, sold_quantity: 3, status: "active", listing_type_id: "gold_special", permalink: "https://produto.mercadolivre.com.br/MLB-222", thumbnail: "http://x/b.jpg", condition: "new", health: 0.7, seller_custom_field: "M2M-HS", attributes: [], date_created: "2026-01-01T00:00:00Z", last_updated: iso(1), shipping: { free_shipping: false } },
};
items.MLB1234567 = { ...items.MLB222, id: "MLB1234567", title: "Ímã concorrente", price: 32.9, sold_quantity: 500, seller_id: 42 };
// pedidos: 2 dias atrás (2 un MLB111), 1 dia atrás (1 un MLB222 + 1 un MLB111), 3 dias atrás cancelado
const orders = [
  { id: 5001, status: "paid", date_created: iso(2), date_closed: iso(2), last_updated: iso(2), total_amount: 90, currency_id: "BRL", buyer: { id: 1, nickname: "C1" }, shipping: { id: 9001 }, payments: [{ status: "approved", transaction_amount: 90 }], order_items: [{ item: { id: "MLB111", title: items.MLB111.title, category_id: "MLB1234", seller_sku: "M2M-LARKM2" }, quantity: 2, unit_price: 45, sale_fee: 12.55, listing_type_id: "gold_special" }] },
  { id: 5002, status: "paid", date_created: iso(1), date_closed: iso(1), last_updated: iso(1), total_amount: 104.9, currency_id: "BRL", buyer: { id: 2, nickname: "C2" }, shipping: { id: 9002 }, payments: [{ status: "approved", transaction_amount: 104.9 }], order_items: [
    { item: { id: "MLB222", title: items.MLB222.title, category_id: "MLB9999" }, quantity: 1, unit_price: 59.9, sale_fee: 14.64 },
    { item: { id: "MLB111", title: items.MLB111.title, category_id: "MLB1234" }, quantity: 1, unit_price: 45, sale_fee: 12.55 }] },
  { id: 5003, status: "cancelled", date_created: iso(3), last_updated: iso(3), total_amount: 45, currency_id: "BRL", buyer: { id: 3, nickname: "C3" }, payments: [{ status: "cancelled" }], order_items: [{ item: { id: "MLB111", title: items.MLB111.title }, quantity: 1, unit_price: 45, sale_fee: 12.55 }] },
];
const day = (d) => new Date(now - d * 86400000 - 3 * 3600000).toISOString().slice(0, 10);

function json(res, code, body) { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }
function sse(res, text, model = "claude-opus-5-5") {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev("message_start", { message: { id: "msg_mock", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 50 } });
  ev("message_stop", {});
  res.end();
}
const DIAG = { resumo_executivo: "Resumo de teste.", nota_saude_empresa: 42, o_que_fazer_hoje: [{ prioridade: 1, acao: "Cadastrar custos", motivo: "sem custos", impacto: "permite lucro", requer_aprovacao: false }], onde_perdemos_dinheiro: [], produtos_para_fabricar: [], produtos_para_parar_ou_rever: [], anuncios_para_melhorar: [], produto_para_investir: [], investimento_publicidade: [], quando_comprar_impressora: { texto: "Ainda não", tipo: "HIPÓTESE", gatilho: "ocupação > 80%" }, bloqueios_crescimento: [], plano_20k: [], dados_faltantes: ["custos"] };
const COPY = { titulos: ["Título A", "Título B", "Título C"], descricao: "Descrição", palavras_chave: ["ima"], ficha_tecnica: [{ atributo: "Material", valor: "PLA", confirmar: true }], diferenciais: ["x"], perguntas_frequentes: [{ pergunta: "?", resposta: "!" }], sugestao_kits: [], estrategia_posicionamento: "p", observacoes_preco: "o", plano_fotos: [{ ordem: 1, tipo: "Fundo branco", descricao: "" }] };

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const entry = { method: req.method, path: u.pathname, query: u.search, body, auth: req.headers.authorization ?? null, xapikey: req.headers["x-api-key"] ?? null };
    log.push(entry);
    const p = u.pathname;
    if (p === "/__log") return json(res, 200, log);
    // ---------- Anthropic ----------
    if (p.startsWith("/v1/messages")) {
      const b = JSON.parse(body || "{}");
      const structured = !!b.output_config?.format;
      const schemaTxt = JSON.stringify(b.output_config?.format ?? "");
      let text = "**[REAL]** Resposta simulada da auditoria. **[RECOMENDAÇÃO]** Cadastre custos.";
      if (structured) text = JSON.stringify(schemaTxt.includes("nota_saude_empresa") ? DIAG : schemaTxt.includes("titulos") ? COPY : schemaTxt.includes("candidatos") ? { candidatos: [], limitacoes: ["mock"] } : {});
      if (b.stream) return sse(res, text);
      return json(res, 200, { id: "msg_mock", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
    }
    // ---------- Mercado Livre ----------
    if (p === "/oauth/token") {
      const f = new URLSearchParams(body);
      if (f.get("grant_type") === "authorization_code" && f.get("code") !== "CODE-OK") return json(res, 400, { message: "invalid_grant" });
      return json(res, 200, { access_token: "APP_USR-ACCESS", refresh_token: "TG-REFRESH", expires_in: 21600, user_id: 555, scope: "offline_access read write", token_type: "Bearer" });
    }
    if (entry.auth !== "Bearer APP_USR-ACCESS" && !p.startsWith("/sites") && !p.startsWith("/categories")) return json(res, 401, { message: "invalid_token" });
    if (p === "/users/me") return json(res, 200, { id: 555, nickname: "MIND2MATTER", site_id: "MLB" });
    if (p === "/users/555") return json(res, 200, { id: 555, nickname: "MIND2MATTER", site_id: "MLB", seller_reputation: { level_id: "4_light_green" } });
    if (p === "/users/555/items/search") return json(res, 200, { results: u.searchParams.get("status") === "active" && !u.searchParams.get("scroll_id") ? ["MLB111", "MLB222"] : [] });
    if (p === "/items" && req.method === "GET") return json(res, 200, (u.searchParams.get("ids") ?? "").split(",").filter((i) => items[i]).map((i) => ({ code: 200, body: items[i] })));
    if (p.startsWith("/items/") && req.method === "PUT") { const id = p.split("/")[2]; Object.assign(items[id], JSON.parse(body)); return json(res, 200, items[id]); }
    if (p.match(/^\/items\/MLB\d+$/) && req.method === "GET") return json(res, 200, items[p.split("/")[2]]);
    if (p === "/orders/search") return json(res, 200, { results: orders, paging: { total: orders.length } });
    if (p.match(/^\/shipments\/\d+\/costs$/)) return json(res, 200, { senders: [{ cost: 0 }] });
    if (p.match(/^\/shipments\/\d+$/)) return json(res, 200, { id: Number(p.split("/")[2]), status: "shipped", substatus: null, logistic_type: "xd_drop_off", tracking_number: "BR123", date_created: iso(1) });
    if (p === "/questions/search") return json(res, 200, { questions: [{ id: 777, item_id: "MLB111", text: "Serve no Lark M2?", status: "UNANSWERED", date_created: iso(0), from: { id: 9 } }], total: 1 });
    if (p === "/users/555/items_visits/time_window") return json(res, 200, { results: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ date: day(d) + "T00:00:00Z", total: 20 })) });
    if (p.match(/^\/items\/MLB\d+\/visits\/time_window$/)) return json(res, 200, { results: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ date: day(d) + "T00:00:00Z", total: p.includes("111") ? 15 : 5 })) });
    if (p.startsWith("/categories/")) return json(res, 200, { id: p.split("/")[2], name: p.includes("1234") ? "Acessórios para Microfones" : "Suportes", path_from_root: [] });
    return json(res, 404, { message: "not mocked", path: p });
  });
}).listen(4200, () => console.log("mock on 4200"));
