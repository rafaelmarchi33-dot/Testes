// Auditoria de API contra o servidor real (porta 4100) + mock ML/IA (porta 4200).
import fs from "node:fs";
import crypto from "node:crypto";
const BASE = "http://localhost:4100/api";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out"); fs.mkdirSync(OUT, { recursive: true });
// Diretório opcional com relatórios reais da loja (desempenho.xlsx e vendas.pdf). Sem ele, esses testes são pulados.
const UP = process.env.AUDIT_FILES ?? "";
const HAS_FILES = UP && fs.existsSync(`${UP}/desempenho.xlsx`) && fs.existsSync(`${UP}/vendas.pdf`);
const results = [];
let section = "";
const sec = (s) => { section = s; };
const check = (name, ok, detail = "") => { results.push({ section, name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 300) }); };
const near = (a, b, tol = 0.011) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

class Client {
  constructor() { this.cookie = ""; }
  async req(path, { method = "GET", body, form, csrf = true, raw = false } = {}) {
    const headers = {};
    if (csrf) headers["X-Requested-With"] = "mli";
    if (this.cookie) headers.cookie = this.cookie;
    let b;
    if (form) b = form; else if (body !== undefined) { headers["content-type"] = "application/json"; b = JSON.stringify(body); }
    const r = await fetch(BASE + path, { method, headers, body: b, redirect: "manual" });
    const sc = r.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    if (raw) return r;
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, headers: r.headers };
  }
  get(p) { return this.req(p); }
  post(p, body = {}) { return this.req(p, { method: "POST", body }); }
  put(p, body) { return this.req(p, { method: "PUT", body }); }
  patch(p, body) { return this.req(p, { method: "PATCH", body }); }
  del(p, body = { confirm: true }) { return this.req(p, { method: "DELETE", body }); }
}
const mockLog = async () => (await fetch("http://localhost:4200/__log")).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = new Client();
const anon = new Client();

// ================= AUTENTICAÇÃO E CONTROLE DE ACESSO =================
sec("Autenticação e acesso");
check("Rota protegida sem sessão → 401", (await anon.get("/overview")).status === 401);
check("Status inicial pede configuração", (await anon.get("/auth/status")).body?.needsSetup === true);
check("Senha curta rejeitada", (await anon.post("/auth/setup", { name: "A", email: "a@a.com", password: "123" })).status === 400);
let r = await admin.post("/auth/setup", { name: "Admin Auditoria", email: "admin@example.com", password: "senha-forte-123" });
check("Criação do administrador", r.status === 200, JSON.stringify(r.body));
check("Segunda configuração bloqueada", (await anon.post("/auth/setup", { name: "Xavier", email: "x@x.com", password: "senha-forte-123" })).status === 409);
check("POST sem cabeçalho anti-CSRF → 403", (await admin.req("/goals", { method: "POST", body: { name: "x", target_revenue: 1 }, csrf: false })).status === 403);
check("Login com senha errada → 401", (await new Client().post("/auth/login", { email: "admin@example.com", password: "errada-errada" })).status === 401);
r = await admin.post("/users", { name: "Operador", email: "op@example.com", password: "senha-forte-123", role: "operator" });
check("Admin cria operador", r.status === 200, JSON.stringify(r.body));
r = await admin.post("/users", { name: "Leitor", email: "ro@example.com", password: "senha-forte-123", role: "viewer" });
check("Admin cria usuário de leitura", r.status === 200, JSON.stringify(r.body));
const op = new Client(); await op.post("/auth/login", { email: "op@example.com", password: "senha-forte-123" });
const ro = new Client(); await ro.post("/auth/login", { email: "ro@example.com", password: "senha-forte-123" });
check("Leitura acessa visão geral", (await ro.get("/overview")).status === 200);
check("Leitura NÃO altera custos (403)", (await ro.put("/finance/cost-config", { tax_pct: 1 })).status === 403);
check("Leitura NÃO cria ordem de produção (403)", (await ro.post("/factory/orders", { name: "x", quantity: 1 })).status === 403);
check("Operador NÃO altera custos (somente admin)", (await op.put("/finance/cost-config", { tax_pct: 1 })).status === 403);
check("Operador NÃO aprova ações", (await op.post("/actions/1/approve", { confirm: true })).status === 403);
check("Operador NÃO desfaz importação", (await op.post("/imports/1/undo", { confirm: true })).status === 403);
check("Exclusão sem confirmação explícita é rejeitada", (await admin.req("/goals/2", { method: "DELETE", body: {} })).status === 400);

