import fs from "node:fs";
import ExcelJS from "exceljs";
import { q, json } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";
import { localDayStartUtc } from "../lib/dates.ts";

/* ======================================================================
 * Definições de importação: campos, sinônimos de cabeçalho e validação.
 * Os sinônimos cobrem os relatórios exportados do Mercado Livre e da Shopee.
 * ==================================================================== */
type FieldType = "text" | "int" | "money" | "num" | "date" | "pct";
interface FieldDef { key: string; label: string; type: FieldType; required?: boolean; synonyms: string[] }
export interface ImportKindDef { key: string; label: string; description: string; fields: FieldDef[] }

export const IMPORT_KINDS: Record<string, ImportKindDef> = {
  orders: {
    key: "orders", label: "Vendas / pedidos", description: "Relatório de vendas do Mercado Livre (Vendas › Exportar) ou da Shopee. Uma linha por item vendido.",
    fields: [
      { key: "order_id", label: "Nº da venda/pedido", type: "text", required: true, synonyms: ["n de venda", "no de venda", "numero de venda", "n da venda", "id do pedido", "order id", "pedido", "venda", "order"] },
      { key: "date", label: "Data da venda", type: "date", required: true, synonyms: ["data da venda", "data do pedido", "data de criacao do pedido", "data", "date", "created"] },
      { key: "status", label: "Estado/status", type: "text", synonyms: ["estado", "status do pedido", "status", "descricao do status"] },
      { key: "listing_id", label: "Nº do anúncio", type: "text", synonyms: ["de anuncio", "n do anuncio", "id do anuncio", "anuncio id", "item id", "mlb"] },
      { key: "sku", label: "SKU", type: "text", synonyms: ["sku", "sku de referencia", "codigo", "sku principal"] },
      { key: "title", label: "Título do produto", type: "text", synonyms: ["titulo do anuncio", "nome do produto", "titulo", "produto", "title"] },
      { key: "quantity", label: "Unidades", type: "int", required: true, synonyms: ["unidades", "quantidade", "qtd", "quantity"] },
      { key: "unit_price", label: "Preço unitário", type: "money", synonyms: ["preco unitario de venda do anuncio", "preco unitario", "preco acordado", "preco de venda", "unit price", "preco"] },
      { key: "total", label: "Receita do item/total", type: "money", synonyms: ["receita por produtos", "subtotal do produto", "valor total", "total do pedido", "receita", "total"] },
      { key: "sale_fee", label: "Tarifa de venda (total da linha)", type: "money", synonyms: ["tarifa de venda e impostos", "tarifa de venda", "taxa de comissao", "comissao", "taxa de servico"] },
      { key: "channel", label: "Canal", type: "text", synonyms: ["canal de venda", "canal", "marketplace"] },
    ],
  },
  listings: {
    key: "listings", label: "Anúncios", description: "Lista de anúncios com preço, estoque, visitas, vendas e qualidade.",
    fields: [
      { key: "listing_id", label: "Nº do anúncio", type: "text", required: true, synonyms: ["de anuncio", "n do anuncio", "id do anuncio", "codigo do anuncio", "item id", "mlb", "id"] },
      { key: "title", label: "Título", type: "text", required: true, synonyms: ["titulo do anuncio", "titulo", "nome", "title"] },
      { key: "sku", label: "SKU", type: "text", synonyms: ["sku", "codigo"] },
      { key: "price", label: "Preço", type: "money", synonyms: ["preco atual", "preco", "price"] },
      { key: "original_price", label: "Preço original", type: "money", synonyms: ["preco original", "preco sem desconto", "preco de"] },
      { key: "stock", label: "Estoque", type: "int", synonyms: ["estoque", "quantidade disponivel", "disponivel", "stock"] },
      { key: "visits", label: "Visitas", type: "int", synonyms: ["visitas", "visits", "visualizacoes"] },
      { key: "sold", label: "Vendas/unidades vendidas", type: "int", synonyms: ["vendas", "vendidos", "unidades vendidas", "sold"] },
      { key: "quality", label: "Qualidade (0–100)", type: "num", synonyms: ["qualidade", "saude", "health", "quality"] },
      { key: "status", label: "Situação", type: "text", synonyms: ["situacao", "status", "estado"] },
      { key: "channel", label: "Canal", type: "text", synonyms: ["canal", "marketplace"] },
    ],
  },
  period_report: {
    key: "period_report", label: "Métricas do período", description: "Resumo agregado (vendas brutas, unidades, visitas, conversão) — também extraído de PDF do painel de métricas.",
    fields: [
      { key: "date_from", label: "Início do período", type: "date", required: true, synonyms: ["inicio", "data inicial", "de", "from"] },
      { key: "date_to", label: "Fim do período", type: "date", required: true, synonyms: ["fim", "data final", "ate", "to"] },
      { key: "gross_sales", label: "Vendas brutas", type: "money", required: true, synonyms: ["vendas brutas", "faturamento", "gross"] },
      { key: "units", label: "Unidades vendidas", type: "int", synonyms: ["unidades vendidas", "unidades"] },
      { key: "sales_count", label: "Quantidade de vendas", type: "int", synonyms: ["quantidade de vendas", "vendas"] },
      { key: "visits", label: "Visitas", type: "int", synonyms: ["visitas"] },
      { key: "conversion_pct", label: "Conversão (%)", type: "pct", synonyms: ["conversao"] },
      { key: "avg_unit_price", label: "Preço médio por unidade", type: "money", synonyms: ["preco medio por unidade", "preco medio"] },
      { key: "channel", label: "Canal", type: "text", synonyms: ["canal"] },
    ],
  },
  ads: {
    key: "ads", label: "Publicidade", description: "Relatório de campanhas (Product Ads ou Shopee Ads) por dia.",
    fields: [
      { key: "date", label: "Data", type: "date", required: true, synonyms: ["data", "dia", "date"] },
      { key: "campaign", label: "Campanha", type: "text", required: true, synonyms: ["campanha", "nome da campanha", "campaign"] },
      { key: "prints", label: "Impressões", type: "int", synonyms: ["impressoes", "impressions", "prints"] },
      { key: "clicks", label: "Cliques", type: "int", synonyms: ["cliques", "clicks"] },
      { key: "cost", label: "Investimento", type: "money", required: true, synonyms: ["investimento", "custo", "gasto", "despesa", "cost"] },
      { key: "revenue", label: "Receita atribuída", type: "money", synonyms: ["receita", "vendas por publicidade", "vendas atribuidas", "gmv", "revenue"] },
      { key: "units", label: "Unidades/vendas", type: "int", synonyms: ["unidades vendidas", "vendas", "conversoes", "units"] },
    ],
  },
  visits: {
    key: "visits", label: "Visitas diárias", description: "Visitas por dia (da loja ou de um anúncio).",
    fields: [
      { key: "date", label: "Data", type: "date", required: true, synonyms: ["data", "dia", "date"] },
      { key: "visits", label: "Visitas", type: "int", required: true, synonyms: ["visitas", "visits"] },
      { key: "listing_id", label: "Nº do anúncio (vazio = loja)", type: "text", synonyms: ["de anuncio", "id do anuncio", "anuncio", "item id"] },
    ],
  },
  products: {
    key: "products", label: "Produtos (ficha técnica)", description: "SKU, nome, peso, tempo de impressão e material para os cálculos de custo.",
    fields: [
      { key: "sku", label: "SKU", type: "text", synonyms: ["sku", "codigo"] },
      { key: "name", label: "Nome", type: "text", required: true, synonyms: ["nome", "produto", "titulo", "name"] },
      { key: "category", label: "Categoria", type: "text", synonyms: ["categoria", "category"] },
      { key: "weight_g", label: "Peso (g)", type: "num", synonyms: ["peso", "gramas", "weight"] },
      { key: "print_minutes", label: "Tempo de impressão (min)", type: "num", synonyms: ["tempo de impressao", "minutos", "tempo", "print time"] },
      { key: "material", label: "Material", type: "text", synonyms: ["material", "filamento"] },
      { key: "stock", label: "Estoque físico", type: "int", synonyms: ["estoque", "quantidade"] },
    ],
  },
};

