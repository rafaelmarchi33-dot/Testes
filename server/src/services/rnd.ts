import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { q, json } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";
import { ai, common, checkStop, aiError, logAi, textOf } from "../ai/claude.ts";
import { calculate, getCostConfig, feesFor } from "./costs3d.ts";
import { research, type ResearchResult } from "./market.ts";
import { getAccount } from "../ml/client.ts";
import { aiConfigured } from "../config.ts";

export const RADAR_CATEGORIES = [
  "Organização", "Setup gamer", "Acessórios tecnológicos", "Microfones e áudio", "Criadores de conteúdo", "Escritório",
  "Decoração", "Automotivo", "Utilidades domésticas", "Presentes", "Colecionáveis", "Produtos personalizados",
];

type Level = "alta" | "média" | "baixa" | null;
export interface ScoreInput {
  sold_signal?: number | null;        // observado: soma de vendidos visíveis
  reviews?: number | null;            // observado: avaliações
  demand_level?: "forte" | "média" | "fraca" | "sem evidência" | null; // avaliação manual da evidência
  margin_pct?: number | null;         // estimado
  difficulty?: Level;                 // estimado
  print_minutes?: number | null;      // estimado
  sellers?: number | null;            // observado
  competition_level?: Level;          // manual
  differentiation?: Level;            // manual/estimado
  weight_g?: number | null;           // estimado
  fragile?: boolean;
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/** Nota de oportunidade 0–100: Demanda 25, Margem 25, Fabricação 15, Concorrência 15, Diferenciação 10, Logística 10. */
export function scoreOpportunity(i: ScoreInput) {
  const parts: { key: string; label: string; max: number; points: number; basis: string }[] = [];
  // Demanda
  if (i.sold_signal) parts.push({ key: "demand", label: "Demanda", max: 25, points: clamp(25 * Math.log10(1 + i.sold_signal) / Math.log10(5001), 0, 25), basis: `observado: ${i.sold_signal} vendidos visíveis` });
  else if (i.reviews) parts.push({ key: "demand", label: "Demanda", max: 25, points: clamp(25 * Math.log10(1 + i.reviews) / Math.log10(2001), 0, 25), basis: `observado: ${i.reviews} avaliações` });
  else if (i.demand_level) parts.push({ key: "demand", label: "Demanda", max: 25, points: ({ forte: 22, "média": 14, fraca: 7, "sem evidência": 0 })[i.demand_level], basis: `avaliação da evidência: ${i.demand_level}` });
  else parts.push({ key: "demand", label: "Demanda", max: 25, points: 0, basis: "sem evidência de demanda" });
  // Margem
  parts.push(i.margin_pct == null
    ? { key: "margin", label: "Margem potencial", max: 25, points: 0, basis: "margem não calculada (faltam custos/preço)" }
    : { key: "margin", label: "Margem potencial", max: 25, points: clamp((i.margin_pct / 50) * 25, 0, 25), basis: `estimado: ${i.margin_pct.toFixed(1)}%` });
  // Fabricação
  let ease = i.difficulty === "baixa" ? 15 : i.difficulty === "média" ? 9 : i.difficulty === "alta" ? 3 : 7;
  if (i.print_minutes && i.print_minutes > 300) ease -= 3;
  parts.push({ key: "ease", label: "Facilidade de fabricação", max: 15, points: clamp(ease, 0, 15), basis: `${i.difficulty ? `dificuldade ${i.difficulty}` : "dificuldade não avaliada"}${i.print_minutes ? `, ${Math.round(i.print_minutes)} min` : ""}` });
  // Concorrência
  if (i.sellers != null) parts.push({ key: "competition", label: "Concorrência", max: 15, points: clamp(15 * (1 - Math.min(1, i.sellers / 50)), 0, 15), basis: `observado: ${i.sellers} vendedores na amostra` });
  else parts.push({ key: "competition", label: "Concorrência", max: 15, points: i.competition_level === "baixa" ? 14 : i.competition_level === "média" ? 9 : i.competition_level === "alta" ? 4 : 0, basis: i.competition_level ? `avaliação: ${i.competition_level}` : "não avaliada" });
  // Diferenciação
  parts.push({ key: "differentiation", label: "Diferenciação", max: 10, points: i.differentiation === "alta" ? 10 : i.differentiation === "média" ? 6 : i.differentiation === "baixa" ? 2 : 0, basis: i.differentiation ? `avaliação: ${i.differentiation}` : "não avaliada" });
  // Logística
  let log = i.weight_g == null ? 0 : i.weight_g <= 100 ? 10 : i.weight_g <= 300 ? 7 : i.weight_g <= 800 ? 4 : 2;
  if (i.fragile) log -= 2;
  parts.push({ key: "logistics", label: "Logística", max: 10, points: clamp(log, 0, 10), basis: i.weight_g == null ? "peso não estimado" : `estimado: ${Math.round(i.weight_g)} g${i.fragile ? ", frágil" : ""}` });
  const total = Math.round(parts.reduce((s, p) => s + p.points, 0));
  return { total, parts: parts.map((p) => ({ ...p, points: Math.round(p.points * 10) / 10 })) };
}

/** Margem estimada a partir do preço observado e das estimativas de peso/tempo, com a configuração de custos real. */
export function estimateMargin(price: number | null, weight_g: number | null, print_minutes: number | null, material = "PLA") {
  if (!price || !weight_g || !print_minutes) return { margin_pct: null, est_cost: null, missing: ["preço de referência, peso ou tempo"] };
  const fees = feesFor(null, "mercadolivre");
  const c = calculate({ weight_g, print_minutes, material, sale_price: price, fee_pct: fees.fee_pct, fixed_fee: fees.fixed_fee, shipping: fees.shipping_cost }, getCostConfig());
  return { margin_pct: c.margin_pct, est_cost: c.total_variable_cost, missing: c.missing, profit_per_hour: c.profit_per_print_hour };
}

export function listOpportunities() {
  return q.all<any>("SELECT * FROM opportunities ORDER BY COALESCE(score,-1) DESC, id DESC").map((o) => ({
    ...o, evidence: json.parse(o.evidence, {}), links: json.parse(o.links, []), competitor_prices: json.parse(o.competitor_prices, []),
    observed: json.parse(o.observed, {}), estimates: json.parse(o.estimates, {}), scores: json.parse(o.scores, null),
  }));
}

export const oppSchema = z.object({
  name: z.string().min(2).max(200), category_name: z.string().max(100).optional().nullable(), image: z.string().max(1000).optional().nullable(),
  links: z.array(z.string().url().max(1000)).max(20).default([]),
  competitor_prices: z.array(z.number().positive()).max(50).default([]),
  sold_signal: z.number().int().min(0).optional().nullable(), reviews: z.number().int().min(0).optional().nullable(), sellers: z.number().int().min(0).optional().nullable(),
  demand_note: z.string().max(2000).optional().nullable(),
  demand_level: z.enum(["forte", "média", "fraca", "sem evidência"]).optional().nullable(),
  competition_level: z.enum(["alta", "média", "baixa"]).optional().nullable(),
  differentiation: z.enum(["alta", "média", "baixa"]).optional().nullable(),
  difficulty: z.enum(["alta", "média", "baixa"]).optional().nullable(),
  weight_g: z.number().positive().optional().nullable(), print_minutes: z.number().positive().optional().nullable(),
  material: z.string().max(20).optional().nullable(), fragile: z.boolean().optional(), rationale: z.string().max(4000).optional().nullable(),
  source: z.string().max(40).optional(),
});
export type OppInput = z.infer<typeof oppSchema>;

/** Cria/atualiza uma oportunidade recalculando margem e nota a partir de dados observados + estimativas. */
export function saveOpportunity(input: OppInput, id?: number) {
  const prices = [...input.competitor_prices].sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)]! : null;
  const m = estimateMargin(median, input.weight_g ?? null, input.print_minutes ?? null, input.material ?? "PLA");
  const score = scoreOpportunity({ ...input, margin_pct: m.margin_pct });
  const observed = {
    competitor_prices: prices, price_min: prices[0] ?? null, price_median: median, price_max: prices.at(-1) ?? null,
    sold_signal: input.sold_signal ?? null, reviews: input.reviews ?? null, sellers: input.sellers ?? null, links: input.links,
  };
  const estimates = { weight_g: input.weight_g ?? null, print_minutes: input.print_minutes ?? null, material: input.material ?? "PLA", est_cost: m.est_cost, margin_pct: m.margin_pct, difficulty: input.difficulty ?? null, differentiation: input.differentiation ?? null, missing_for_margin: m.missing };
  const vals = [
    input.name, input.image ?? null, input.category_name ?? null, observed.price_min, median, observed.price_max, input.sellers ?? null, input.sold_signal ?? null,
    input.demand_note ?? null, m.est_cost, m.margin_pct, input.difficulty ?? null, score.total >= 70 ? "alto" : score.total >= 45 ? "médio" : "baixo",
    input.rationale ?? null, JSON.stringify({ demand_level: input.demand_level, competition_level: input.competition_level, fragile: input.fragile ?? false, reviews: input.reviews }),
    input.source ?? "manual", JSON.stringify(input.links), JSON.stringify(prices), JSON.stringify(observed), JSON.stringify(estimates), JSON.stringify(score), score.total,
    input.weight_g ?? null, input.print_minutes ?? null,
  ];
  if (id) {
    q.run(`UPDATE opportunities SET name=?, image=?, category_name=?, price_min=?, price_median=?, price_max=?, competitors=?, sold_signal=?, demand_note=?, est_cost=?, margin_pct=?,
      difficulty=?, potential=?, rationale=?, evidence=?, source=?, links=?, competitor_prices=?, observed=?, estimates=?, scores=?, score=?, weight_g=?, print_minutes=? WHERE id=?`, [...vals, id]);
    return id;
  }
  const r = q.run(`INSERT INTO opportunities (name, image, category_name, price_min, price_median, price_max, competitors, sold_signal, demand_note, est_cost, margin_pct,
    difficulty, potential, rationale, evidence, source, links, competitor_prices, observed, estimates, scores, score, weight_g, print_minutes) VALUES (${vals.map(() => "?").join(",")})`, vals);
  return Number(r.lastInsertRowid);
}