// ================= DADOS INICIAIS =================
sec("Dados iniciais");
const company = (await admin.get("/company")).body;
check("Empresa: 95 anúncios, meta 20 mil, faixa 1–3 mil", company.listings_identified === 95 && company.monthly_goal === 20000 && company.monthly_revenue_min === 1000 && company.monthly_revenue_max === 3000);
const reps = (await admin.get("/period-reports")).body;
check("Relatório 19–26/11 com R$ 1.872, 39 un., 37 vendas, 534 visitas, 6,9%", reps[0]?.gross_sales === 1872 && reps[0].units === 39 && reps[0].sales_count === 37 && reps[0].visits === 534 && reps[0].conversion_pct === 6.9);
check("Relatório marcado como importação inicial", reps[0]?.source === "initial_import");
const prodsInit = (await admin.get("/products")).body;
const holly = prodsInit.find((p) => p.name.includes("Hollyland"));
check("Ímã Lark M2 sem estoque físico inventado", holly && holly.stock_qty === 0);
check("Impressora A1 Combo cadastrada", (await admin.get("/factory/machines")).body[0]?.model === "Bambu Lab A1 Combo");
const ovEmpty = (await admin.get("/overview?period=7d")).body;
check("Sem dados no período: gráfico diário pendente (null), não inventado", ovEmpty.charts.daily === null && ovEmpty.kpis.revenue === 0);
check("Lucro pendente sem custos", ovEmpty.kpis.estimated_profit === null);

// ================= MERCADO LIVRE (OAuth real + sincronização) =================
sec("Integração Mercado Livre");
let st = (await admin.get("/ml/status")).body;
check("Status inicial: não conectado", st.state === "not_connected", st.state);
r = await admin.get("/ml/oauth/start");
const authUrl = new URL(r.body.url);
check("Início do OAuth gera URL de autorização", authUrl.pathname === "/authorization" && authUrl.searchParams.get("client_id") === "AUDIT-CLIENT" && authUrl.searchParams.get("response_type") === "code");
check("PKCE S256 presente", authUrl.searchParams.get("code_challenge_method") === "S256" && (authUrl.searchParams.get("code_challenge") ?? "").length >= 43);
check("Operador não inicia OAuth (somente admin)", (await op.get("/ml/oauth/start")).status === 403);
st = (await admin.get("/ml/status")).body;
check("Status: aguardando autorização", st.state === "awaiting_authorization", st.state);
let cb = await anon.req(`/ml/oauth/callback?code=CODE-OK&state=estado-falso`, { csrf: false, raw: true });
check("Callback com state inválido é recusado", (cb.headers.get("location") ?? "").includes("ml=error"));
cb = await anon.req(`/ml/oauth/callback?code=CODE-OK&state=${authUrl.searchParams.get("state")}`, { csrf: false, raw: true });
check("Callback válido conecta a conta", (cb.headers.get("location") ?? "").includes("ml=connected"), cb.headers.get("location"));
const ml1 = await mockLog();
const tokenReq = ml1.find((e) => e.path === "/oauth/token");
const tokForm = new URLSearchParams(tokenReq?.body ?? "");
const verifier = tokForm.get("code_verifier") ?? "";
check("Troca de código envia client_secret e code_verifier", tokForm.get("client_secret") === "AUDIT-SECRET" && verifier.length >= 43);
check("code_verifier corresponde ao code_challenge (PKCE verificado)", crypto.createHash("sha256").update(verifier).digest("base64url") === authUrl.searchParams.get("code_challenge"));
check("Reuso do mesmo state é bloqueado", ((await anon.req(`/ml/oauth/callback?code=CODE-OK&state=${authUrl.searchParams.get("state")}`, { csrf: false, raw: true })).headers.get("location") ?? "").includes("ml=error"));
for (let i = 0; i < 30; i++) { const s = (await admin.get("/ml/status")).body; if ((s.sync ?? []).some((x) => x.resource === "orders" && x.status === "ok")) break; await sleep(300); }
st = (await admin.get("/ml/status")).body;
check("Status: conectado", st.state === "connected", st.state);
check("Tokens não expostos ao frontend", !JSON.stringify(st).includes("APP_USR-ACCESS") && !JSON.stringify(st).includes("TG-REFRESH"));
check("Chamadas à API usam o token Bearer", (await mockLog()).filter((e) => e.path === "/orders/search").every((e) => e.auth === "Bearer APP_USR-ACCESS"));
check("Sincronização de anúncios e pedidos concluída", ["listings", "orders"].every((k) => st.sync.find((x) => x.resource === k)?.status === "ok"), JSON.stringify(st.sync));
const orders = (await admin.get("/orders?period=30d")).body;
check("Pedidos sincronizados (2 pagos + 1 cancelado)", orders.length === 3 && orders.filter((o) => o.status === "paid").length === 2);
check("Pergunta sem resposta sincronizada", (await admin.get("/questions")).body.length === 1);

