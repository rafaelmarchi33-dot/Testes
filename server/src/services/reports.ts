import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { q, json } from "../db/index.ts";
import { resolvePeriod, localDate, type Range } from "../lib/dates.ts";
import { profitByListing } from "./finance.ts";
import { stockTurnover, productionPlan } from "./inventory.ts";
import { adsOverview } from "../ml/ads.ts";
import { dashboard } from "./metrics.ts";

type Fmt = "money" | "int" | "pct" | "text" | "date" | "num";
interface Column { key: string; header: string; fmt?: Fmt; width?: number }
export interface Report { title: string; subtitle: string; columns: Column[]; rows: Record<string, unknown>[]; summary: [string, string][] }

const brl = (n: unknown) => (typeof n === "number" ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");
const pct = (n: unknown) => (typeof n === "number" ? `${n.toFixed(1)}%` : "—");

export const REPORTS = {
  sales: "Relatório de vendas",
  products: "Relatório de produtos",
  financial: "Relatório financeiro",
  profitability: "Relatório de lucratividade",
  stock: "Relatório de estoque",
  ads: "Relatório de publicidade",
  monthly: "Desempenho mensal",
  opportunities: "Oportunidades comerciais",
} as const;
export type ReportKey = keyof typeof REPORTS;

export function buildReport(key: ReportKey, range: Range): Report {
  const subtitle = `Período: ${range.from.split("-").reverse().join("/")} a ${range.to.split("-").reverse().join("/")} · Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
  switch (key) {
    case "sales": {
      const rows = q.all<any>(
        `SELECT o.id, o.date_created, o.status, o.payment_status, o.total_amount,
           (SELECT GROUP_CONCAT(oi.quantity || 'x ' || oi.title, ' | ') FROM order_items oi WHERE oi.order_id=o.id) items,
           s.status ship_status, s.tracking_number
         FROM orders o LEFT JOIN shipments s ON s.id=o.shipping_id
         WHERE o.date_created >= ? AND o.date_created < ? ORDER BY o.date_created DESC`,
        [range.fromUtc, range.toUtc],
      ).map((r) => ({ ...r, date_created: localDate(r.date_created) }));
      const paid = rows.filter((r) => r.status === "paid");
      return {
        title: REPORTS.sales, subtitle,
        columns: [
          { key: "id", header: "Pedido", fmt: "text", width: 18 }, { key: "date_created", header: "Data", fmt: "date", width: 12 },
          { key: "items", header: "Itens", fmt: "text", width: 50 }, { key: "total_amount", header: "Valor", fmt: "money", width: 14 },
          { key: "status", header: "Status", fmt: "text", width: 12 }, { key: "payment_status", header: "Pagamento", fmt: "text", width: 12 },
          { key: "ship_status", header: "Envio", fmt: "text", width: 14 }, { key: "tracking_number", header: "Rastreio", fmt: "text", width: 18 },
        ],
        rows,
        summary: [["Pedidos pagos", String(paid.length)], ["Faturamento", brl(paid.reduce((s, r) => s + r.total_amount, 0))], ["Cancelados", String(rows.filter((r) => r.status === "cancelled").length)]],
      };
    }
    case "products": {
      const rows = q.all<any>(
        `SELECT l.id, l.title, l.status, l.price, l.available_quantity, l.sold_quantity, l.listing_type_id, l.sku,
           COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.listing_id=l.id AND o.status='paid' AND o.date_created >= ? AND o.date_created < ?),0) units_period
         FROM listings l ORDER BY units_period DESC, l.sold_quantity DESC`,
        [range.fromUtc, range.toUtc],
      );
      return {
        title: REPORTS.products, subtitle,
        columns: [
          { key: "id", header: "Anúncio", width: 16 }, { key: "title", header: "Título", width: 50 }, { key: "sku", header: "SKU", width: 14 },
          { key: "status", header: "Status", width: 10 }, { key: "price", header: "Preço", fmt: "money", width: 12 },
          { key: "available_quantity", header: "Disponível", fmt: "int", width: 10 }, { key: "units_period", header: "Vendidos (período)", fmt: "int", width: 12 },
          { key: "sold_quantity", header: "Vendidos (total ML)", fmt: "int", width: 12 },
        ],
        rows, summary: [["Anúncios", String(rows.length)], ["Ativos", String(rows.filter((r) => r.status === "active").length)]],
      };
    }
    case "financial":
    case "profitability": {
      const rows = profitByListing(range);
      const tot = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + ((r[k] as number) ?? 0), 0);
      const known = rows.filter((r) => r.cost_known);
      const profit = known.reduce((s, r) => s + (r.profit ?? 0), 0);
      return {
        title: key === "financial" ? REPORTS.financial : REPORTS.profitability, subtitle,
        columns: [
          { key: "title", header: "Produto", width: 44 }, { key: "units", header: "Un.", fmt: "int", width: 7 }, { key: "revenue", header: "Receita", fmt: "money", width: 13 },
          { key: "sale_fees", header: "Tarifas ML", fmt: "money", width: 12 }, { key: "shipping", header: "Frete", fmt: "money", width: 11 },
          { key: "production_cost", header: "Custo prod.", fmt: "money", width: 12 }, { key: "taxes", header: "Impostos", fmt: "money", width: 11 },
          { key: "ads", header: "Publicidade", fmt: "money", width: 11 }, { key: "profit", header: "Lucro", fmt: "money", width: 12 }, { key: "margin_pct", header: "Margem", fmt: "pct", width: 9 },
        ],
        rows: rows as unknown as Record<string, unknown>[],
        summary: [
          ["Receita bruta", brl(tot("revenue"))], ["Tarifas do Mercado Livre", brl(tot("sale_fees"))], ["Frete pago pelo vendedor", brl(tot("shipping"))],
          ["Lucro líquido estimado (itens com custo)", brl(profit)],
          ["Cobertura de custos", `${known.length} de ${rows.length} produtos com ficha de custos`],
        ],
      };
    }
    case "stock": {
      const plan = new Map(productionPlan().map((p) => [p.product_id, p]));
      const rows = stockTurnover(30).map((r: any) => ({ ...r, ...{ priority: plan.get(r.id)?.priority, suggested: plan.get(r.id)?.suggested_production, cover: plan.get(r.id)?.days_of_cover } }));
      return {
        title: REPORTS.stock, subtitle: subtitle + " · Giro: últimos 30 dias",
        columns: [
          { key: "name", header: "Produto", width: 44 }, { key: "sku", header: "SKU", width: 14 }, { key: "stock_qty", header: "Estoque", fmt: "int", width: 9 },
          { key: "units", header: "Vendas 30d", fmt: "int", width: 10 }, { key: "turnover", header: "Giro", fmt: "num", width: 8 }, { key: "cover", header: "Cobertura (dias)", fmt: "num", width: 12 },
          { key: "days_without_sale", header: "Dias sem venda", fmt: "int", width: 12 }, { key: "priority", header: "Prioridade", width: 11 }, { key: "suggested", header: "Produzir", fmt: "int", width: 9 },
        ],
        rows, summary: [["Produtos", String(rows.length)], ["Sem estoque", String(rows.filter((r: any) => r.stock_qty <= 0).length)]],
      };
    }
    case "ads": {
      const o = adsOverview();
      return {
        title: REPORTS.ads, subtitle: "Métricas dos últimos 30 dias sincronizados do Mercado Ads",
        columns: [
          { key: "name", header: "Campanha", width: 36 }, { key: "status", header: "Status", width: 10 }, { key: "cost", header: "Investimento", fmt: "money", width: 13 },
          { key: "prints", header: "Impressões", fmt: "int", width: 12 }, { key: "clicks", header: "Cliques", fmt: "int", width: 9 }, { key: "ctr", header: "CTR", fmt: "pct", width: 8 },
          { key: "cpc", header: "CPC", fmt: "money", width: 9 }, { key: "total_amount", header: "Vendas atrib.", fmt: "money", width: 13 },
          { key: "acos", header: "ACOS", fmt: "pct", width: 8 }, { key: "roas", header: "ROAS", fmt: "num", width: 8 },
        ],
        rows: o.campaigns.map((c) => ({ ...c, ctr: c.ctr === null ? null : c.ctr * 100, acos: c.acos === null ? null : c.acos * 100 })),
        summary: o.available ? [["Investimento", brl(o.totals.cost)], ["Vendas atribuídas", brl(o.totals.total_amount)], ["ROAS", o.totals.roas?.toFixed(2) ?? "—"]] : [["Status", o.sync?.message ?? "Dados de publicidade indisponíveis"]],
      };
    }
    case "monthly": {
      const d = dashboard("custom", range.from, range.to);
      return {
        title: REPORTS.monthly, subtitle,
        columns: [{ key: "month", header: "Mês", width: 12 }, { key: "revenue", header: "Faturamento", fmt: "money", width: 16 }, { key: "orders", header: "Pedidos", fmt: "int", width: 10 }],
        rows: d.charts.monthly,
        summary: [
          ["Faturamento no período", brl(d.kpis.revenue)], ["Pedidos", String(d.kpis.orders)], ["Ticket médio", brl(d.kpis.avg_ticket)],
          ["Lucro estimado", brl(d.kpis.gross_profit)], ["Margem", pct(d.kpis.margin_pct)], ["Variação vs. período anterior", pct(d.changes.revenue)],
        ],
      };
    }
    case "opportunities": {
      const rows = q.all<any>("SELECT * FROM opportunities ORDER BY created_at DESC").map((r) => ({ ...r, evidence: undefined }));
      return {
        title: REPORTS.opportunities, subtitle: "Estimativas baseadas em dados públicos do Mercado Livre; não representam demanda completa.",
        columns: [
          { key: "name", header: "Oportunidade", width: 36 }, { key: "category_name", header: "Categoria", width: 20 }, { key: "price_median", header: "Preço mediano", fmt: "money", width: 13 },
          { key: "competitors", header: "Vendedores", fmt: "int", width: 10 }, { key: "est_cost", header: "Custo est.", fmt: "money", width: 11 }, { key: "margin_pct", header: "Margem est.", fmt: "pct", width: 10 },
          { key: "difficulty", header: "Dificuldade", width: 10 }, { key: "potential", header: "Potencial", width: 9 },
        ],
        rows, summary: [["Oportunidades", String(rows.length)]],
      };
    }
  }
}

export async function toExcel(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mercado Livre Intelligence";
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([r.subtitle]).font = { italic: true, color: { argb: "FF666666" } };
  for (const [k, v] of r.summary) ws.addRow([k, v]);
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2D3277" } }));
  for (const row of r.rows) ws.addRow(r.columns.map((c) => (row[c.key] ?? null) as ExcelJS.CellValue));
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? 14;
    if (c.fmt === "money") col.numFmt = '"R$" #,##0.00';
    if (c.fmt === "pct") col.numFmt = '0.0"%"';
    if (c.fmt === "num") col.numFmt = "0.00";
  });
  ws.views = [{ state: "frozen", ySplit: header.number }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(r: Report): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: r.columns.length > 6 ? "landscape" : "portrait", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const W = doc.page.width - 72;
    doc.fillColor("#2D3277").fontSize(16).font("Helvetica-Bold").text("MERCADO LIVRE INTELLIGENCE");
    doc.fillColor("#111").fontSize(13).text(r.title);
    doc.fillColor("#666").fontSize(8).font("Helvetica").text(r.subtitle).moveDown(0.6);
    for (const [k, v] of r.summary) doc.fillColor("#111").fontSize(9).font("Helvetica-Bold").text(`${k}: `, { continued: true }).font("Helvetica").text(v);
    doc.moveDown(0.6);
    const totalW = r.columns.reduce((s, c) => s + (c.width ?? 14), 0);
    const widths = r.columns.map((c) => ((c.width ?? 14) / totalW) * W);
    const fmt = (v: unknown, f?: Fmt) => (v === null || v === undefined ? "—" : f === "money" ? brl(v) : f === "pct" ? pct(v) : f === "num" && typeof v === "number" ? v.toFixed(2) : String(v));
    const drawRow = (cells: string[], bold: boolean, fill?: string) => {
      const y = doc.y;
      const h = Math.max(...cells.map((c, i) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).heightOfString(c, { width: widths[i]! - 4 }))) + 4;
      if (y + h > doc.page.height - 40) doc.addPage();
      const yy = doc.y;
      if (fill) doc.rect(36, yy, W, h).fill(fill);
      let x = 36;
      cells.forEach((c, i) => {
        doc.fillColor(bold ? "#fff" : "#111").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).text(c, x + 2, yy + 2, { width: widths[i]! - 4 });
        x += widths[i]!;
      });
      doc.x = 36;
      doc.y = yy + h;
    };
    drawRow(r.columns.map((c) => c.header), true, "#2D3277");
    r.rows.slice(0, 2000).forEach((row, idx) => drawRow(r.columns.map((c) => fmt(row[c.key], c.fmt)), false, idx % 2 ? "#F3F4F8" : undefined));
    if (!r.rows.length) doc.moveDown().fillColor("#666").fontSize(9).text("Sem dados para o período selecionado.");
    doc.end();
  });
}

