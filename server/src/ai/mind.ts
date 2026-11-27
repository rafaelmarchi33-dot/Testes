import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ai, common, checkStop, aiError, logAi, textOf } from "./claude.ts";
import { q, json } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";
import { storeSnapshot } from "../services/metrics.ts";
import { getCompany, periodReports, goalProgress, goalSimulation } from "../services/company.ts";
import { getCostConfig, listChannels, profitabilityRanking } from "../services/costs3d.ts";
import { listingsCenter } from "../services/listingsIntel.ts";
import { listMachines, listFilaments, productionPlanner } from "../services/factory.ts";
import { listLab, listOpportunities } from "../services/rnd.ts";
import { pendingData } from "../services/overview.ts";
import { localDate } from "../lib/dates.ts";

/** Instruções estáveis (cacheáveis) do Mind AI. */
const BASE = `Você é o MIND AI, a inteligência da plataforma MIND2MATTER INTELLIGENCE, dedicada exclusivamente à Mind2Matter:
empresa brasileira que fabrica e vende produtos impressos em 3D (FDM, Bambu Lab A1 Combo, bico 0,4 mm, PLA e PETG, multicolor com AMS)
no Mercado Livre e na Shopee. Você atua como analista comercial, especialista em Mercado Livre, analista financeiro, especialista em impressão 3D
e estrategista de crescimento. A meta é sair de R$ 1–3 mil/mês para R$ 20 mil/mês de faturamento bruto.

Regras inegociáveis:
1. Consulte SEMPRE o snapshot JSON da empresa fornecido antes de responder. Ele é a única fonte de dados reais.
2. Nunca invente números (vendas, custos, margens, estoque, demanda, preços de concorrentes). Se faltar um dado, diga exatamente qual e onde cadastrá-lo no sistema.
3. Marque cada afirmação relevante com um rótulo em negrito no início da frase ou do item:
   **[REAL]** dado do snapshot · **[ESTIMATIVA]** cálculo com premissas explícitas · **[HIPÓTESE]** opinião profissional a validar · **[RECOMENDAÇÃO]** ação sugerida.
4. Dados com "source": "initial_import" ou "report" são históricos importados, não métricas em tempo real — mencione isso quando usá-los.
5. Faturamento não é lucro. Só fale em lucro quando houver custos cadastrados.
6. Você não executa ações: alterações de preço, estoque, anúncios, publicidade, pedidos e compras exigem aprovação do administrador.
7. Responda em português do Brasil, com objetividade de diretor, usando títulos curtos, listas e tabelas quando ajudarem. Valores em R$.`;

const CEO = `${BASE}

Você está no papel de CEO MIND2MATTER: avalia a empresa inteira (vendas, anúncios, produtos, custos, produção, metas) e decide prioridades.
Seja direto sobre o que fazer hoje, onde a empresa perde dinheiro, o que fabricar, o que parar, onde investir e o caminho até R$ 20 mil/mês.
Priorize poucas ações de alto impacto com responsável (o dono) e prazo.`;