// ================= DADOS COMPARTILHADOS ENTRE MÓDULOS =================
sec("Dados compartilhados entre módulos");
const expectedRevenue = 90 + 104.9;
const ov7 = (await admin.get("/overview?period=7d&channel=all")).body;
check("Visão geral: faturamento = soma dos pedidos pagos (194,90)", near(ov7.kpis.revenue, expectedRevenue), ov7.kpis.revenue);
check("Visão geral: pedidos=2, unidades=4 (cancelado excluído)", ov7.kpis.orders === 2 && ov7.kpis.units === 4, `${ov7.kpis.orders}/${ov7.kpis.units}`);
check("Ticket médio = faturamento ÷ pedidos", near(ov7.kpis.avg_ticket, expectedRevenue / 2));
check("Visitas sincronizadas (7 dias × 20) e conversão = pedidos ÷ visitas", ov7.kpis.visits === 140 && near(ov7.kpis.conversion_pct, (2 / 140) * 100), `${ov7.kpis.visits} ${ov7.kpis.conversion_pct}`);
check("Gráfico diário com dados reais", Array.isArray(ov7.charts.daily) && near(ov7.charts.daily.reduce((s, d) => s + d.revenue, 0), expectedRevenue));
check("Produtos mais vendidos vêm dos pedidos", ov7.charts.top_sold?.[0]?.units === 3);
const center = (await admin.get("/listings-center?period=7d&channel=all")).body;
const c111 = center.rows.find((x) => x.id === "MLB111");
check("Central de anúncios: MLB111 com 3 un. e 2 pedidos no período", c111?.units_period === 3 && c111.orders_period === 2, JSON.stringify(c111 && [c111.units_period, c111.orders_period]));
check("Central: visitas do anúncio no período (7×15)", c111?.visits === 105, c111?.visits);
const goal = (await admin.get("/goals/progress")).body;
const monthOrders = orders.filter((o) => o.status === "paid" && new Date(new Date(o.date_created).getTime() - 3 * 3600000).toISOString().slice(0, 7) === goal.month).reduce((s, o) => s + o.total_amount, 0);
check("Meta: pedidos do mês entram no progresso", near(goal.from_orders, monthOrders), `${goal.from_orders} vs ${monthOrders}`);
const dre = (await admin.get(`/finance/dre?month=${goal.month}`)).body;
check("DRE: receita bruta = faturamento do mês da meta", near(dre.lines[0].value, goal.revenue), `${dre.lines[0].value} vs ${goal.revenue}`);
check("DRE: tarifas reais dos pedidos (12,55×3 + 14,64)", near(-dre.lines[1].value, 12.55 * 3 + 14.64), dre.lines[1].value);
const ctx = (await admin.get("/mind/context")).body;
check("Contexto da IA contém a empresa e os mesmos KPIs", ctx.empresa?.name === "Mind2Matter" && near(ctx.visao_geral_30d?.kpis?.revenue, (await admin.get("/overview?period=30d")).body.kpis.revenue));
check("Contexto da IA contém anúncios sincronizados", ctx.central_de_anuncios.anuncios.some((a) => a.id === "MLB111"));
check("Contexto da IA não contém apelidos de compradores", !JSON.stringify(ctx).includes("\"C1\"") && !JSON.stringify(ctx).includes("nickname\":\"C2"));
const prods = (await admin.get("/products")).body;
const p111 = prods.find((p) => p.sku === "M2M-LARKM2");
check("Anúncio sincronizado vinculado a produto por SKU", !!p111);