/* ======================================================================
 * Leitura de arquivos
 * ==================================================================== */
export const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", ",", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (inQ) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

async function parseXlsx(file: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  // Usa a planilha com mais linhas preenchidas
  const sheet = [...wb.worksheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const vals: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
      const v = r.getCell(c).value as any;
      if (v === null || v === undefined) vals.push("");
      else if (v instanceof Date) vals.push(v.toISOString());
      else if (typeof v === "object" && "result" in v) vals.push(String(v.result ?? ""));
      else if (typeof v === "object" && "richText" in v) vals.push(v.richText.map((x: any) => x.text).join(""));
      else if (typeof v === "object" && "text" in v) vals.push(String(v.text));
      else vals.push(String(v));
    }
    rows.push(vals);
  });
  return rows;
}

export async function pdfText(file: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

/* ======================================================================
 * Conversão de valores (formatos brasileiros)
 * ==================================================================== */
const MONTHS: Record<string, number> = { jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4, mai: 5, maio: 5, jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8, set: 9, setembro: 9, out: 10, outubro: 10, nov: 11, novembro: 11, dez: 12, dezembro: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

/** Retorna ISO (data local AAAA-MM-DD ou instante ISO) ou null. */
export function parseDate(raw: string): { day: string; iso: string } | null {
  const s = raw.trim();
  if (!s) return null;
  let y: number, m: number, d: number, hh = 12, mm = 0;
  let mt: RegExpMatchArray | null;
  if ((mt = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/))) {
    if (s.length > 10 && /Z|[+-]\d{2}:?\d{2}$/.test(s)) { const t = new Date(s); if (!Number.isNaN(t.getTime())) return { day: new Date(t.getTime() - 3 * 3_600_000).toISOString().slice(0, 10), iso: t.toISOString() }; }
    [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
    if (mt[4]) { hh = Number(mt[4]); mm = Number(mt[5]); }
  } else if ((mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/))) {
    [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
    if (y < 100) y += 2000;
    if (mt[4]) { hh = Number(mt[4]); mm = Number(mt[5]); }
  } else if ((mt = normalize(s).match(/^(\d{1,2}) de ([a-z]+) de (\d{4})(?: (\d{1,2}) (\d{2}))?/))) {
    d = Number(mt[1]); m = MONTHS[mt[2]!] ?? 0; y = Number(mt[3]);
    if (mt[4]) { hh = Number(mt[4]); mm = Number(mt[5]); }
  } else return null;
  if (!m || m > 12 || !d || d > 31 || y < 2000 || y > 2100) return null;
  const day = `${y}-${pad(m)}-${pad(d)}`;
  // Horário informado é local da loja (UTC-3)
  const iso = new Date(Date.parse(`${day}T${pad(hh)}:${pad(mm)}:00.000Z`) + 3 * 3_600_000).toISOString();
  return { day, iso };
}

/** Número em formato brasileiro ou internacional ("R$ 1.234,56", "1234.56", "-12,5%"). */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/R\$|BRL|%|\s/gi, "");
  if (!s || s === "-") return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/* ======================================================================
 * Mapeamento automático e prévia
 * ==================================================================== */
function scoreHeader(h: string, f: FieldDef): number {
  const n = normalize(h);
  if (!n) return 0;
  let best = 0;
  for (const syn of f.synonyms) {
    if (n === syn) best = Math.max(best, 100 + syn.length);
    else if (n.startsWith(syn)) best = Math.max(best, 60 + syn.length);
    else if (n.includes(syn)) best = Math.max(best, 30 + syn.length);
  }
  return best;
}

/** Encontra a linha de cabeçalho (relatórios do ML têm linhas de título antes dela). */
function findHeaderRow(rows: string[][], def: ImportKindDef) {
  let best = { idx: 0, score: -1 };
  rows.slice(0, 20).forEach((r, idx) => {
    const score = def.fields.reduce((s, f) => s + (r.some((h) => scoreHeader(h, f) > 0) ? 1 : 0), 0);
    if (score > best.score) best = { idx, score };
  });
  return best.idx;
}

export function autoMap(headers: string[], def: ImportKindDef): Record<string, number | null> {
  const used = new Set<number>();
  const map: Record<string, number | null> = {};
  // campos com sinônimos mais específicos primeiro
  const candidates = def.fields.flatMap((f) => headers.map((h, i) => ({ f: f.key, i, s: scoreHeader(h, f) }))).filter((c) => c.s > 0).sort((a, b) => b.s - a.s);
  for (const f of def.fields) map[f.key] = null;
  for (const c of candidates) {
    if (map[c.f] !== null || used.has(c.i)) continue;
    map[c.f] = c.i;
    used.add(c.i);
  }
  return map;
}

/** Sugere o tipo de importação a partir dos cabeçalhos. */
export function guessKind(headers: string[]): string {
  let best = { k: "orders", s: -1 };
  for (const def of Object.values(IMPORT_KINDS)) {
    const m = autoMap(headers, def);
    const req = def.fields.filter((f) => f.required);
    const s = req.filter((f) => m[f.key] !== null).length / req.length * 10 + Object.values(m).filter((v) => v !== null).length;
    if (s > best.s) best = { k: def.key, s };
  }
  return best.k;
}

export interface Issue { row: number; field?: string; level: "error" | "warning"; message: string }
export interface ParsedRow { row: number; values: Record<string, any>; errors: string[]; warnings: string[]; duplicate?: boolean }

function convert(type: FieldType, raw: string) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return { v: null };
  const s = String(raw);
  switch (type) {
    case "text": return { v: s.trim() };
    case "int": { const n = parseNumber(s); return n === null ? { e: "número inválido" } : !Number.isInteger(n) ? { v: Math.round(n), w: "arredondado para inteiro" } : { v: n }; }
    case "money": case "num": case "pct": { const n = parseNumber(s); return n === null ? { e: "valor inválido" } : { v: n }; }
    case "date": { const d = parseDate(s); return d ? { v: d } : { e: "data inválida" }; }
  }
}