/** Pesquisa no Mercado Livre (API oficial) e transforma o resultado em oportunidade com dados observados. */
export async function radarFromMl(term: string, category: string | null, userId: number) {
  if (!getAccount()) throw new HttpError(503, "Conecte o Mercado Livre para pesquisar anúncios com a API oficial.", "integration_unavailable");
  const r: ResearchResult & { id: number } = await research(term, userId);
  const reviews = r.items.reduce((s, i) => s + (i.reviews_total ?? 0), 0);
  const id = saveOpportunity(oppSchema.parse({
    name: term, category_name: category ?? r.category?.name ?? null, image: r.items[0]?.thumbnail ?? null,
    links: r.items.map((i) => i.permalink).filter((x): x is string => !!x && /^https?:/.test(x)).slice(0, 10),
    competitor_prices: r.items.map((i) => i.price).filter((p) => p > 0),
    sold_signal: r.stats.sold_signal, reviews: reviews || null, sellers: r.stats.sellers,
    demand_note: `${r.total_results ?? "?"} resultados na busca; ${r.stats.with_sold_data} anúncios com vendidos visíveis. ${r.limitations.join(" ")}`,
    source: "ml_research",
  }));
  q.run("UPDATE opportunities SET research_id=?, category_id=? WHERE id=?", [r.id, r.category?.id ?? null, id]);
  return id;
}