// ================= FINANCEIRO =================
sec("Cálculos financeiros");
r = await admin.put("/finance/cost-config", { filament_price_per_kg: { PLA: 110, PETG: 130 }, energy_kwh_price: 0.95, printer_power_watts: 120, depreciation_per_hour: 0.6, maintenance_per_hour: 0.25, labor_per_hour: 25, labor_minutes_per_unit: 5, packaging_per_unit: 1.5, finishing_per_unit: 0.5, failure_rate_pct: 5, ads_pct: 0, tax_pct: 6, seller_shipping_per_unit: 0, monthly_fixed_costs: 600, target_margin_pct: 30, promo_margin_pct: 15 });
check("Admin salva cadastro de custos", r.status === 200);
check("Admin salva tarifas do canal", (await admin.put("/channels/mercadolivre", { fee_pct: 14, fixed_fee: 6.25, shipping_cost: 0 })).status === 200);
r = await admin.post("/finance/calc3d", { input: { weight_g: 18, print_minutes: 45, material: "PLA", sale_price: 45 }, channel: "mercadolivre" });
const c = r.body.calc;
// cálculo independente
const h = 45 / 60;
const fil = 18 * 1.05 / 1000 * 110, en = 0.12 * h * 0.95, dep = h * 0.6, man = h * 0.25, labr = 5 / 60 * 25, fin = 0.5;
const prodCost = fil + en + dep + man + labr + fin;
const variable = prodCost + 1.5 + 0 + 0 + 45 * 0.14 + 6.25 + 0 + 45 * 0.06;
const contrib = 45 - variable;
check("Filamento = peso × (1+perdas) × R$/kg", near(c.filament_cost, fil), `${c.filament_cost} vs ${fil}`);
check("Energia = kW × h × R$/kWh", near(c.energy_cost, en), `${c.energy_cost} vs ${en}`);
check("Custo de produção", near(c.production_cost, prodCost), `${c.production_cost} vs ${prodCost}`);
check("Custo variável total", near(c.total_variable_cost, variable), `${c.total_variable_cost} vs ${variable}`);
check("Margem de contribuição", near(c.contribution_margin, contrib), `${c.contribution_margin} vs ${contrib}`);
check("Margem %", near(c.margin_pct, contrib / 45 * 100, 0.02));
const fixedVar = prodCost + 1.5 + 6.25;
check("Preço mínimo zera a margem", near(c.min_price, fixedVar / (1 - 0.14 - 0.06), 0.011), `${c.min_price}`);
check("Preço recomendado = margem-alvo 30%", near(c.recommended_price, fixedVar / (1 - 0.14 - 0.06 - 0.30), 0.011));
check("Preço promocional = margem 15%", near(c.promo_price, fixedVar / (1 - 0.14 - 0.06 - 0.15), 0.011));
check("Lucro por hora de impressão", near(c.profit_per_print_hour, contrib / h, 0.02));
check("Ponto de equilíbrio = ceil(fixos ÷ contribuição)", c.break_even_units === Math.ceil(600 / c.contribution_margin));
check("Cenário 100 un.: contribuição ×100, filamento 1,8 kg", near(r.body.scenarios.find((s) => s.units === 100).contribution, c.contribution_margin * 100, 0.6) && near(r.body.scenarios.find((s) => s.units === 100).filament_kg, 1.8));
check("Cadastro completo: nenhum item pendente", c.complete === true, c.missing);
r = await admin.post("/finance/calc3d/save", { product_id: p111.id, input: { weight_g: 18, print_minutes: 45, material: "PLA", sale_price: 45 } });
check("Calculadora salva ficha de custos no produto", r.status === 200);
const center2 = (await admin.get("/listings-center?period=7d")).body;
const c111b = center2.rows.find((x) => x.id === "MLB111");
check("Central usa a ficha: margem do anúncio = margem da calculadora", near(c111b.margin_pct, c.margin_pct, 0.05), `${c111b.margin_pct} vs ${c.margin_pct}`);
const prof = (await admin.get("/finance/profitability?period=7d")).body;
const pr111 = prof.rows.find((x) => x.listing_id === "MLB111");
const realProfit = 3 * 45 - 3 * 12.55 - 3 * (prodCost + 1.5 + 0) - 3 * 45 * 0.06;
check("Rentabilidade real usa tarifa cobrada no pedido", near(pr111?.profit, realProfit, 0.05), `${pr111?.profit} vs ${realProfit}`);
const ov7b = (await admin.get("/overview?period=7d")).body;
check("Visão geral passa a mostrar lucro estimado (só dos itens com custo)", near(ov7b.kpis.estimated_profit, pr111.profit, 0.05) && ov7b.kpis.profit_coverage_pct < 100);
check("Faturamento ≠ lucro", ov7b.kpis.estimated_profit < ov7b.kpis.revenue);
const rank = (await admin.get("/finance/ranking")).body;
check("Ranking de rentabilidade usa o mesmo cálculo", near(rank.find((x) => x.id === p111.id)?.calc?.margin_pct, c.margin_pct, 0.05));
check("Despesa lançada entra na DRE", (await admin.post("/expenses", { date: `${goal.month}-01`, category: "Aluguel", amount: 300 })).status === 200 && (await admin.get(`/finance/dre?month=${goal.month}`)).body.lines.find((l) => l.key === "expenses").value === -300);

// ================= FILTROS =================
sec("Filtros globais");
const ovS = (await admin.get("/overview?period=7d&channel=shopee")).body;
check("Canal Shopee exclui vendas do Mercado Livre", ovS.kpis.revenue === 0 && ovS.charts.daily === null, ovS.kpis.revenue);
const ovT = (await admin.get("/overview?period=today")).body;
check("Hoje: compara com ontem (período anterior de 1 dia)", ovT.range.days === 1 && ovT.previous.days === 1);
const ovM = (await admin.get("/overview?period=month")).body;
check("Mês atual: compara com o mesmo intervalo do mês anterior", ovM.range.from.endsWith("-01") && ovM.previous.from.endsWith("-01") && ovM.previous.days === ovM.range.days);
const ovC = (await admin.get("/overview?period=custom&from=2026-11-19&to=2026-11-26")).body;
const paidDays = new Set(orders.filter((o) => o.status === "paid").map((o) => new Date(new Date(o.date_created).getTime() - 3 * 3600000).toISOString().slice(0, 10)));
check("Personalizado 19–26/11: pedidos reais têm prioridade e o relatório agregado não é somado", ovC.data_source === "orders" && near(ovC.kpis.revenue, expectedRevenue), `${ovC.data_source} ${ovC.kpis.revenue}`);
const ovR = (await admin.get("/overview?period=custom&from=2026-11-19&to=2026-11-21")).body;
check("Período sem pedidos e sem métricas: nada é estimado a partir do relatório de 8 dias", ovR.kpis.revenue === 0 && ovR.data_source === "none", `${ovR.data_source} ${ovR.kpis.revenue}`);
check("Período inválido → 400", (await admin.get("/overview?period=custom&from=xx&to=yy")).status === 400);
const cS = (await admin.get("/listings-center?period=7d&channel=shopee")).body;
check("Central de anúncios respeita canal", cS.rows.every((x) => x.channel === "shopee"));
const cC = (await admin.get("/listings-center?period=custom&from=2026-11-19&to=2026-11-20")).body;
check("Central de anúncios respeita período personalizado", cC.from === "2026-11-19" && cC.to === "2026-11-20" && cC.rows.find((x) => x.id === "MLB111")?.units_period === 0);
check("Publicidade respeita período", (await admin.get("/marketing/ads?period=custom&from=2026-01-01&to=2026-01-31")).body.range.from === "2026-01-01");