/** PDF do painel de métricas do ML → valores do relatório de período. */
export function parseMetricsText(text: string) {
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const num = (label: string) => {
    const m = t.match(new RegExp(`${label}[^\\d\\n-]{0,20}(-?\\d[\\d.,]*)`));
    return m ? parseNumber(m[1]!) : null;
  };
  const dates = [...text.matchAll(/(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2} de [a-zç]+(?: de \d{4})?)/gi)].map((m) => m[1]!);
  const year = text.match(/\b(20\d{2})\b/)?.[1];
  const ds = dates.map((d) => parseDate(/de \d{4}$/.test(d) || d.includes("/") ? d : `${d} de ${year ?? new Date().getFullYear()}`)).filter(Boolean) as { day: string }[];
  return {
    date_from: ds[0]?.day ?? null, date_to: ds[1]?.day ?? null,
    gross_sales: num("vendas brutas"), units: num("unidades vendidas"), sales_count: num("quantidade de vendas"),
    visits: num("visitas"), conversion_pct: num("conversao"), avg_unit_price: num("preco medio por unidade"),
  };
}

export async function readFileRows(file: string, originalName: string) {
  const ext = originalName.toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "txt") return { type: "csv", rows: parseCsv(fs.readFileSync(file, "utf8")) };
  if (ext === "xlsx") return { type: "xlsx", rows: await parseXlsx(file) };
  if (ext === "pdf") {
    const text = await pdfText(file);
    return { type: "pdf", rows: [] as string[][], text };
  }
  throw new HttpError(400, "Formato não suportado. Envie CSV, XLSX ou PDF.");
}