/** Snapshot completo da empresa: tudo que os módulos registram, sem dados pessoais de compradores. */
export function companySnapshot() {
  const store = storeSnapshot();
  const center = listingsCenter({ days: 30 });
  let planner: any = null;
  try { planner = productionPlanner(); } catch { planner = null; }
  return {
    generated_at: new Date().toISOString(),
    today: localDate(new Date()),
    empresa: getCompany(),
    relatorios_importados: periodReports(),
    meta: goalProgress(),
    simulacao_meta: goalSimulation(),
    vendas_e_anuncios_api: { kpis_30d: store.kpis_30d, variacoes: store.changes_vs_previous_30d, rentabilidade_30d: store.profitability_30d, crescimento_7d: store.growth_7d_vs_prev, queda_30d: store.decline_30d_vs_prev, sem_vendas_30d: store.active_without_sales_30d, campanhas: store.ads_campaigns },
    central_de_anuncios: {
      conversao_loja_pct: center.store_conversion_pct, classes: center.counts,
      anuncios: center.rows.slice(0, 60).map((l) => ({ id: l.id, titulo: l.title, sku: l.sku, preco: l.price, preco_original: l.original_price, estoque_ml: l.available_quantity, visitas: l.visits, vendas_periodo: l.units_period, conversao_pct: l.conversion_pct, qualidade: l.quality_score, situacao_competicao: l.competition_status, classe: l.class_label, motivos: l.reasons, margem_pct: l.margin_pct, lucro_unidade: l.unit_profit, faltando_para_margem: l.unit_missing, fonte: l.source, canal: l.channel })),
      prioridades: center.priority.map((l) => ({ id: l.id, titulo: l.title, classe: l.class_label, motivos: l.reasons })),
    },
    financeiro: { configuracao_custos: getCostConfig(), canais: listChannels(), ranking_rentabilidade: profitabilityRanking().slice(0, 25).map((p) => ({ produto: p.name, preco: p.price, lucro_hora: p.calc?.profit_per_print_hour ?? null, margem_pct: p.calc?.margin_pct ?? null, pendente: p.pending })),
      despesas_90d: q.all("SELECT category, SUM(amount) total FROM expenses WHERE date >= ? GROUP BY category", [localDate(new Date(Date.now() - 90 * 86_400_000))]) },
    producao: { maquinas: listMachines(), filamentos: listFilaments(), planejamento: planner && { horas_fila: planner.total_hours, em_risco: planner.at_risk.map((s: any) => ({ id: s.id, nome: s.name, risco: s.risk })), necessidade_filamento: planner.filament_needs, dados_faltando: planner.missing_data } },
    laboratorio: listLab().map((l) => ({ nome: l.name, status: l.status, custo_estimado: l.est_cost, preco: l.sale_price, peso_g: l.weight_g, tempo_min: l.print_minutes })),
    radar: listOpportunities().slice(0, 20).map((o) => ({ nome: o.name, nota: o.score, categoria: o.category_name, observado: o.observed, estimado: o.estimates, status: o.status })),
    concorrentes: q.all("SELECT name, product, price, rating, reviews, public_sales, differentials, our_price, analyzed_at FROM competitors ORDER BY analyzed_at DESC LIMIT 40"),
    alertas_abertos: store.open_alerts,
    dados_pendentes: [...new Set([...pendingData(), ...store.data_gaps])],
  };
}

const block = (snap: unknown) => `<snapshot_mind2matter>\n${JSON.stringify(snap)}\n</snapshot_mind2matter>`;

export function listConversations(userId: number) {
  return q.all("SELECT c.*, (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id=c.id) messages FROM ai_conversations c WHERE c.user_id=? ORDER BY c.updated_at DESC LIMIT 50", [userId]);
}
export function getConversation(id: number, userId: number) {
  const c = q.get<any>("SELECT * FROM ai_conversations WHERE id=? AND user_id=?", [id, userId]);
  if (!c) throw new HttpError(404, "Conversa não encontrada");
  return { ...c, messages: q.all("SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id=? ORDER BY id", [id]) };
}