// ================= IMPORTAÇÃO =================
sec("Importação de relatórios");
const up = async (file, name, kind = "auto") => { const f = new FormData(); f.append("file", new Blob([fs.readFileSync(file)]), name); f.append("kind", kind); return admin.req("/imports", { method: "POST", form: f }); };
if (HAS_FILES) {
r = await up(`${UP}/desempenho.xlsx`, "Relatorio_desempenho.xlsx");
check("XLSX real do ML detectado como métricas diárias", r.body.kind === "daily_metrics", r.body.kind);
check("8 dias válidos, linha de totais ignorada", r.body.totals?.rows === 8 && r.body.totals.valid === 8, JSON.stringify(r.body.totals));
const impId = r.body.import_id;
r = await admin.post(`/imports/${impId}/commit`, { kind: "daily_metrics", mapping: r.body.mapping, confirm: true });
check("Importação efetivada", r.body.imported === 8, JSON.stringify(r.body));
const ovX = (await admin.get("/overview?period=custom&from=2026-11-19&to=2026-11-26")).body;
const MET = { "2026-11-19": [357.89, 6], "2026-11-20": [190, 4], "2026-11-21": [47.5, 1], "2026-11-22": [47.5, 1], "2026-11-23": [312.83, 7], "2026-11-24": [368.14, 8], "2026-11-25": [322.65, 5], "2026-11-26": [225, 5] };
const expMixed = expectedRevenue + Object.entries(MET).filter(([d]) => !paidDays.has(d)).reduce((s, [, v]) => s + v[0], 0);
const expOrders = 2 + Object.entries(MET).filter(([d]) => !paidDays.has(d)).reduce((s, [, v]) => s + v[1], 0);
check("Visão geral combina pedidos + métricas dos dias sem pedidos (sem dupla contagem)", ovX.data_source === "mixed" && near(ovX.kpis.revenue, expMixed) && ovX.kpis.orders === expOrders, `${ovX.data_source} ${ovX.kpis.revenue} vs ${expMixed}; ${ovX.kpis.orders} vs ${expOrders}`);
const gX = (await admin.get("/goals/progress")).body;
check("Meta usa a mesma regra de combinação", gX.month !== "2026-11" || near(gX.from_orders + gX.from_metrics, expMixed + (gX.from_orders - expectedRevenue)), JSON.stringify([gX.from_orders, gX.from_metrics, gX.from_reports]));
check("Gráfico diário: dia com pedidos usa pedidos, demais usam métricas", ovX.charts.daily.every((d) => paidDays.has(d.date) ? true : near(d.revenue, MET[d.date][0])));
check("Sem dupla contagem com o relatório agregado", near((await admin.get("/goals/progress")).body.from_reports, 0) || goal.month !== "2026-11");
r = await up(`${UP}/desempenho.xlsx`, "Relatorio_desempenho.xlsx");
check("Reimportação: todas as datas marcadas como duplicadas", r.body.totals.duplicates === 8 && r.body.totals.valid === 0);
r = await up(`${UP}/vendas.pdf`, "vendas.pdf");
check("PDF de etiquetas reconhecido e não importado", (r.body.pdf_note ?? "").includes("etiquetas"));
check("Commit de PDF sem métricas é recusado", (await admin.post(`/imports/${r.body.import_id}/commit`, { kind: "period_report", confirm: true })).status === 400);
} else console.log("(AUDIT_FILES não definido: testes com relatórios reais pulados)");
const csv = "N.º de venda;Data da venda;Estado;Unidades;Receita por produtos (BRL);SKU;Título do anúncio;Canal de venda\nSHP-001;20/11/2026 10:00;Concluído;2;80,00;M2M-HS;Suporte headset;Shopee\nSHP-002;21/11/2026;Cancelado;1;40,00;M2M-HS;Suporte headset;Shopee\nSHP-003;99/99/2026;Concluído;1;40,00;;;Shopee\n";
fs.writeFileSync(`${OUT}/shopee.csv`, csv);
r = await up(`${OUT}/shopee.csv`, "shopee.csv");
check("CSV de vendas: tipo detectado e linha inválida apontada", r.body.kind === "orders" && r.body.totals.valid === 2 && r.body.totals.with_errors === 1, JSON.stringify(r.body.totals));
const csvId = r.body.import_id;
// correção manual de mapeamento: remove o SKU
const m2 = { ...r.body.mapping, sku: null };
const pv = await admin.post(`/imports/${csvId}/preview`, { kind: "orders", mapping: m2 });
check("Mapeamento corrigido manualmente é respeitado", pv.body.mapping.sku === null && pv.body.rows[0].values.sku === null);
r = await admin.post(`/imports/${csvId}/commit`, { kind: "orders", mapping: r.body.mapping, confirm: true });
check("Pedidos Shopee importados", r.body.imported === 2);
const ovSh = (await admin.get("/overview?period=custom&from=2026-11-19&to=2026-11-26&channel=shopee")).body;
check("Filtro Shopee mostra só a venda paga importada (R$ 80)", near(ovSh.kpis.revenue, 80) && ovSh.kpis.orders === 1, ovSh.kpis.revenue);
check("Usuário de leitura não importa", (await (async () => { const f = new FormData(); f.append("file", new Blob(["a"]), "a.csv"); return ro.req("/imports", { method: "POST", form: f }); })()).status === 403);
r = await admin.post(`/imports/${csvId}/undo`, { confirm: true });
check("Desfazer remove os pedidos importados", r.body.removed?.orders === 2 && (await admin.get("/overview?period=custom&from=2026-11-19&to=2026-11-26&channel=shopee")).body.kpis.revenue === 0);
const hist = (await admin.get("/imports")).body;
check("Histórico registra status (importado/desfeito/prévia)", hist.some((x) => x.status === "undone") && hist.some((x) => x.status === "imported"));