/** Monta a prévia: mapeamento, linhas convertidas e validações (duplicidade, datas, valores, SKUs, quantidades). */
export function buildPreview(kind: string, rows: string[][], mapping?: Record<string, number | null>, pdfValues?: Record<string, any>) {
  const def = IMPORT_KINDS[kind];
  if (!def) throw new HttpError(400, "Tipo de importação inválido");
  if (pdfValues) {
    const row: ParsedRow = { row: 1, values: {}, errors: [], warnings: [] };
    for (const f of def.fields) {
      const v = pdfValues[f.key];
      row.values[f.key] = f.type === "date" && typeof v === "string" ? { day: v, iso: v } : v ?? null;
      if (f.required && (v === null || v === undefined)) row.errors.push(`${f.label} não encontrado no PDF`);
    }
    return { def, headers: def.fields.map((f) => f.label), headerRow: 0, mapping: {}, parsed: [validatePeriod(row)] };
  }
  const headerRow = findHeaderRow(rows, def);
  const headers = (rows[headerRow] ?? []).map((h) => String(h ?? "").trim());
  const map = mapping ?? autoMap(headers, def);
  const body = rows.slice(headerRow + 1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const parsed: ParsedRow[] = body.map((r, i) => {
    const out: ParsedRow = { row: headerRow + i + 2, values: {}, errors: [], warnings: [] };
    for (const f of def.fields) {
      const col = map[f.key];
      const raw = col === null || col === undefined ? "" : String(r[col] ?? "");
      const c = convert(f.type, raw)!;
      if ("e" in c && c.e) out.errors.push(`${f.label}: ${c.e} ("${raw.slice(0, 40)}")`);
      if ("w" in c && c.w) out.warnings.push(`${f.label}: ${c.w}`);
      out.values[f.key] = "v" in c ? c.v : null;
      if (f.required && (out.values[f.key] === null || out.values[f.key] === undefined) && !("e" in c)) out.errors.push(`${f.label} obrigatório ausente`);
    }
    return out;
  });
  const missingRequired = def.fields.filter((f) => f.required && (map[f.key] === null || map[f.key] === undefined)).map((f) => f.label);
  validateKind(kind, parsed);
  return { def, headers, headerRow, mapping: map, parsed, missingRequired };
}

function validatePeriod(r: ParsedRow) {
  const v = r.values;
  if (v.date_from && v.date_to && v.date_from.day > v.date_to.day) r.errors.push("Início posterior ao fim do período");
  if (v.gross_sales != null && v.gross_sales < 0) r.errors.push("Vendas brutas negativas");
  if (v.date_from && v.date_to && q.get("SELECT 1 FROM period_reports WHERE date_from=? AND date_to=? AND channel=?", [v.date_from.day, v.date_to.day, v.channel ?? "mercadolivre"])) {
    r.duplicate = true; r.errors.push("Já existe relatório para este período e canal");
  }
  return r;
}

function validateKind(kind: string, rows: ParsedRow[]) {
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r.values;
    if (kind === "orders") {
      if (v.quantity !== null && v.quantity <= 0) r.errors.push("Quantidade deve ser maior que zero");
      if (v.unit_price === null && v.total === null) r.errors.push("Informe preço unitário ou receita do item");
      if (v.unit_price !== null && v.unit_price < 0) r.errors.push("Preço negativo");
      if (!v.listing_id && !v.sku && !v.title) r.errors.push("Item sem anúncio, SKU ou título");
      if (!v.sku) r.warnings.push("Sem SKU: o vínculo com o produto será feito pelo anúncio/título");
      const key = `${v.order_id}|${v.listing_id ?? v.sku ?? v.title}`;
      if (seen.has(key)) { r.duplicate = true; r.errors.push("Linha duplicada no arquivo"); }
      seen.add(key);
      if (v.order_id && q.get("SELECT 1 FROM orders WHERE id=?", [orderNumericId(String(v.order_id))])) { r.duplicate = true; r.errors.push("Pedido já existe no sistema"); }
    } else if (kind === "listings") {
      if (v.price !== null && v.price < 0) r.errors.push("Preço negativo");
      if (v.quality !== null && (v.quality < 0 || v.quality > 100)) r.errors.push("Qualidade fora de 0–100");
      if (seen.has(v.listing_id)) { r.duplicate = true; r.errors.push("Anúncio duplicado no arquivo"); }
      seen.add(v.listing_id);
      if (v.listing_id && q.get("SELECT 1 FROM listings WHERE id=?", [v.listing_id])) r.warnings.push("Anúncio já existe: serão atualizadas apenas visitas e qualidade");
    } else if (kind === "ads") {
      const key = `${v.date?.day}|${v.campaign}`;
      if (seen.has(key)) { r.duplicate = true; r.errors.push("Campanha/dia duplicados no arquivo"); }
      seen.add(key);
      if (v.cost !== null && v.cost < 0) r.errors.push("Investimento negativo");
    } else if (kind === "visits") {
      const key = `${v.date?.day}|${v.listing_id ?? "store"}`;
      if (seen.has(key)) { r.duplicate = true; r.errors.push("Data duplicada no arquivo"); }
      seen.add(key);
      if (v.visits !== null && v.visits < 0) r.errors.push("Visitas negativas");
      if (q.get("SELECT 1 FROM visits_daily WHERE scope=? AND date=?", [v.listing_id ?? "store", v.date?.day])) { r.duplicate = true; r.errors.push("Visitas desta data já registradas"); }
    } else if (kind === "products") {
      if (v.sku && seen.has(v.sku)) { r.duplicate = true; r.errors.push("SKU duplicado no arquivo"); }
      if (v.sku) seen.add(v.sku);
      if (v.weight_g !== null && v.weight_g <= 0) r.errors.push("Peso deve ser positivo");
      if (v.print_minutes !== null && v.print_minutes <= 0) r.errors.push("Tempo deve ser positivo");
    } else if (kind === "period_report") validatePeriod(r);
  }
}