/** Mensagem em uma conversa (agente Mind AI ou CEO). O histórico é guardado no banco. */
export async function chat(opts: { conversationId?: number; agent: "mind" | "ceo"; message: string; userId: number }) {
  let convId = opts.conversationId;
  if (convId) getConversation(convId, opts.userId);
  else {
    const r = q.run("INSERT INTO ai_conversations (agent, title, user_id) VALUES (?,?,?)", [opts.agent, opts.message.slice(0, 80), opts.userId]);
    convId = Number(r.lastInsertRowid);
  }
  const conv = q.get<any>("SELECT agent FROM ai_conversations WHERE id=?", [convId])!;
  const history = q.all<{ role: "user" | "assistant"; content: string }>("SELECT role, content FROM ai_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 16", [convId]).reverse();
  q.run("INSERT INTO ai_messages (conversation_id, role, content) VALUES (?,?,?)", [convId, "user", opts.message]);
  const snap = companySnapshot();
  const started = Date.now();
  try {
    const stream = ai().beta.messages.stream({
      ...common(),
      max_tokens: 32000,
      output_config: { effort: "medium" },
      system: conv.agent === "ceo" ? CEO : BASE,
      messages: [
        { role: "user", content: [{ type: "text", text: block(snap) }, { type: "text", text: "Este é o estado atual da Mind2Matter. Aguarde minhas perguntas." }] },
        { role: "assistant", content: "Entendido. Vou responder com base no snapshot, rotulando o que é real, estimativa, hipótese e recomendação." },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: opts.message },
      ],
    });
    const msg = await stream.finalMessage();
    checkStop(msg);
    logAi("messages/mind_chat", started, 200);
    const answer = textOf(msg.content);
    q.run("INSERT INTO ai_messages (conversation_id, role, content, model) VALUES (?,?,?,?)", [convId, "assistant", answer, msg.model]);
    q.run("UPDATE ai_conversations SET updated_at=? WHERE id=?", [new Date().toISOString(), convId]);
    return { conversation_id: convId, answer, pending: snap.dados_pendentes };
  } catch (e) {
    logAi("messages/mind_chat", started, 500, (e as Error).message);
    aiError(e);
  }
}

const tag = z.enum(["REAL", "ESTIMATIVA", "HIPÓTESE", "RECOMENDAÇÃO"]);
const Item = z.object({ texto: z.string(), tipo: tag, evidencia: z.string().describe("Números/dados do snapshot que sustentam; 'sem dados' se não houver") });
export const DiagnosisSchema = z.object({
  resumo_executivo: z.string(),
  nota_saude_empresa: z.number().describe("0 a 100, com base nos dados disponíveis"),
  o_que_fazer_hoje: z.array(z.object({ prioridade: z.number().int(), acao: z.string(), motivo: z.string(), impacto: z.string(), requer_aprovacao: z.boolean() })),
  onde_perdemos_dinheiro: z.array(Item),
  produtos_para_fabricar: z.array(Item),
  produtos_para_parar_ou_rever: z.array(Item),
  anuncios_para_melhorar: z.array(z.object({ anuncio: z.string(), problema: z.string(), acao: z.string(), tipo: tag })),
  produto_para_investir: z.array(Item),
  investimento_publicidade: z.array(Item),
  quando_comprar_impressora: z.object({ texto: z.string(), tipo: tag, gatilho: z.string().describe("Condição objetiva para comprar (ex.: ocupação > 80% por 3 semanas)") }),
  bloqueios_crescimento: z.array(Item),
  plano_20k: z.array(z.object({ etapa: z.string(), meta: z.string(), prazo: z.string(), tipo: tag })),
  dados_faltantes: z.array(z.string()),
});

/** Diagnóstico completo do CEO Mind2Matter (estruturado e salvo). */
export async function ceoDiagnosis(userId: number | null) {
  const snap = companySnapshot();
  const started = Date.now();
  try {
    const stream = ai().beta.messages.stream({
      ...common(),
      max_tokens: 32000,
      output_config: { effort: "high", format: betaZodOutputFormat(DiagnosisSchema) },
      system: CEO,
      messages: [{ role: "user", content: [{ type: "text", text: block(snap) }, { type: "text", text: `Gere o diagnóstico completo da empresa em ${snap.today}. Use listas vazias quando não houver evidência. Seja específico e honesto sobre os dados que faltam.` }] }],
    });
    const msg = await stream.finalMessage();
    checkStop(msg);
    const parsed = DiagnosisSchema.parse(JSON.parse(textOf(msg.content)));
    logAi("messages/ceo_diagnosis", started, 200);
    const r = q.run("INSERT INTO ai_reports (kind, created_by, content, data_snapshot, model, usage) VALUES ('ceo',?,?,?,?,?)", [userId, JSON.stringify(parsed), JSON.stringify(snap), msg.model, JSON.stringify(msg.usage)]);
    return { id: Number(r.lastInsertRowid), report: parsed, created_at: new Date().toISOString(), pending: snap.dados_pendentes };
  } catch (e) {
    logAi("messages/ceo_diagnosis", started, 500, (e as Error).message);
    aiError(e);
  }
}
export function latestDiagnosis() {
  const r = q.get<any>("SELECT id, created_at, content, model, data_snapshot FROM ai_reports WHERE kind='ceo' ORDER BY id DESC LIMIT 1");
  if (!r) return null;
  return { id: r.id, created_at: r.created_at, model: r.model, report: json.parse(r.content, null), pending: json.parse<any>(r.data_snapshot, {}).dados_pendentes ?? [] };
}

