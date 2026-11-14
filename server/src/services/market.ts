import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { q, json } from "../db/index.ts";
import { config } from "../config.ts";
import { ml, MLApiError, mapLimit } from "../ml/client.ts";
import { ai, common, checkStop, aiError, logAi } from "../ai/claude.ts";
import { fetchFee } from "./finance.ts";

export interface MarketItem {
  id: string;
  title: string;
  price: number;
  thumbnail: string | null;
  permalink: string | null;
  seller_id: number | null;
  official_store: boolean;
  free_shipping: boolean | null;
  listing_type_id: string | null;
  sold_quantity: number | null; // somente quando a API expõe esse dado
  reviews_total?: number | null;
  rating?: number | null;
}

export interface ResearchResult {
  query: string;
  source: string;
  category: { id: string; name: string } | null;
  total_results: number | null;
  items: MarketItem[];
  stats: { count: number; price_min: number | null; price_p25: number | null; price_median: number | null; price_p75: number | null; price_max: number | null; sellers: number; official_stores: number; free_shipping_pct: number | null; sold_signal: number | null; with_sold_data: number };
  trends: string[];
  limitations: string[];
}

const quantile = (sorted: number[], p: number) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return Math.round((sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo)) * 100) / 100;
};

export function computeStats(items: MarketItem[]): ResearchResult["stats"] {
  const prices = items.map((i) => i.price).filter((p) => p > 0).sort((a, b) => a - b);
  const sold = items.filter((i) => typeof i.sold_quantity === "number");
  const fs = items.filter((i) => i.free_shipping !== null);
  return {
    count: items.length,
    price_min: prices[0] ?? null,
    price_p25: quantile(prices, 0.25),
    price_median: quantile(prices, 0.5),
    price_p75: quantile(prices, 0.75),
    price_max: prices.at(-1) ?? null,
    sellers: new Set(items.map((i) => i.seller_id).filter(Boolean)).size,
    official_stores: items.filter((i) => i.official_store).length,
    free_shipping_pct: fs.length ? Math.round((fs.filter((i) => i.free_shipping).length / fs.length) * 100) : null,
    sold_signal: sold.length ? sold.reduce((s, i) => s + (i.sold_quantity ?? 0), 0) : null,
    with_sold_data: sold.length,
  };
}

/**
 * Pesquisa de mercado com dados públicos oficiais.
 * Importante: o Mercado Livre restringe a busca pública para alguns aplicativos; quando isso ocorre,
 * usamos a busca de catálogo e registramos a limitação. Quantidade vendida só aparece quando a API a fornece.
 */