const WebFindings = z.object({
  candidatos: z.array(z.object({
    nome: z.string(),
    por_que: z.string().describe("Motivo, citando apenas o que foi observado nas fontes"),
    links: z.array(z.string()).describe("URLs das fontes/anúncios observados"),
    precos_observados: z.array(z.number()).describe("Preços em R$ vistos nas fontes; vazio se não houver"),
    evidencia_demanda: z.string().describe("Evidência pública de demanda observada (ex.: 'mais vendido na categoria', '+500 vendidos'); 'sem evidência' se não houver"),
    nivel_evidencia: z.enum(["forte", "média", "fraca", "sem evidência"]),
    concorrencia: z.enum(["alta", "média", "baixa"]),
    peso_estimado_g: z.number().describe("ESTIMATIVA de peso da peça impressa"),
    tempo_estimado_min: z.number().describe("ESTIMATIVA de tempo de impressão em uma Bambu Lab A1, bico 0,4"),
    dificuldade: z.enum(["alta", "média", "baixa"]),
    diferenciacao: z.enum(["alta", "média", "baixa"]).describe("Potencial de diferenciação da Mind2Matter"),
    material: z.enum(["PLA", "PETG"]),
  })),
  limitacoes: z.array(z.string()),
});

/**
 * Pesquisa de tendências em fontes públicas com a ferramenta de busca web do Claude.
 * Etapa 1: pesquisa com citações (texto). Etapa 2: estruturação sem acesso à web, preservando só o que foi observado.
 */
