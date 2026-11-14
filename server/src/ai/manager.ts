import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ai, common, checkStop, aiError, logAi, textOf } from "./claude.ts";
import { storeSnapshot } from "../services/metrics.ts";
import { q, json } from "../db/index.ts";

/** Instruções fixas do "Gerente da Loja" (estáveis para aproveitar cache de prompt). */
const SYSTEM = `Você é o Gerente Comercial de IA da plataforma MERCADO LIVRE INTELLIGENCE, especialista em e-commerce no Mercado Livre Brasil,
com foco em lojas de produtos fabricados por impressão 3D e produção própria.

Regras inegociáveis:
1. Use SOMENTE os dados fornecidos no snapshot JSON da loja. Nunca invente vendas, preços, visitas, concorrentes ou resultados.
2. Toda recomendação deve trazer: o que fazer, por que (motivo), os números do snapshot que a justificam e o impacto potencial estimado.
3. Estimativas de impacto devem explicitar a premissa (ex.: "se a conversão se mantiver em 3,1%..."). Classifique a confiança (baixa/média/alta).
4. Se um dado necessário não existir (veja "data_gaps"), diga claramente o que falta e como obtê-lo, em vez de supor.
5. Diferencie fatos (dados) de hipóteses (opinião profissional).
6. Responda em português do Brasil, de forma objetiva e prática, como um gerente experiente falaria com o dono da loja.
7. Valores monetários em reais (R$). Datas no formato brasileiro.
8. Você não executa ações. Quando sugerir alterar preço, pausar anúncio, responder clientes etc., lembre que o dono precisa aprovar na Central de Aprovações.`;

function snapshotBlock() {
  const snap = storeSnapshot();
  return { snap, text: `<snapshot_da_loja>\n${JSON.stringify(snap)}\n</snapshot_da_loja>` };
}

/** Pergunta livre ao gerente de IA. */
export async function askManager(question: string, history: { role: "user" | "assistant"; content: string }[], userId: number) {
  const { snap, text } = snapshotBlock();
  const started = Date.now();
  try {
    const stream = ai().beta.messages.stream({
      ...common(),
      max_tokens: 32000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [
        { role: "user", content: [{ type: "text", text, cache_control: { type: "ephemeral" } }, { type: "text", text: "Este é o estado atual da loja. Aguarde minhas perguntas." }] },
        { role: "assistant", content: "Entendido. Analisei o snapshot da loja e estou pronto para responder com base nesses dados." },
        ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: question },
      ],
    });
    const msg = await stream.finalMessage();
    checkStop(msg);
    logAi("messages/manager", started, 200);
    const answer = textOf(msg.content);
    q.run("INSERT INTO ai_reports (kind, created_by, question, content, model, usage) VALUES ('chat',?,?,?,?,?)", [
      userId, question, answer, msg.model, JSON.stringify(msg.usage),
    ]);
    return { answer, generated_at: snap.generated_at, data_gaps: snap.data_gaps };
  } catch (e) {
    logAi("messages/manager", started, 500, (e as Error).message);
    aiError(e);
  }
}

const evidence = z.string().describe("Números do snapshot que justificam o item (ex.: '42 un. em 30d, margem 31%')");
const ReportSchema = z.object({
  resumo_vendas: z.string().describe("Resumo das vendas do período com números"),
  mais_vendidos: z.array(z.object({ listing_id: z.string(), titulo: z.string(), destaque: z.string(), evidencia: evidence })),
  queda_desempenho: z.array(z.object({ listing_id: z.string(), titulo: z.string(), diagnostico: z.string(), evidencia: evidence, acao_sugerida: z.string() })),
  oportunidades: z.array(z.object({ titulo: z.string(), descricao: z.string(), evidencia: evidence, impacto_estimado: z.string(), confianca: z.enum(["baixa", "média", "alta"]) })),
  alertas_estoque: z.array(z.object({ titulo: z.string(), situacao: z.string(), evidencia: evidence, acao: z.string() })),
  recomendacoes_preco: z.array(
    z.object({
      listing_id: z.string(), titulo: z.string(), preco_atual: z.number(), preco_sugerido: z.number(),
      motivo: z.string(), evidencia: evidence, impacto_estimado: z.string(), confianca: z.enum(["baixa", "média", "alta"]),
    }),
  ),
  sugestoes_novos_produtos: z.array(z.object({ ideia: z.string(), motivo: z.string(), base_nos_dados: z.string() })),
  acoes_prioritarias: z.array(
    z.object({ prioridade: z.number().int(), acao: z.string(), motivo: z.string(), evidencia: evidence, impacto_estimado: z.string(), requer_aprovacao: z.boolean() }),
  ),
  limitacoes: z.array(z.string()).describe("Dados ausentes ou incertezas que limitam a análise"),
});
export type DailyReport = z.infer<typeof ReportSchema>;

/** Relatório diário estruturado (8 seções). */
export async function generateDailyReport(userId: number | null) {
  const { snap, text } = snapshotBlock();
  const started = Date.now();
  try {
    const msg = await ai().beta.messages.parse({
      ...common(),
      max_tokens: 16000,
      output_config: { effort: "high", format: betaZodOutputFormat(ReportSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text },
            {
              type: "text",
              text: `Gere o relatório diário da loja para ${snap.today_local}. Seja específico e use apenas os dados acima.
Listas podem ficar vazias quando não houver evidência. Em recomendações de preço, só sugira quando houver margem calculada, conversão ou tendência que justifique;
mantenha variações prudentes (até ±10%) e explique o risco. Ordene as ações prioritárias pelo impacto esperado no faturamento e lucro.`,
            },
          ],
        },
      ],
    });
    checkStop(msg);
    if (!msg.parsed_output) throw new Error("Resposta da IA fora do formato esperado");
    logAi("messages/daily_report", started, 200);
    const r = q.run("INSERT INTO ai_reports (kind, created_by, content, data_snapshot, model, usage) VALUES ('daily',?,?,?,?,?)", [
      userId, JSON.stringify(msg.parsed_output), JSON.stringify(snap), msg.model, JSON.stringify(msg.usage),
    ]);
    return { id: Number(r.lastInsertRowid), report: msg.parsed_output, generated_at: snap.generated_at, data_gaps: snap.data_gaps };
  } catch (e) {
    logAi("messages/daily_report", started, 500, (e as Error).message);
    aiError(e);
  }
}

export function latestDailyReport() {
  const r = q.get<any>("SELECT id, created_at, content, model, data_snapshot FROM ai_reports WHERE kind='daily' ORDER BY id DESC LIMIT 1");
  if (!r) return null;
  const snap = json.parse<any>(r.data_snapshot, {});
  return { id: r.id, created_at: r.created_at, model: r.model, report: json.parse<DailyReport | null>(r.content, null), data_gaps: snap.data_gaps ?? [] };
}