// ================= PRODUÇÃO =================
sec("Mind Factory");
r = await admin.post("/factory/filaments", { brand: "Bambu", material: "PLA", color: "Preto", total_g: 500, available_g: 500, min_g: 200, cost_per_kg: 110 });
const filId = r.body.id;
check("Rolo de filamento cadastrado", r.status === 200);
check("Peso disponível > total é rejeitado", (await admin.post("/factory/filaments", { material: "PLA", total_g: 100, available_g: 200 })).status === 400);
r = await admin.post("/factory/orders", { product_id: p111.id, name: "Ímã Lark M2", quantity: 10, filament_id: filId, machine_id: 1, due_date: "2026-01-01", priority: "high", sale_price_unit: 45 });
const poId = r.body.id;
const po = (await admin.get("/factory/orders?status=all")).body.find((x) => x.id === poId);
check("OP herda peso/tempo/material do produto", po.weight_g_unit === 18 && po.minutes_unit === 45 && po.material === "PLA" && po.total_minutes === 450 && po.total_grams === 180);
const plan = (await admin.get("/factory/planner")).body;
check("Planejador aponta risco de atraso (prazo vencido)", plan.at_risk.some((x) => x.id === poId));
check("Planejador calcula filamento necessário", plan.filament_needs.some((f) => f.material === "PLA" && f.grams === 180));
check("Transição inválida (aguardando → concluída) bloqueada", (await admin.post(`/factory/orders/${poId}/status`, { status: "done", confirm: true })).status === 409);
check("Mudança de status exige confirmação", (await admin.post(`/factory/orders/${poId}/status`, { status: "printing" })).status === 400);
await admin.post(`/factory/orders/${poId}/status`, { status: "printing", confirm: true });
const stockBefore = (await admin.get("/products")).body.find((p) => p.id === p111.id).stock_qty;
r = await admin.post(`/factory/orders/${poId}/status`, { status: "done", failed_units: 1, confirm: true });
check("Conclusão baixa filamento e soma horas", r.body.effects.some((e) => e.includes("180 g")) && r.body.effects.some((e) => e.includes("7.5 h")), r.body.effects);
check("Saldo do rolo atualizado (500 − 180)", (await admin.get("/factory/filaments")).body.find((f) => f.id === filId).available_g === 320);
const stockAfter = (await admin.get("/products")).body.find((p) => p.id === p111.id).stock_qty;
check("Estoque do produto recebe 9 un. boas", stockAfter - stockBefore === 9, `${stockBefore}→${stockAfter}`);
const ovOcc = (await admin.get("/overview?period=7d")).body;
check("Horas de impressão e ocupação aparecem na visão geral", near(ovOcc.operational.print_hours, 7.5) && ovOcc.operational.occupancy_pct > 0);
await admin.post(`/factory/filaments/${filId}/movements`, { type: "consumption", grams: 150, confirm: true });
await admin.post("/alerts/evaluate", {});
check("Alerta de filamento abaixo do mínimo", (await admin.get("/alerts")).body.some((a) => a.type === "filament_low"));
check("Manutenção registrada", (await admin.post("/factory/machines/1/maintenance", { date: "2026-11-20", type: "Limpeza" })).status === 200 && (await admin.get("/factory/machines/1/maintenance")).body.length === 1);