export async function radarWebResearch(category: string, context: string) {
  if (!aiConfigured()) throw new HttpError(503, "A pesquisa web do radar usa a IA: defina ANTHROPIC_API_KEY.", "integration_unavailable");
  const started = Date.now();
  try {
    const msg = await ai().beta.messages.create({
      ...common(),
      max_tokens: 16000,
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      system: `Você é pesquisador de mercado da Mind2Matter (impressão 3D FDM, Bambu Lab A1 Combo, bico 0,4 mm, PLA/PETG, multicolorido com AMS).
Pesquise em fontes públicas (Mercado Livre, Shopee, Google Trends, blogs, marketplaces) produtos da categoria pedida que possam ser fabricados por impressão 3D.
Nunca invente quantidades vendidas, buscas ou preços: registre apenas o que encontrar, com a URL. Separe claramente o que é observado do que é estimativa.`,
      messages: [{ role: "user", content: `Categoria: ${category}\nContexto adicional: ${context || "—"}\nEncontre de 4 a 8 candidatos com evidências públicas e links.` }],
    } as any);
    if ((msg as any).stop_reason === "refusal") throw new HttpError(422, "A IA não pôde atender a esta pesquisa.");
    const findings = textOf((msg as any).content);
    const urls = new Set<string>();
    for (const b of (msg as any).content ?? []) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) urls.add(r.url);
    }
    const parsed = await ai().beta.messages.parse({
      ...common(),
      max_tokens: 8000,
      output_config: { effort: "low", format: betaZodOutputFormat(WebFindings) },
      messages: [{ role: "user", content: `Estruture os achados abaixo. Use somente links presentes nesta lista de URLs consultadas: ${JSON.stringify([...urls].slice(0, 60))}.\nPreços e evidências apenas se constarem nos achados. Peso, tempo, dificuldade e diferenciação são estimativas.\n\nAchados:\n${findings}` }],
    });
    checkStop(parsed);
    logAi("messages/radar_web", started, 200);
    const out = parsed.parsed_output;
    if (!out) throw new Error("Resposta da IA fora do formato esperado");
    const ids: number[] = [];
    for (const c of out.candidatos) {
      ids.push(saveOpportunity(oppSchema.parse({
        name: c.nome, category_name: category,
        links: c.links.filter((l) => urls.has(l) && /^https?:\/\//.test(l)).slice(0, 10),
        competitor_prices: c.precos_observados.filter((p) => p > 0 && p < 100000),
        demand_note: c.evidencia_demanda, demand_level: c.nivel_evidencia, competition_level: c.concorrencia, differentiation: c.diferenciacao,
        difficulty: c.dificuldade, weight_g: c.peso_estimado_g > 0 ? c.peso_estimado_g : null, print_minutes: c.tempo_estimado_min > 0 ? c.tempo_estimado_min : null,
        material: c.material, rationale: c.por_que, source: "web_research",
      })));
    }
    return { created: ids.length, ids, limitations: out.limitacoes, sources: urls.size };
  } catch (e) {
    logAi("messages/radar_web", started, 500, (e as Error).message);
    aiError(e);
  }
}