/** IDs de pedido não numéricos (ex.: Shopee) viram um inteiro negativo estável, sem colidir com IDs do ML. */
export function orderNumericId(raw: string): number {
  const digits = raw.replace(/\s/g, "");
  if (/^\d{1,15}$/.test(digits)) return Number(digits);
  let h = 0;
  for (const c of digits) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return -Math.abs(h || 1);
}

const channelOf = (v: string | null | undefined) => {
  const n = normalize(v ?? "");
  return n.includes("shopee") ? "shopee" : n && !n.includes("mercado") && !n.includes("ml") ? n.replace(/\s+/g, "_").slice(0, 30) : "mercadolivre";
};
const statusOf = (v: string | null | undefined) => {
  const n = normalize(v ?? "");
  if (!n) return "paid";
  if (/cancel|devol|reembols|nao concret/.test(n)) return "cancelled";
  if (/pendente|aguardando pag|a pagar|unpaid/.test(n)) return "payment_required";
  return "paid";
};

/* ======================================================================
 * Efetivação e desfazer
 * ==================================================================== */
export function commitImport(importId: number, kind: string, parsed: ParsedRow[], userId: number) {
  const ok = parsed.filter((r) => !r.errors.length);
  const updates: any[] = [];
  let imported = 0;
  q.tx(() => {
    if (kind === "orders") {
      const byOrder = new Map<string, ParsedRow[]>();
      for (const r of ok) byOrder.set(String(r.values.order_id), [...(byOrder.get(String(r.values.order_id)) ?? []), r]);
      for (const [oid, rows] of byOrder) {
        const id = orderNumericId(oid);
        const v0 = rows[0]!.values;
        const items = rows.map((r) => {
          const v = r.values;
          const unit = v.unit_price ?? (v.total !== null ? v.total / v.quantity : 0);
          const listing = v.listing_id ?? (v.sku ? `SKU:${v.sku}` : `IMP:${normalize(v.title ?? "item").slice(0, 60)}`);
          return { listing, title: v.title ?? v.sku ?? listing, quantity: v.quantity, unit, fee: v.sale_fee !== null ? Math.abs(v.sale_fee) / v.quantity : null, sku: v.sku };
        });
        const total = items.reduce((s, i) => s + i.unit * i.quantity, 0);
        q.run(
          `INSERT INTO orders (id, account_id, status, payment_status, date_created, last_updated, total_amount, paid_amount, currency_id, channel, source, import_id, raw, synced_at)
           VALUES (?,?,?,?,?,?,?,?, 'BRL', ?, 'import', ?, ?, ?)`,
          [id, 0, statusOf(v0.status), statusOf(v0.status) === "paid" ? "approved" : "pending", v0.date.iso, v0.date.iso, total, statusOf(v0.status) === "paid" ? total : 0,
            channelOf(v0.channel), importId, JSON.stringify({ imported_order_id: oid }), new Date().toISOString()],
        );
        for (const it of items) {
          q.run(
            `INSERT INTO order_items (order_id, listing_id, variation_id, title, quantity, unit_price, sale_fee, seller_sku) VALUES (?,?,'',?,?,?,?,?)
             ON CONFLICT(order_id, listing_id, variation_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
            [id, it.listing, it.title, it.quantity, it.unit, it.fee, it.sku ?? null],
          );
          // vincula ao produto pelo SKU, quando existir
          if (it.sku) {
            const p = q.get<{ id: number }>("SELECT id FROM products WHERE sku=?", [it.sku]);
            if (p && !q.get("SELECT 1 FROM listings WHERE id=?", [it.listing]) && it.listing.startsWith("SKU:")) {
              q.run("INSERT INTO listings (id, account_id, product_id, title, price, status, sku, channel, source, import_id) VALUES (?,0,?,?,?,'active',?,?,'import',?)",
                [it.listing, p.id, it.title, it.unit, it.sku, channelOf(v0.channel), importId]);
            }
          }
        }
        imported += rows.length;
      }
    } else if (kind === "listings") {
      for (const r of ok) {
        const v = r.values;
        const prev = q.get<any>("SELECT id, visits_total, quality_score FROM listings WHERE id=?", [v.listing_id]);
        if (prev) {
          updates.push({ table: "listings", id: v.listing_id, prev: { visits_total: prev.visits_total, quality_score: prev.quality_score } });
          q.run("UPDATE listings SET visits_total=COALESCE(?, visits_total), quality_score=COALESCE(?, quality_score) WHERE id=?", [v.visits, v.quality, v.listing_id]);
        } else {
          let productId: number | null = null;
          if (v.sku) productId = q.get<{ id: number }>("SELECT id FROM products WHERE sku=?", [v.sku])?.id ?? null;
          q.run(
            `INSERT INTO listings (id, account_id, product_id, title, price, original_price, currency_id, available_quantity, sold_quantity, status, sku, quality_score, health, visits_total, channel, source, import_id, synced_at)
             VALUES (?,0,?,?,?,?,'BRL',?,?,?,?,?,?,?,?,'import',?,?)`,
            [v.listing_id, productId, v.title, v.price, v.original_price, v.stock, v.sold, normalize(v.status ?? "ativo").startsWith("paus") ? "paused" : normalize(v.status ?? "ativo").startsWith("inativ") || normalize(v.status ?? "").startsWith("finaliz") ? "closed" : "active",
              v.sku, v.quality, v.quality !== null ? v.quality / 100 : null, v.visits, channelOf(v.channel), importId, new Date().toISOString()],
          );
        }
        imported++;
      }
    } else if (kind === "period_report") {
      for (const r of ok) {
        const v = r.values;
        q.run(
          `INSERT INTO period_reports (channel, date_from, date_to, gross_sales, units, sales_count, visits, conversion_pct, avg_unit_price, source, import_id)
           VALUES (?,?,?,?,?,?,?,?,?, 'import', ?)`,
          [channelOf(v.channel), v.date_from.day, v.date_to.day, v.gross_sales, v.units, v.sales_count, v.visits, v.conversion_pct, v.avg_unit_price, importId],
        );
        imported++;
      }
    } else if (kind === "ads") {
      for (const r of ok) {
        const v = r.values;
        const cid = `IMP-${normalize(v.campaign).replace(/\s+/g, "-").slice(0, 60)}`;
        if (!q.get("SELECT 1 FROM ads_campaigns WHERE id=?", [cid])) q.run("INSERT INTO ads_campaigns (id, account_id, name, status, import_id) VALUES (?,0,?, 'imported', ?)", [cid, v.campaign, importId]);
        q.run(
          `INSERT INTO ads_campaign_daily (campaign_id, date, prints, clicks, cost, total_amount, units, import_id) VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(campaign_id, date) DO NOTHING`,
          [cid, v.date.day, v.prints, v.clicks, v.cost, v.revenue, v.units, importId],
        );
        imported++;
      }
    } else if (kind === "visits") {
      for (const r of ok) {
        const v = r.values;
        q.run("INSERT INTO visits_daily (scope, date, visits, import_id) VALUES (?,?,?,?) ON CONFLICT DO NOTHING", [v.listing_id ?? "store", v.date.day, v.visits, importId]);
        imported++;
      }
    } else if (kind === "products") {
      for (const r of ok) {
        const v = r.values;
        const prev = v.sku ? q.get<any>("SELECT * FROM products WHERE sku=?", [v.sku]) : q.get<any>("SELECT * FROM products WHERE name=?", [v.name]);
        if (prev) {
          updates.push({ table: "products", id: prev.id, prev: { weight_g: prev.weight_g, print_minutes: prev.print_minutes, material: prev.material, category: prev.category } });
          q.run("UPDATE products SET weight_g=COALESCE(?,weight_g), print_minutes=COALESCE(?,print_minutes), material=COALESCE(?,material), category=COALESCE(?,category), updated_at=? WHERE id=?",
            [v.weight_g, v.print_minutes, v.material?.toUpperCase(), v.category, new Date().toISOString(), prev.id]);
        } else {
          const res = q.run("INSERT INTO products (sku, name, category, weight_g, print_minutes, material, stock_qty) VALUES (?,?,?,?,?,?,0)",
            [v.sku, v.name, v.category, v.weight_g, v.print_minutes, v.material?.toUpperCase() ?? null]);
          updates.push({ table: "products", id: Number(res.lastInsertRowid), created: true });
        }
        imported++;
      }
    }
    q.run("UPDATE imports SET status='imported', rows_imported=?, rows_skipped=?, imported_at=?, summary=? WHERE id=?", [
      imported, parsed.length - ok.length, new Date().toISOString(), JSON.stringify({ updates }), importId,
    ]);
  });
  void userId;
  return { imported, skipped: parsed.length - ok.length };
}

export function undoImport(importId: number) {
  const imp = q.get<any>("SELECT * FROM imports WHERE id=?", [importId]);
  if (!imp) throw new HttpError(404, "Importação não encontrada");
  if (imp.status !== "imported") throw new HttpError(409, "Somente importações efetivadas podem ser desfeitas");
  const summary = json.parse<any>(imp.summary, {});
  const removed: Record<string, number> = {};
  q.tx(() => {
    const del = (table: string, sql: string) => { removed[table] = Number(q.run(sql, [importId]).changes); };
    del("order_items", "DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE import_id=?)");
    del("orders", "DELETE FROM orders WHERE import_id=?");
    del("listings", "DELETE FROM listings WHERE import_id=?");
    del("period_reports", "DELETE FROM period_reports WHERE import_id=?");
    del("ads_campaign_daily", "DELETE FROM ads_campaign_daily WHERE import_id=?");
    del("ads_campaigns", "DELETE FROM ads_campaigns WHERE import_id=? AND id NOT IN (SELECT campaign_id FROM ads_campaign_daily)");
    del("visits_daily", "DELETE FROM visits_daily WHERE import_id=?");
    for (const u of summary.updates ?? []) {
      if (u.table === "listings") q.run("UPDATE listings SET visits_total=?, quality_score=? WHERE id=?", [u.prev.visits_total, u.prev.quality_score, u.id]);
      if (u.table === "products" && u.created) q.run("DELETE FROM products WHERE id=? AND NOT EXISTS (SELECT 1 FROM listings WHERE product_id=?)", [u.id, u.id]);
      else if (u.table === "products") q.run("UPDATE products SET weight_g=?, print_minutes=?, material=?, category=? WHERE id=?", [u.prev.weight_g, u.prev.print_minutes, u.prev.material, u.prev.category, u.id]);
    }
    q.run("UPDATE imports SET status='undone', undone_at=? WHERE id=?", [new Date().toISOString(), importId]);
  });
  return { removed, restored: (summary.updates ?? []).length };
}

export const dayToUtc = localDayStartUtc;