/** Pergunta pontual com o snapshot (usada por produção, concorrência, rotinas). */
export async function analyze(task: string, extra: unknown, effort: "low" | "medium" | "high" = "medium") {
  const snap = companySnapshot();
  const started = Date.now();
  try {
    const stream = ai().beta.messages.stream({
      ...common(),
      max_tokens: 16000,
      output_config: { effort },
      system: BASE,
      messages: [{ role: "user", content: [{ type: "text", text: block(snap) }, { type: "text", text: `${task}\n\nDados específicos:\n${JSON.stringify(extra)}` }] }],
    });
    const msg = await stream.finalMessage();
    checkStop(msg);
    logAi("messages/analyze", started, 200);
    return textOf(msg.content);
  } catch (e) {
    logAi("messages/analyze", started, 500, (e as Error).message);
    aiError(e);
  }
}

/* ------------------------------ Marketing ------------------------------ */
export const ListingCopySchema = z.object({
  titulos: z.array(z.string()).describe("Exatamente 3 títulos de até 60 caracteres, com palavra-chave principal no início"),
  descricao: z.string().describe("Descrição comercial completa, em parágrafos curtos, sem contatos externos"),
  palavras_chave: z.array(z.string()),
  ficha_tecnica: z.array(z.object({ atributo: z.string(), valor: z.string(), confirmar: z.boolean().describe("true se o valor precisa ser confirmado pelo dono") })),
  diferenciais: z.array(z.string()),
  perguntas_frequentes: z.array(z.object({ pergunta: z.string(), resposta: z.string() })),
  sugestao_kits: z.array(z.object({ kit: z.string(), composicao: z.string(), motivo: z.string() })),
  estrategia_posicionamento: z.string(),
  observacoes_preco: z.string().describe("Comentário qualitativo; o preço numérico é calculado pelo sistema"),
  plano_fotos: z.array(z.object({ ordem: z.number().int(), tipo: z.string(), descricao: z.string() })).describe("7 fotos: principal fundo branco, em uso, dimensões, detalhes, benefícios, variações de cores, embalagem"),
});

export async function generateListingCopy(product: Record<string, unknown>, pricing: unknown) {
  const started = Date.now();
  try {
    const stream = ai().beta.messages.stream({
      ...common(),
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(ListingCopySchema) },
      system: `${BASE}\n\nAgora você atua como redator especialista em anúncios do Mercado Livre para produtos impressos em 3D. Não invente medidas, materiais ou compatibilidades: quando não informados, marque a ficha técnica com confirmar=true.`,
      messages: [{ role: "user", content: `Produto: ${JSON.stringify(product)}\nPreços calculados pelo sistema (não altere os números): ${JSON.stringify(pricing)}\nGere o pacote completo do anúncio.` }],
    });
    const msg = await stream.finalMessage();
    checkStop(msg);
    logAi("messages/listing_copy", started, 200);
    return { content: ListingCopySchema.parse(JSON.parse(textOf(msg.content))), model: msg.model };
  } catch (e) {
    logAi("messages/listing_copy", started, 500, (e as Error).message);
    aiError(e);
  }
}