export async function research(query: string, userId?: number): Promise<ResearchResult & { id: number }> {
  const limitations: string[] = [];
  let items: MarketItem[] = [];
  let source = "sites/search";
  let total: number | null = null;

  try {
    const r = await ml<any>(`/sites/${config.ml.siteId}/search?q=${encodeURIComponent(query)}&limit=50`);
    total = r.paging?.total ?? null;
    items = (r.results ?? []).map((x: any) => ({
      id: x.id, title: x.title, price: x.price, thumbnail: x.thumbnail?.replace(/^http:/, "https:") ?? null, permalink: x.permalink ?? null,
      seller_id: x.seller?.id ?? null, official_store: !!x.official_store_id, free_shipping: x.shipping?.free_shipping ?? null,
      listing_type_id: x.listing_type_id ?? null, sold_quantity: typeof x.sold_quantity === "number" ? x.sold_quantity : null,
    }));
  } catch (e) {
    if (!(e instanceof MLApiError) || ![401, 403, 404].includes(e.mlStatus)) throw e;
    limitations.push("A busca pública de anúncios (/sites/search) não está liberada para este aplicativo. Usada a busca de catálogo, com menos sinais de demanda.");
    source = "products/search";
    const r = await ml<any>(`/products/search?status=active&site_id=${config.ml.siteId}&q=${encodeURIComponent(query)}&limit=20`);
    total = r.paging?.total ?? null;
    const products: any[] = r.results ?? [];
    const withItems = await mapLimit(products.slice(0, 15), 3, async (p) => {
      try {
        const it = await ml<any>(`/products/${p.id}/items?limit=10`);
        return (it.results ?? []).map((x: any) => ({
          id: x.item_id, title: p.name, price: x.price, thumbnail: p.pictures?.[0]?.url ?? null, permalink: null,
          seller_id: x.seller_id ?? null, official_store: !!x.official_store_id, free_shipping: x.shipping?.free_shipping ?? null,
          listing_type_id: x.listing_type_id ?? null, sold_quantity: null,
        }));
      } catch { return []; }
    });
    items = withItems.flat();
  }

  // Avaliações dos 8 primeiros (quando disponíveis)
  await mapLimit(items.slice(0, 8), 3, async (it) => {
    try {
      const r = await ml<any>(`/reviews/item/${it.id}?limit=1`);
      it.reviews_total = r.paging?.total ?? null;
      it.rating = r.rating_average ?? null;
    } catch { /* avaliações indisponíveis */ }
  });
  if (items.every((i) => i.sold_quantity === null)) limitations.push("A API não informou quantidades vendidas destes anúncios: a demanda não pode ser medida diretamente.");

  let category: ResearchResult["category"] = null;
  try {
    const d = await ml<any[]>(`/sites/${config.ml.siteId}/domain_discovery/search?limit=1&q=${encodeURIComponent(query)}`);
    if (d[0]) category = { id: d[0].category_id, name: d[0].category_name };
  } catch { limitations.push("Não foi possível identificar a categoria automaticamente."); }

  let trends: string[] = [];
  if (category) {
    try {
      const t = await ml<any[]>(`/trends/${config.ml.siteId}/${category.id}`);
      trends = t.slice(0, 20).map((x) => x.keyword);
    } catch { limitations.push("Tendências de busca indisponíveis para esta categoria."); }
  }

  const result: ResearchResult = { query, source, category, total_results: total, items, stats: computeStats(items), trends, limitations };
  const r = q.run("INSERT INTO market_research (query, category_id, created_by, data, limitations) VALUES (?,?,?,?,?)", [
    query, category?.id ?? null, userId ?? null, JSON.stringify(result), JSON.stringify(limitations),
  ]);
  return { id: Number(r.lastInsertRowid), ...result };
}

/** Tendências de busca do site (termos em alta). */
export async function siteTrends(categoryId?: string) {
  return ml<{ keyword: string; url: string }[]>(`/trends/${config.ml.siteId}${categoryId ? `/${categoryId}` : ""}`);
}

export const DEFAULT_3D_SEEDS = [
  "impressão 3d decoração", "suporte headset impresso 3d", "organizador de mesa 3d", "vaso impressão 3d",
  "luminária 3d", "suporte controle videogame", "porta temperos organizador", "chaveiro personalizado 3d",
  "miniatura impressa 3d", "suporte celular mesa", "peça reposição impressa 3d", "cachepot geométrico",
];

const OppSchema = z.object({
  oportunidades: z.array(z.object({
    nome: z.string(),
    pesquisa_origem: z.string().describe("Termo pesquisado de onde vem a evidência"),
    imagem_referencia_id: z.string().describe("ID de um anúncio da pesquisa para usar como imagem de referência, ou vazio"),
    custo_fabricacao_estimado: z.number().describe("Estimativa em R$ por unidade (material + energia + mão de obra). É ESTIMATIVA."),
    premissas_custo: z.string(),
    dificuldade_producao: z.enum(["baixa", "média", "alta"]),
    potencial_comercial: z.enum(["baixo", "médio", "alto"]),
    diferenciacao: z.string().describe("Como se diferenciar dos concorrentes observados"),
    motivo: z.string().describe("Por que é uma oportunidade, citando os dados disponíveis"),
    nota_demanda: z.string().describe("O que os dados mostram sobre demanda, deixando claro o que é estimativa"),
  })),
  observacoes_gerais: z.string(),
});