// ================= RADAR, LABORATÓRIO, CONCORRÊNCIA =================
sec("Radar, laboratório e concorrência");
r = await admin.post("/radar", { name: "Suporte de microfone", category_name: "Microfones e áudio", competitor_prices: [29.9, 39.9, 49.9], sold_signal: null, demand_level: "média", weight_g: 35, print_minutes: 70, difficulty: "baixa", differentiation: "média", competition_level: "média" });
const opp = (await admin.get("/radar")).body.items.find((o) => o.id === r.body.id);
const est = (await admin.post("/finance/calc3d", { input: { weight_g: 35, print_minutes: 70, material: "PLA", sale_price: 39.9 }, channel: "mercadolivre" })).body.calc;
check("Radar: margem estimada = calculadora no preço mediano observado", near(opp.margin_pct, est.margin_pct, 0.05), `${opp.margin_pct} vs ${est.margin_pct}`);
check("Radar: nota soma os critérios", opp.score === Math.round(opp.scores.parts.reduce((s, p) => s + p.points, 0)) && opp.score <= 100);
check("Radar separa observado de estimado", opp.observed.price_median === 39.9 && opp.estimates.weight_g === 35);
r = await admin.post(`/radar/${opp.id}/to-lab`, {});
const labId = r.body.lab_product_id;
check("Radar → laboratório", r.status === 200 && (await admin.get(`/lab/${labId}`)).body.status === "research");
const fd = new FormData(); fd.append("files", new Blob(["solid test\nendsolid"]), "peca.stl"); fd.append("files", new Blob(["x"]), "malware.exe");
r = await admin.req(`/lab/${labId}/files`, { method: "POST", form: fd });
check("Upload aceita STL e ignora extensão não permitida", r.body.count === 1, JSON.stringify(r.body));
const lab = (await admin.get(`/lab/${labId}`)).body;
check("Arquivo STL baixável por usuário autenticado", (await admin.req(`/lab-files/${lab.files[0].filename}`, { raw: true })).status === 200);
check("Arquivo NÃO acessível sem sessão", (await anon.req(`/lab-files/${lab.files[0].filename}`, { raw: true })).status === 401);
check("Conversão de produto não aprovado bloqueada", (await admin.post(`/lab/${labId}/convert`, { confirm: true })).status === 409);
await admin.put(`/lab/${labId}`, { ...lab, files: undefined, events: undefined, id: undefined, created_at: undefined, updated_at: undefined, created_by: undefined, opportunity_id: undefined, product_id: undefined, status: "approved", sku: "M2M-MIC-01" });
r = await admin.post(`/lab/${labId}/convert`, { confirm: true });
check("Produto aprovado vira cadastro comercial", r.status === 200 && (await admin.get("/products")).body.some((p) => p.sku === "M2M-MIC-01"), JSON.stringify(r.body));
check("Histórico do laboratório registra mudanças", (await admin.get(`/lab/${labId}`)).body.events.length >= 3);
r = await admin.post("/competitors", { name: "Loja X", product: "Ímã Lark", price: 30, our_listing_id: "MLB111" });
const comp = (await admin.get("/competitors")).body.find((x) => x.id === r.body.id);
check("Concorrência: compara com o preço real do nosso anúncio", comp.our_effective_price === 45 && near(comp.price_diff_pct, (30 - 45) / 45 * 100) && comp.flags.includes("preço muito abaixo do nosso"));
r = await admin.post("/competitors/import-links", { urls: ["https://produto.mercadolivre.com.br/MLB-1234567-ima"] });
check("Importação de link lê dados públicos pela API", r.body.results[0].status.includes("API oficial"), JSON.stringify(r.body));

// ================= IA =================
sec("Mind AI (contexto da empresa)");
const before = (await mockLog()).length;
r = await admin.post("/mind/chat", { agent: "mind", message: "Quanto faturamos nos últimos 7 dias?" });
check("Chat responde e cria conversa", r.status === 200 && r.body.conversation_id > 0 && r.body.answer.includes("[REAL]"), JSON.stringify(r.body).slice(0, 200));
const aiReq = (await mockLog()).slice(before).find((e) => e.path.startsWith("/v1/messages"));
const aiBody = JSON.parse(aiReq?.body ?? "{}");
const aiText = JSON.stringify(aiBody.messages ?? []);
check("Chamada à IA feita pelo backend com a chave do servidor", aiReq?.xapikey === "audit-key" || aiReq?.auth === "Bearer audit-key", JSON.stringify(aiReq && { a: aiReq.auth, k: aiReq.xapikey }));
check("IA recebe o snapshot da empresa (Mind2Matter, MLB111, meta 20000)", aiText.includes("snapshot_mind2matter") && aiText.includes("MLB111") && aiText.includes("20000"));
check("IA recebe regras de rotulagem real/estimativa/hipótese", String(aiBody.system).includes("[ESTIMATIVA]") && String(aiBody.system).includes("Nunca invente"));
const conv = (await admin.get(`/mind/conversations/${r.body.conversation_id}`)).body;
r = await admin.post("/mind/chat", { conversation_id: conv.id, message: "E a conversão?" });
const aiReq2 = (await mockLog()).filter((e) => e.path.startsWith("/v1/messages")).at(-1);
check("Histórico da conversa é enviado na pergunta seguinte", JSON.parse(aiReq2.body).messages.some((m) => typeof m.content === "string" && m.content.includes("Quanto faturamos")));
check("Conversa de outro usuário não é acessível", (await ro.get(`/mind/conversations/${conv.id}`)).status === 404);
r = await admin.post("/mind/diagnosis", {});
check("Diagnóstico do CEO estruturado e salvo", r.status === 200 && r.body.report?.nota_saude_empresa === 42 && (await admin.get("/mind/diagnosis")).body.id === r.body.id, JSON.stringify(r.body).slice(0, 200));
r = await admin.post("/marketing/generate", { product_id: p111.id });
const mk = (await admin.get(`/marketing/${r.body.id}`)).body;
check("Gerador de anúncio salva 3 títulos e plano de fotos", mk.content?.titulos?.length === 3 && mk.photo_plan.length >= 1, JSON.stringify(r.body).slice(0, 200));
check("Preço sugerido vem da calculadora (não da IA)", near(mk.content.pricing.preco_recomendado, c.recommended_price, 0.02), JSON.stringify(mk.content.pricing));
r = await admin.post("/routines/daily/run", {});
const run = (await admin.get(`/routine-runs/${r.body.id}`)).body;
check("Rotina diária com dados calculados + análise da IA", run.status === "ok" && run.data?.meta && run.ai_summary?.includes("[REAL]"), JSON.stringify(run).slice(0, 200));
check("Rotinas listam próxima execução", (await admin.get("/routines")).body.routines.every((x) => x.next_run_at));