/* ------------------------------ Laboratório ------------------------------ */
export const LAB_STATUS = ["idea", "research", "development", "testing", "approved", "production", "selling", "discontinued"] as const;
export const LAB_STATUS_LABEL: Record<string, string> = {
  idea: "Ideia", research: "Em pesquisa", development: "Em desenvolvimento", testing: "Em teste", approved: "Aprovado", production: "Em produção", selling: "Comercializado", discontinued: "Descontinuado",
};

export function labEvent(labId: number, kind: string, title: string, userId: number | null, details?: string | null, result?: string | null) {
  q.run("INSERT INTO lab_events (lab_product_id, kind, title, details, result, created_by) VALUES (?,?,?,?,?,?)", [labId, kind, title, details ?? null, result ?? null, userId]);
}

export function listLab() {
  return q.all<any>(`SELECT lp.*, (SELECT filename FROM lab_files f WHERE f.lab_product_id=lp.id AND f.kind='image' ORDER BY f.id LIMIT 1) cover,
     (SELECT COUNT(*) FROM lab_files f WHERE f.lab_product_id=lp.id) files, (SELECT COUNT(*) FROM lab_events e WHERE e.lab_product_id=lp.id AND e.kind='test') tests
     FROM lab_products lp ORDER BY lp.updated_at DESC`).map((l) => ({ ...l, margin_pct: l.sale_price && l.est_cost !== null ? ((l.sale_price - l.est_cost) / l.sale_price) * 100 : null }));
}

export function addOpportunityToLab(oppId: number, userId: number) {
  const o = q.get<any>("SELECT * FROM opportunities WHERE id=?", [oppId]);
  if (!o) throw new HttpError(404, "Oportunidade não encontrada");
  if (o.lab_product_id && q.get("SELECT 1 FROM lab_products WHERE id=?", [o.lab_product_id])) return o.lab_product_id as number;
  const est = json.parse<any>(o.estimates, {});
  const r = q.run(
    `INSERT INTO lab_products (name, category, weight_g, print_minutes, material, est_cost, sale_price, status, opportunity_id, description, created_by)
     VALUES (?,?,?,?,?,?,?, 'research', ?, ?, ?)`,
    [o.name, o.category_name, o.weight_g, o.print_minutes, est.material ?? "PLA", o.est_cost, o.price_median, o.id, o.rationale, userId],
  );
  const id = Number(r.lastInsertRowid);
  labEvent(id, "status", "Criado a partir do Radar de Produtos", userId, `Nota de oportunidade: ${o.score ?? "—"}. Preço de referência observado: ${o.price_median ?? "—"}. Custos e tempo são estimativas.`);
  q.run("UPDATE opportunities SET lab_product_id=?, status='planned' WHERE id=?", [id, o.id]);
  return id;
}

/** Converte produto aprovado em cadastro comercial (produto + ficha técnica). */
export function convertLabToProduct(labId: number, userId: number) {
  const l = q.get<any>("SELECT * FROM lab_products WHERE id=?", [labId]);
  if (!l) throw new HttpError(404, "Produto do laboratório não encontrado");
  if (!["approved", "production"].includes(l.status)) throw new HttpError(409, "Somente produtos aprovados podem virar cadastro comercial");
  if (l.product_id) throw new HttpError(409, "Este produto já possui cadastro comercial");
  if (l.sku && q.get("SELECT 1 FROM products WHERE sku=?", [l.sku])) throw new HttpError(409, `SKU ${l.sku} já está em uso`);
  return q.tx(() => {
    const r = q.run("INSERT INTO products (sku, name, category, made_to_order, stock_qty, weight_g, print_minutes, material, lab_product_id, notes) VALUES (?,?,?,1,0,?,?,?,?,?)",
      [l.sku, l.name, l.category, l.weight_g, l.print_minutes, l.material, l.id, l.description]);
    const pid = Number(r.lastInsertRowid);
    q.run("UPDATE lab_products SET product_id=?, status='production', updated_at=? WHERE id=?", [pid, new Date().toISOString(), labId]);
    labEvent(labId, "status", "Convertido em cadastro comercial", userId, `Produto #${pid} criado. Próximo passo: gerar o anúncio no módulo Marketing e solicitar publicação.`);
    return pid;
  });
}