/** Gera oportunidades a partir de pesquisas reais; margem é calculada com tarifa oficial e preço mediano observado. */
export async function generateOpportunities(researchIds: number[], context: string) {
  const rows = researchIds.length
    ? q.all<any>(`SELECT id, query, data FROM market_research WHERE id IN (${researchIds.map(() => "?").join(",")})`, researchIds)
    : q.all<any>("SELECT id, query, data FROM market_research ORDER BY id DESC LIMIT 12");
  if (!rows.length) throw new Error("Faça ao menos uma pesquisa de mercado antes de gerar oportunidades.");
  const researches = rows.map((r) => {
    const d = json.parse<ResearchResult>(r.data, {} as ResearchResult);
    return {
      research_id: r.id, query: r.query, category: d.category, total_results: d.total_results, stats: d.stats, trends: d.trends?.slice(0, 10), limitations: d.limitations,
      amostra: d.items?.slice(0, 15).map((i) => ({ id: i.id, titulo: i.title, preco: i.price, vendidos: i.sold_quantity, avaliacoes: i.reviews_total, nota: i.rating, loja_oficial: i.official_store })),
    };
  });
  const started = Date.now();
  let out;
  try {
    const msg = await ai().beta.messages.parse({
      ...common(),
      max_tokens: 16000,
      output_config: { effort: "high", format: betaZodOutputFormat(OppSchema) },
      system: `Você é analista de inteligência de mercado para o Mercado Livre Brasil, especialista em produtos de impressão 3D.
Use apenas os dados das pesquisas fornecidas. Quantidade de anúncios, avaliações e vendidos visíveis NÃO são demanda completa: deixe isso explícito.
Custos de fabricação são estimativas suas: explique as premissas (gramas de filamento, tempo de impressão, preço de material).`,
      messages: [{ role: "user", content: `Contexto da loja: ${context || "loja de produtos impressos em 3D"}\n\nPesquisas:\n${JSON.stringify(researches)}\n\nListe até 10 oportunidades, das mais promissoras para as menos.` }],
    });
    checkStop(msg);
    logAi("messages/opportunities", started, 200);
    out = msg.parsed_output;
    if (!out) throw new Error("Resposta da IA fora do formato esperado");
  } catch (e) {
    logAi("messages/opportunities", started, 500, (e as Error).message);
    aiError(e);
  }

  const created = [];
  for (const o of out.oportunidades) {
    const res = researches.find((r) => r.query === o.pesquisa_origem) ?? researches[0]!;
    const st = res.stats;
    const full = json.parse<ResearchResult>(rows.find((r) => r.id === res.research_id)?.data, {} as ResearchResult);
    const ref = full.items?.find((i) => i.id === o.imagem_referencia_id) ?? full.items?.[0];
    let margin: number | null = null;
    if (st.price_median) {
      try {
        const fee = await fetchFee(st.price_median, res.category?.id);
        margin = ((st.price_median * (1 - fee.percentage) - fee.fixed - o.custo_fabricacao_estimado) / st.price_median) * 100;
      } catch { margin = null; }
    }
    const r = q.run(
      `INSERT INTO opportunities (research_id, name, image, category_id, category_name, price_min, price_median, price_max, competitors, sold_signal, demand_note,
         est_cost, margin_pct, difficulty, potential, rationale, evidence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        res.research_id, o.nome, ref?.thumbnail ?? null, res.category?.id ?? null, res.category?.name ?? null, st.price_min, st.price_median, st.price_max,
        st.sellers, st.sold_signal, o.nota_demanda, o.custo_fabricacao_estimado, margin === null ? null : Math.round(margin * 10) / 10,
        o.dificuldade_producao, o.potencial_comercial, `${o.motivo}\n\nDiferenciação: ${o.diferenciacao}`,
        JSON.stringify({ query: res.query, total_results: res.total_results, stats: st, cost_assumptions: o.premissas_custo, limitations: res.limitations, margin_note: "Margem estimada = (preço mediano − tarifa ML − custo estimado) / preço mediano; não inclui frete, impostos e publicidade." }),
      ],
    );
    created.push(Number(r.lastInsertRowid));
  }
  return { created: created.length, notes: out.observacoes_gerais };
}
