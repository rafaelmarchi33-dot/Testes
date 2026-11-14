import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ai, common, checkStop, aiError, logAi } from "./claude.ts";
import { config } from "../config.ts";

export interface ProductInput {
  name?: string;
  material?: string;
  dimensions?: string;
  weight_g?: number;
  features?: string;
  category_hint?: string;
  quantity?: number;
  package_contents?: string;
  usage?: string;
}

const SYSTEM = `Você é especialista em criação de anúncios de alta conversão para o Mercado Livre Brasil, incluindo SEO interno do marketplace,
com experiência em produtos fabricados por impressão 3D (PLA, PETG, ABS, resina etc.).

Regras:
- Nunca invente especificações. Se algo não foi informado pelo vendedor e não é visível na foto com segurança, marque como "a confirmar".
- Separe claramente o que foi INFORMADO pelo vendedor, o que foi INFERIDO da imagem e o que PRECISA DE CONFIRMAÇÃO.
- Não use marcas registradas de terceiros, personagens licenciados ou termos enganosos (ex.: "original", "oficial") sem autorização confirmada.
- Não prometa prazos, garantias ou resultados não informados.
- Títulos do Mercado Livre: produto + principais características buscadas (material, tamanho, uso, cor); sem caixa alta excessiva, sem emojis,
  sem símbolos promocionais ("promoção", "frete grátis", "oferta"), sem repetir palavras. Respeite o limite de caracteres informado.
- Descrição em texto puro (sem HTML, sem links, sem contatos externos), organizada em seções com títulos em MAIÚSCULAS.`;

const imageBlocks = (files: string[]): Anthropic.Beta.BetaImageBlockParam[] =>
  files.slice(0, 8).map((f) => {
    const abs = path.join(config.dataDir, "uploads", path.basename(f));
    const ext = path.extname(abs).toLowerCase();
    const media_type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
    return { type: "image", source: { type: "base64", media_type, data: fs.readFileSync(abs).toString("base64") } };
  });

// ---------------- Etapa 1: identificação visual ----------------
const IdentifySchema = z.object({
  produto_identificado: z.string(),
  descricao_visual: z.string(),
  provavel_material: z.string().describe("Material provável ou 'a confirmar'"),
  provavel_processo: z.string().describe("Ex.: impressão 3D FDM, resina, injeção, ou 'a confirmar'"),
  cores_visiveis: z.array(z.string()),
  caracteristicas_visiveis: z.array(z.string()),
  termo_busca_categoria: z.string().describe("Nome genérico curto do produto para classificar a categoria no Mercado Livre"),
  informacoes_a_confirmar: z.array(z.string()).describe("Itens que o vendedor deve confirmar (dimensões, peso, material etc.)"),
  riscos: z.array(z.string()).describe("Possíveis problemas: propriedade intelectual, item proibido, qualidade das fotos"),
  qualidade_fotos: z.string(),
  confianca: z.enum(["baixa", "média", "alta"]),
});
export type Identification = z.infer<typeof IdentifySchema>;

export async function identifyProduct(input: ProductInput, images: string[]): Promise<Identification> {
  const started = Date.now();
  try {
    const msg = await ai().beta.messages.parse({
      ...common(),
      max_tokens: 8000,
      output_config: { effort: "medium", format: betaZodOutputFormat(IdentifySchema) },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          ...imageBlocks(images),
          { type: "text", text: `Analise as fotos do produto${images.length ? "" : " (nenhuma foto enviada)"} e as informações do vendedor abaixo. Identifique o produto.\n\nInformações do vendedor (JSON):\n${JSON.stringify(input)}` },
        ],
      }],
    });
    checkStop(msg);
    logAi("messages/identify", started, 200);
    if (!msg.parsed_output) throw new Error("Resposta da IA fora do formato esperado");
    return msg.parsed_output;
  } catch (e) {
    logAi("messages/identify", started, 500, (e as Error).message);
    aiError(e);
  }
}

// ---------------- Etapa 2: redação do anúncio ----------------
const ComposeSchema = z.object({
  titulo: z.string(),
  titulos_alternativos: z.array(z.string()),
  palavras_chave: z.array(z.string()),
  descricao: z.string().describe("Descrição completa em texto puro com seções: APRESENTAÇÃO, BENEFÍCIOS, CARACTERÍSTICAS TÉCNICAS, MATERIAL, DIMENSÕES, CONTEÚDO DA EMBALAGEM, COMO USAR, DIFERENCIAIS, PERGUNTAS FREQUENTES"),
  atributos: z.array(z.object({
    id: z.string().describe("ID do atributo da categoria"),
    valor: z.string(),
    origem: z.enum(["informado", "inferido", "a_confirmar"]),
  })),
  sku_sugerido: z.string(),
  sugestoes_imagens: z.array(z.string()).describe("Fotos adicionais recomendadas para aumentar conversão"),
  pontos_a_confirmar: z.array(z.string()),
  justificativa_titulo: z.string().describe("Por que essas palavras foram escolhidas"),
});
export type Composition = z.infer<typeof ComposeSchema>;

export async function composeListing(args: {
  input: ProductInput;
  images: string[];
  identification: Identification | null;
  category: { id: string; name: string; path: string; max_title_length: number } | null;
  attributes: { id: string; name: string; required: boolean; values: { id: string; name: string }[]; allowed_units: string[] }[];
  marketTitles: string[];
}): Promise<Composition> {
  const started = Date.now();
  const attrs = args.attributes.slice(0, 80).map((a) => ({
    id: a.id, nome: a.name, obrigatorio: a.required, valores_permitidos: a.values.slice(0, 25).map((v) => v.name), unidades: a.allowed_units,
  }));
  const prompt = `Crie o anúncio completo para o Mercado Livre.

Informações do vendedor (fonte confiável): ${JSON.stringify(args.input)}
Identificação visual (pode conter erros; trate como inferência): ${JSON.stringify(args.identification)}
Categoria escolhida: ${args.category ? `${args.category.path} (${args.category.id})` : "não definida"}
Limite de caracteres do título: ${args.category?.max_title_length ?? 60}
Atributos da categoria (preencha os obrigatórios; use exatamente os IDs; quando houver valores permitidos, use um deles):
${JSON.stringify(attrs)}
Títulos de anúncios concorrentes para referência de termos buscados (não copie):
${JSON.stringify(args.marketTitles.slice(0, 20))}

Para atributos sem informação segura, use origem "a_confirmar" e valor vazio ou sua melhor sugestão claramente marcada.`;
  try {
    const msg = await ai().beta.messages.parse({
      ...common(),
      max_tokens: 16000,
      output_config: { effort: "high", format: betaZodOutputFormat(ComposeSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: [...imageBlocks(args.images.slice(0, 4)), { type: "text", text: prompt }] }],
    });
    checkStop(msg);
    logAi("messages/compose", started, 200);
    if (!msg.parsed_output) throw new Error("Resposta da IA fora do formato esperado");
    const out = msg.parsed_output;
    const max = args.category?.max_title_length ?? 60;
    out.titulo = out.titulo.slice(0, max).trim();
    out.titulos_alternativos = out.titulos_alternativos.map((t) => t.slice(0, max).trim());
    return out;
  } catch (e) {
    logAi("messages/compose", started, 500, (e as Error).message);
    aiError(e);
  }
}
