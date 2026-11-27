import { q } from "../db/index.ts";
import { resolvePeriod } from "../lib/dates.ts";
import { profitByListing } from "./finance.ts";
import { revenueWithReports } from "./company.ts";

/**
 * DRE gerencial do mês (AAAA-MM). Cada linha indica a fonte; itens sem dados ficam como null (pendentes), nunca zero inventado.
 */
export function dre(month: string) {
  const from = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const range = resolvePeriod("custom", from, last);
  const rev = revenueWithReports(from, last);
  const rows = profitByListing(range);
  const known = rows.filter((r) => r.cost_known);
  const sum = (arr: typeof rows, k: "sale_fees" | "shipping" | "taxes" | "ads" | "production_cost") => arr.reduce((s, r) => s + (r[k] ?? 0), 0);
  const hasOrders = rev.from_orders > 0;
  const adsCost = q.get<{ c: number | null; n: number }>("SELECT SUM(cost) c, COUNT(*) n FROM ads_campaign_daily WHERE date BETWEEN ? AND ?", [from, last])!;
  const expenses = q.all<{ category: string; total: number }>("SELECT category, SUM(amount) total FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC", [from, last]);
  const expTotal = expenses.reduce((s, e) => s + e.total, 0);
  const fees = hasOrders ? sum(rows, "sale_fees") : null;
  const shipping = hasOrders ? sum(rows, "shipping") : null;
  const taxes = known.length ? sum(known, "taxes") : null;
  const cogs = known.length ? sum(known, "production_cost") : null;
  const ads = adsCost.n ? adsCost.c ?? 0 : null;
  const net = fees !== null ? rev.total - fees - (shipping ?? 0) - (taxes ?? 0) : null;
  const contribution = net !== null && cogs !== null ? net - cogs : null;
  const result = contribution !== null ? contribution - (ads ?? 0) - expTotal : null;
  const coverage = rev.from_orders > 0 ? (known.reduce((s, r) => s + r.revenue, 0) / rev.from_orders) * 100 : null;
  return {
    month, from, to: last,
    lines: [
      { key: "gross", label: "Receita bruta", value: rev.total, source: rev.from_reports ? `pedidos ${rev.from_orders.toFixed(2)} + relatórios ${rev.from_reports.toFixed(2)}` : "pedidos" },
      { key: "fees", label: "(−) Tarifas de marketplace", value: fees === null ? null : -fees, source: fees === null ? "pendente: sem pedidos individuais" : "tarifas informadas nos pedidos" },
      { key: "shipping", label: "(−) Fretes pagos pelo vendedor", value: shipping === null ? null : -shipping, source: "custo dos envios" },
      { key: "taxes", label: "(−) Impostos", value: taxes === null ? null : -taxes, source: taxes === null ? "pendente: fichas de custo" : "alíquota das fichas de custo" },
      { key: "net", label: "(=) Receita líquida", value: net, source: "" },
      { key: "cogs", label: "(−) Custo de produção", value: cogs === null ? null : -cogs, source: cogs === null ? "pendente: fichas de custo" : `cobre ${coverage?.toFixed(0) ?? "—"}% da receita` },
      { key: "contribution", label: "(=) Margem de contribuição", value: contribution, source: "" },
      { key: "ads", label: "(−) Publicidade", value: ads === null ? null : -ads, source: ads === null ? "pendente: sem dados de campanhas" : "campanhas" },
      { key: "expenses", label: "(−) Despesas operacionais", value: -expTotal, source: expenses.length ? `${expenses.length} categoria(s) lançadas` : "nenhuma despesa lançada" },
      { key: "result", label: "(=) Resultado operacional", value: result, source: result === null ? "pendente" : "" },
    ],
    expenses, cost_coverage_pct: coverage,
    margin_pct: result !== null && rev.total > 0 ? (result / rev.total) * 100 : null,
  };
}