// ================= APROVAÇÕES =================
sec("Aprovações e segurança comercial");
r = await op.post("/actions", { type: "update_price", payload: { listing_id: "MLB111", price: 47 } });
check("Operador solicita alteração de preço", r.status === 200);
const putsBefore = (await mockLog()).filter((e) => e.method === "PUT").length;
check("Nada é enviado ao ML antes da aprovação", putsBefore === 0);
r = await admin.post(`/actions/${r.body.id}/approve`, { confirm: true });
const put = (await mockLog()).filter((e) => e.method === "PUT" && e.path === "/items/MLB111");
check("Após aprovação, preço enviado ao ML", put.length === 1 && JSON.parse(put[0].body).price === 47, JSON.stringify(r.body));
check("Ação registrada na auditoria", (await admin.get("/audit")).body.some((a) => a.action.startsWith("action.")));

// ================= ALERTAS =================
sec("Central de alertas");
check("Regras configuráveis (20)", (await admin.get("/alert-rules")).body.length === 20);
await admin.put("/alert-rules/filament_low", { enabled: false, severity: null });
await admin.post("/alerts/evaluate", {});
check("Desativar regra resolve seus alertas", !(await admin.get("/alerts")).body.some((a) => a.type === "filament_low"));
await admin.put("/alert-rules/filament_low", { enabled: true, severity: "critical" });
await admin.post("/alerts/evaluate", {});
check("Prioridade configurada é aplicada", (await admin.get("/alerts")).body.find((a) => a.type === "filament_low")?.severity === "critical");
check("Sem alerta falso de queda de conversão com métricas importadas", !(await admin.get("/alerts")).body.some((a) => a.type === "conversion_drop" && !a.dedupe_key.includes("report")));

// ================= UNIFICAÇÃO DO ANÚNCIO INICIAL =================
sec("Unificação de anúncio importado");
await admin.post("/competitors", { name: "Loja Z", price: 40, our_listing_id: "INICIAL-HOLLYLAND-M2" });
const activeBefore = (await admin.get("/overview?period=7d")).body.operational.active_listings;
check("Operador não unifica (somente admin)", (await op.post("/listings/INICIAL-HOLLYLAND-M2/merge", { into: "MLB111", confirm: true })).status === 403);
check("Destino precisa ser anúncio da API", (await admin.post("/listings/INICIAL-HOLLYLAND-M2/merge", { into: "INICIAL-HOLLYLAND-M2", confirm: true })).status === 409);
r = await admin.post("/listings/INICIAL-HOLLYLAND-M2/merge", { into: "MLB111", confirm: true });
check("Unificação executada", r.status === 200, JSON.stringify(r.body));
check("Produtos ativos deixam de contar o anúncio em duplicidade", (await admin.get("/overview?period=7d")).body.operational.active_listings === activeBefore - 1);
check("Concorrente passa a apontar para o anúncio real", (await admin.get("/competitors")).body.find((x) => x.name === "Loja Z")?.our_listing_id === "MLB111");
check("Qualidade 94 preservada no anúncio real", (await admin.get("/listings-center?period=7d")).body.rows.find((x) => x.id === "MLB111")?.quality_score === 94);
check("Produto provisório removido", !(await admin.get("/products")).body.some((p) => p.name === "Ímã de reposição para Hollyland Lark M2"));

// ================= RELATÓRIOS =================
sec("Exportação de relatórios");
const exports = [
  ...["sales", "products", "financial", "profitability", "stock", "ads", "monthly", "opportunities"].map((k) => `/reports/${k}?period=30d`),
  "/listings-center/export?period=30d", "/listings-center/export?period=30d&list=priority", "/factory/export?kind=orders", "/factory/export?kind=filaments", `/finance/dre?month=${goal.month}`, "/goals/export",
];
for (const e of exports) {
  for (const fmt of ["xlsx", "pdf"]) {
    const res = await admin.req(`${e}${e.includes("?") ? "&" : "?"}format=${fmt}`, { raw: true });
    const buf = Buffer.from(await res.arrayBuffer());
    const okMagic = fmt === "xlsx" ? buf.slice(0, 2).toString() === "PK" : buf.slice(0, 4).toString() === "%PDF";
    check(`${e.split("?")[0]} → ${fmt.toUpperCase()}`, res.status === 200 && okMagic && buf.length > 500, `${res.status} ${buf.length}`);
  }
}

// ================= RESUMO =================
const failed = results.filter((x) => !x.ok);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
console.log(`TOTAL ${results.length} · OK ${results.length - failed.length} · FALHAS ${failed.length}`);
for (const f of failed) console.log(`✗ [${f.section}] ${f.name} — ${f.detail}`);
process.exitCode = failed.length ? 1 : 0;
