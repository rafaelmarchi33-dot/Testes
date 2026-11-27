const { chromium, devices } = require("playwright");
const fs = require("fs");
const A = require("path").join(__dirname, "out"); fs.mkdirSync(A, { recursive: true });
const FILES = process.env.AUDIT_FILES ?? "";
const BASE = "http://localhost:4100";
const results = [];
let cur = "";
const step = async (name, fn) => {
  try { await fn(); results.push({ area: cur, name, ok: true }); }
  catch (e) {
    results.push({ area: cur, name, ok: false, detail: String(e.message).split("\n")[0].slice(0, 220) });
    try { await (globalThis.__page)?.screenshot({ path: `${A}/fail-${results.length}.png` }); await globalThis.__page?.keyboard.press("Escape"); } catch {}
  }
};
const expect = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  globalThis.__page = page;
  const errors = [];
  const apiCalls = [];
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message} @ ${page.url()}`));
  page.on("response", (r) => {
    if (!r.url().includes("/api/")) return;
    apiCalls.push(r.url());
    if (r.status() >= 400) errors.push(`api ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
  });
  const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
  const settle = () => page.waitForLoadState("networkidle");
  const lastCall = (frag) => apiCalls.filter((u) => u.includes(frag)).at(-1) ?? "";

  cur = "Login";
  await step("Login do administrador", async () => {
    await go("/");
    await page.getByLabel("E-mail").fill("admin@example.com");
    await page.getByLabel("Senha").fill("senha-forte-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForSelector("h1:has-text('Visão geral')");
  });

  cur = "Layout";
  await step("Seletor de período: 7 dias altera a consulta", async () => {
    await page.getByRole("button", { name: /30 dias|7 dias|Mês atual|Hoje|90 dias|\// }).first().click();
    await page.getByRole("button", { name: /^7 dias/ }).click(); await settle();
    expect(lastCall("/api/overview").includes("period=7d"), lastCall("/api/overview"));
  });
  await step("Canal Shopee altera a consulta e zera faturamento ML", async () => {
    await page.locator("header button[aria-expanded]").first().click();
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/overview") && r.url().includes("channel=shopee")),
      page.getByRole("button", { name: "Shopee", exact: true }).click(),
    ]);
    const j = await resp.json();
    expect(j.kpis.revenue === 0, "faturamento " + j.kpis.revenue);
    await page.keyboard.press("Escape"); await settle();
    await page.waitForSelector("div.group:has-text('Faturamento bruto') >> text=R$ 0,00");
  });
  await step("Período personalizado aplicado", async () => {
    await page.locator("header button[aria-expanded]").first().click();
    await page.getByRole("button", { name: "Todos os canais", exact: true }).click();
    await page.getByLabel("De", { exact: true }).fill("2026-11-19"); await page.getByLabel("Até", { exact: true }).fill("2026-11-26");
    await page.getByRole("button", { name: "Aplicar período" }).click(); await settle();
    expect(lastCall("/api/overview").includes("from=2026-11-19&to=2026-11-26"), lastCall("/api/overview"));
    await page.waitForSelector("text=Funil de compra");
  });
  await step("Busca global encontra anúncio e navega", async () => {
    await page.getByLabel("Busca global").fill("Hollyland");
    await page.waitForSelector("header button:has-text('Anúncio')");
    await page.locator("header button:has-text('Anúncio')").first().click();
    await page.waitForURL(/\/seller\?id=/);
    await page.waitForSelector("[role=dialog]");
    await page.keyboard.press("Escape");
  });
  await step("Notificações abrem com alertas", async () => {
    await page.getByLabel("Notificações").click();
    await page.waitForSelector("text=Abrir central de alertas"); await page.keyboard.press("Escape");
  });
  await step("Menu de perfil e troca de tema", async () => {
    await page.getByLabel("Perfil").click(); await page.getByRole("button", { name: /Tema claro/ }).click();
    expect(!(await page.evaluate(() => document.documentElement.classList.contains("dark"))), "tema não mudou");
    await page.getByRole("button", { name: /Tema Emerald Night/ }).click();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), "tema não voltou");
  });
  await step("Recolher e expandir menu lateral", async () => {
    await page.getByLabel("Recolher menu").click(); await page.getByLabel("Expandir menu").click();
  });

  cur = "Visão geral";
  await step("Gráficos renderizados com dados do período", async () => {
    await go("/");
    expect(await page.locator(".recharts-surface").count() >= 3, "poucos gráficos");
  });

  cur = "Mercado Livre Seller";
  await step("Tabela, classes, busca, ordenação e paginação", async () => {
    await go("/seller");
    await Promise.all([page.waitForRequest((r) => r.url().includes("search=MLB111")), page.getByPlaceholder("Título, SKU ou ID…").fill("MLB111")]);
    await page.waitForSelector("tr:has-text('MLB111')");
    await page.getByPlaceholder("Título, SKU ou ID…").fill("");
    await page.getByRole("button", { name: /^Preço/ }).click();
    await page.getByRole("button", { name: /Campeões/ }).first().click();
  });
  await step("Detalhe do anúncio: salvar tarifas e pedir alteração de preço", async () => {
    await go("/seller");
    await page.locator("tr:has-text('MLB111')").first().click();
    await page.waitForSelector("[role=dialog]");
    await page.getByRole("button", { name: "Salvar tarifas" }).click(); await settle();
    await page.getByLabel("Novo preço (R$)").fill("48");
    await page.getByRole("button", { name: "Solicitar alteração" }).click();
    await page.getByRole("button", { name: "Enviar para aprovação" }).click(); await settle();
    await page.keyboard.press("Escape");
  });
  await step("Abas ranking e conexão", async () => {
    await page.getByRole("button", { name: "Ranking — 20 prioritários" }).click(); await page.waitForSelector("text=Ranking dos 20 anúncios prioritários");
    await page.getByRole("button", { name: "Conexão e sincronização" }).click(); await page.waitForSelector("text=Conectado");
  });
  await step("Exportar Excel da central", async () => {
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Excel" }).first().click()]);
    expect((await d.suggestedFilename()).endsWith(".xlsx"), "arquivo");
  });

  cur = "Aprovações";
  await step("Solicitação aparece pendente e é aprovada", async () => {
    await go("/aprovacoes");
    await page.waitForSelector("text=48");
    await page.getByRole("button", { name: /Aprovar/ }).first().click();
    await page.getByRole("button", { name: /Aprovar e executar|Confirmar|Aprovar/ }).last().click(); await settle();
  });

  cur = "Mind AI";
  await step("Conversa pelo atalho de capacidade", async () => {
    await go("/mind");
    await page.getByRole("button", { name: /Analise os resultados comerciais/ }).click();
    await page.waitForSelector("text=Resposta simulada da auditoria", { timeout: 20000 });
  });
  await step("Contexto enviado à IA visível", async () => {
    await page.getByRole("button", { name: "Dados que a IA vê" }).click();
    await page.waitForSelector("pre:has-text('Mind2Matter')"); await page.keyboard.press("Escape");
  });
  await step("CEO: gerar diagnóstico completo", async () => {
    await page.getByRole("button", { name: /CEO Mind2Matter/ }).first().click();
    await page.getByRole("button", { name: "Gerar diagnóstico completo" }).click();
    await page.waitForSelector("text=Saúde 42/100", { timeout: 20000 });
  });

  cur = "Radar";
  await step("Cadastrar e pontuar oportunidade", async () => {
    await go("/radar");
    await page.getByRole("button", { name: "Cadastrar oportunidade" }).click();
    await page.getByLabel("Nome do produto").fill("Organizador de cabos");
    await page.getByLabel("Preços dos concorrentes (R$, separados por ;)").fill("19,90; 24,90; 29,90");
    await page.getByLabel("Peso estimado (g)").fill("25"); await page.getByLabel("Tempo de impressão (min)").fill("40");
    await page.getByRole("button", { name: "Salvar e pontuar" }).click(); await settle();
    await page.waitForSelector("text=Organizador de cabos");
  });
  await step("Enviar ao laboratório navega para o produto", async () => {
    await page.locator("section:has-text('Organizador de cabos')").getByRole("button", { name: /Adicionar ao laboratório/ }).click();
    await page.waitForURL(/laboratorio\?id=/); await page.waitForSelector("[role=dialog]");
  });

  cur = "Laboratório";
  await step("Registrar teste e anexar STL", async () => {
    await page.getByPlaceholder("ex.: Teste PETG 0,2 mm — encaixe").fill("Teste de encaixe");
    await page.getByRole("button", { name: "Registrar" }).click(); await page.waitForSelector("text=Teste de encaixe");
    fs.writeFileSync(A + "/peca.stl", "solid t\nendsolid t\n");
    await page.locator("input[type=file]").setInputFiles(A + "/peca.stl"); await page.waitForSelector("text=peca.stl");
    await page.keyboard.press("Escape");
  });
  await step("Criar produto pelo formulário", async () => {
    await go("/laboratorio");
    await page.getByRole("button", { name: "Novo produto" }).click();
    await page.getByLabel("Nome").fill("Suporte de controle");
    await page.getByRole("button", { name: "Criar" }).click(); await page.waitForSelector("[role=dialog]:has-text('Suporte de controle')");
  });

  cur = "Financeiro";
  await step("Calculadora recalcula ao alterar preço", async () => {
    await go("/financeiro");
    await page.getByLabel("Preço de venda (R$)").fill("60");
    await page.getByRole("button", { name: "Calcular" }).click(); await settle();
    await page.waitForSelector("text=Simulador de cenários");
  });
  await step("Cadastro de custos: digitação não perde foco e salva", async () => {
    await page.getByRole("button", { name: "Cadastro de custos" }).click();
    const f = page.getByLabel("Energia (R$/kWh)"); await f.fill(""); await f.type("1,1".replace(",", "."));
    expect((await f.inputValue()) === "1.1", "valor digitado " + (await f.inputValue()));
    await page.getByRole("button", { name: "Salvar cadastro de custos" }).click(); await settle();
  });
  await step("Ranking e DRE com lançamento e exclusão de despesa", async () => {
    await page.getByRole("button", { name: "Ranking de rentabilidade" }).click(); await page.waitForSelector("text=Lucro/hora");
    await page.getByRole("button", { name: "DRE e despesas" }).click();
    await page.getByPlaceholder("Categoria (ex.: Aluguel)").fill("Internet"); await page.getByPlaceholder("Valor (R$)").fill("99");
    await page.getByRole("button", { name: "Lançar despesa" }).click(); await page.waitForSelector("text=Internet");
    await page.getByLabel("Excluir").last().click(); await page.getByRole("dialog").getByRole("button", { name: "Excluir", exact: true }).click(); await settle();
  });

  cur = "Mind Factory";
  await step("Nova ordem de produção e mudança de status com confirmação", async () => {
    await go("/fabrica");
    await page.getByRole("button", { name: "Nova ordem" }).click();
    await page.getByLabel("Produto cadastrado").selectOption({ label: "Ímã de reposição Hollyland Lark M2" });
    await page.getByLabel("Quantidade").fill("5");
    await page.getByRole("button", { name: "Salvar", exact: true }).click(); await settle();
    await page.locator("tr:has-text('Ímã de reposição Hollyland')").getByRole("button", { name: "Programada" }).first().click();
    await page.getByRole("button", { name: "Confirmar" }).click(); await settle();
    await page.waitForSelector("tr:has-text('Ímã de reposição Hollyland') >> text=Programada");
  });
  await step("Planejamento + recomendação da IA", async () => {
    await page.getByRole("button", { name: "Planejamento inteligente" }).click();
    await page.getByRole("button", { name: "Pedir plano ao Mind AI" }).click();
    await page.waitForSelector("text=Resposta simulada da auditoria", { timeout: 20000 });
  });
  await step("Máquinas e filamentos", async () => {
    await page.getByRole("button", { name: "Máquinas", exact: true }).click(); await page.waitForSelector("text=Bambu Lab A1 Combo");
    await page.getByRole("button", { name: "Filamentos" }).click();
    await page.getByRole("button", { name: "Cadastrar rolo" }).click();
    await page.getByLabel("Cor").fill("Branco"); await page.getByLabel("Custo por kg (R$)").fill("100");
    await page.getByRole("button", { name: "Salvar", exact: true }).click(); await page.waitForSelector("td:has-text('Branco')");
  });

  cur = "Marketing";
  await step("Gerar pacote de anúncio e marcar foto", async () => {
    await go("/marketing");
    await page.locator("main select").first().selectOption({ index: 1 });
    await page.getByRole("button", { name: "Gerar pacote do anúncio" }).click();
    await page.waitForSelector("text=Título A", { timeout: 20000 });
    await page.getByRole("button", { name: /1\. Fundo branco/ }).click(); await settle();
  });
  await step("Aba de publicidade carrega (rota corrigida)", async () => {
    await page.getByRole("button", { name: "Análise de publicidade" }).click(); await page.waitForSelector("text=Campanhas");
  });

  cur = "Metas";
  await step("Simulação responde aos parâmetros e marco é criado", async () => {
    await go("/metas");
    await Promise.all([page.waitForRequest((r) => r.url().includes("minutes=45")), page.getByLabel("Minutos/unidade").fill("45")]);
    await page.getByPlaceholder("Nome do marco").fill("Marco teste"); await page.getByPlaceholder("Faturamento (R$)").fill("7000");
    await page.getByRole("button", { name: "Adicionar" }).click(); await page.waitForSelector("text=Marco teste");
  });

  cur = "Concorrência";
  await step("Cadastrar concorrente e analisar com IA", async () => {
    await go("/concorrencia");
    await page.getByRole("button", { name: "Cadastrar concorrente" }).click();
    await page.getByLabel("Nome do concorrente").fill("Loja Y"); await page.getByLabel("Preço (R$)", { exact: true }).fill("39");
    await page.getByRole("button", { name: "Salvar", exact: true }).click(); await page.waitForSelector("text=Loja Y");
    await page.getByRole("button", { name: "Analisar" }).click(); await page.waitForSelector("text=Resposta simulada da auditoria", { timeout: 20000 });
  });

  cur = "Importação";
  await step("Upload do XLSX real mostra prévia com duplicidades", async () => {
    await go("/importacao");
    if (!fs.existsSync(FILES + "/desempenho.xlsx")) return; // sem relatório real: passo pulado
    await page.locator("input[type=file]").setInputFiles(FILES + "/desempenho.xlsx");
    await page.waitForSelector("text=Prévia da importação");
    await page.waitForSelector("text=8 duplicadas");
  });

  cur = "Alertas";
  await step("Regras: alterar limite e salvar", async () => {
    await go("/alertas");
    await page.getByRole("button", { name: "Regras, limites e prioridades" }).click();
    const row = page.locator("tr:has-text('Queda de conversão')");
    await row.locator("input[type=number]").fill("3");
    await row.getByRole("button", { name: "Salvar" }).click(); await settle();
  });

  cur = "Rotinas";
  await step("Executar rotina e ver resultado", async () => {
    await go("/rotinas");
    await page.locator("section:has-text('Sexta — Relatório executivo')").getByRole("button", { name: "Executar agora" }).click();
    await page.waitForSelector("text=Resultado da rotina", { timeout: 20000 }); await page.keyboard.press("Escape");
  });
  await step("Configurar horário", async () => {
    await page.locator("section:has-text('Rotina diária')").getByRole("button", { name: "Configurar" }).click();
    await page.getByLabel("Horário (São Paulo)").selectOption("8");
    await page.getByRole("button", { name: "Salvar" }).click(); await page.waitForSelector("text=· 08h");
  });

  cur = "Demais páginas";
  for (const p of ["/pedidos", "/perguntas", "/estoque", "/rentabilidade", "/publicidade", "/relatorios", "/integracoes", "/criar", "/assistente"]) {
    await step(`Abre ${p} sem erro`, async () => { await go(p); expect((await page.locator("main").innerText()).length > 40, "vazia"); });
  }
  await step("Relatórios: download de PDF", async () => {
    await go("/relatorios");
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).first().click()]);
    expect((await d.suggestedFilename()).endsWith(".pdf"), "pdf");
  });

  // -------- Celular --------
  cur = "Celular";
  const mctx = await browser.newContext({ ...devices["iPhone 13"] });
  await mctx.addCookies(await ctx.cookies());
  const m = await mctx.newPage();
  m.on("pageerror", (e) => errors.push(`mobile pageerror ${e.message}`));
  const pages = ["/", "/mind", "/alertas", "/aprovacoes", "/seller", "/pedidos", "/perguntas", "/marketing", "/concorrencia", "/radar", "/laboratorio", "/criar", "/fabrica", "/estoque", "/financeiro", "/rentabilidade", "/metas", "/publicidade", "/importacao", "/relatorios", "/rotinas", "/integracoes"];
  for (const p of pages) {
    await step(`${p} sem rolagem horizontal da página`, async () => {
      await m.goto(BASE + p); await m.waitForLoadState("networkidle");
      const w = await m.evaluate(() => ({ doc: document.documentElement.scrollWidth, main: document.querySelector("main")?.scrollWidth ?? 0, vw: window.innerWidth }));
      expect(w.doc <= w.vw + 1 && w.main <= w.vw + 1, JSON.stringify(w));
    });
  }
  await step("Menu móvel abre e navega", async () => {
    await m.goto(BASE + "/"); await m.getByLabel("Abrir menu").click();
    await m.getByRole("link", { name: "Mind Factory" }).click(); await m.waitForURL(/fabrica/);
  });
  await step("Seletor de período no celular", async () => {
    await m.locator("header button[aria-expanded]").first().click();
    await m.getByRole("button", { name: /^30 dias/ }).click(); await m.waitForLoadState("networkidle");
  });
  await m.goto(BASE + "/"); await m.waitForLoadState("networkidle"); await m.screenshot({ path: A + "/m-overview.png" });
  await m.goto(BASE + "/seller"); await m.waitForLoadState("networkidle"); await m.screenshot({ path: A + "/m-seller.png" });

  const fails = results.filter((r) => !r.ok);
  fs.writeFileSync(A + "/ui-results.json", JSON.stringify({ results, errors }, null, 1));
  console.log(`UI: ${results.length} passos · OK ${results.length - fails.length} · FALHAS ${fails.length}`);
  for (const f of fails) console.log(`✗ [${f.area}] ${f.name} — ${f.detail}`);
  console.log("Erros de console/API:\n" + ([...new Set(errors)].join("\n") || "nenhum"));
  await browser.close();
  process.exitCode = fails.length || errors.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
