import { useState } from "react";
import { Link } from "react-router";
import { DollarSign, ShoppingBag, PackageOpen, Receipt, TrendingUp, Percent, Megaphone, MousePointerClick, Tag, PackageX, Truck, MessageCircleQuestion, PlugZap } from "lucide-react";
import { useApi } from "../lib/api.ts";
import { Card, Stat, PageHeader, PeriodFilter, periodQuery, Spinner, ErrorBox, Empty, Badge, Notice, type PeriodValue, Button } from "../components/ui.tsx";
import { RevenueTrend, MonthlyBars, HBars } from "../components/charts.tsx";
import { brl, brlShort, int, pct, relative, ratioPct } from "../lib/format.ts";

export default function Dashboard() {
  const [period, setPeriod] = useState<PeriodValue>({ period: "30d" });
  const { data: d, error, loading, reload } = useApi<any>(`/dashboard?${periodQuery(period)}`);

  return (
    <>
      <PageHeader
        title="Dashboard executivo"
        subtitle={d ? <>Dados reais sincronizados do Mercado Livre · última sincronização {relative(d.last_sync)}</> : "Visão consolidada da loja"}
        actions={<PeriodFilter value={period} onChange={setPeriod} />}
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !d && <Spinner />}
      {d && !d.connected && (
        <Card className="mb-6">
          <Empty icon={<PlugZap className="size-5" />} title="Conecte sua conta do Mercado Livre">
            O dashboard mostra apenas dados reais. Conecte a loja para importar anúncios, pedidos, vendas e indicadores.
            <div className="mt-3"><Link to="/integracoes"><Button variant="primary" size="sm">Conectar agora</Button></Link></div>
          </Empty>
        </Card>
      )}
      {d && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Stat label="Faturamento no período" value={brlShort(d.kpis.revenue)} delta={d.changes.revenue} icon={<DollarSign className="size-4" />} />
            <Stat label="Pedidos" value={int(d.kpis.orders)} delta={d.changes.orders} icon={<ShoppingBag className="size-4" />} />
            <Stat label="Produtos vendidos" value={int(d.kpis.units)} delta={d.changes.units} icon={<PackageOpen className="size-4" />} />
            <Stat label="Ticket médio" value={brl(d.kpis.avg_ticket)} delta={d.changes.avg_ticket} icon={<Receipt className="size-4" />} />
            <Stat label="Lucro estimado" value={brlShort(d.kpis.gross_profit)} delta={d.changes.gross_profit} icon={<TrendingUp className="size-4" />}
              hint={d.kpis.profit_coverage_pct !== null && d.kpis.profit_coverage_pct < 99.5 ? `custos de ${pct(d.kpis.profit_coverage_pct, 0)} da receita` : undefined} />
            <Stat label="Margem de lucro" value={pct(d.kpis.margin_pct)} icon={<Percent className="size-4" />} hint={d.kpis.margin_pct === null ? "cadastre custos" : undefined} />
            <Stat label="Conversão" value={pct(d.kpis.conversion_pct, 2)} delta={d.changes.conversion_pct} icon={<MousePointerClick className="size-4" />}
              hint={d.kpis.visits !== null ? `${int(d.kpis.visits)} visitas` : "sem dados de visitas"} />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Stat label="Faturamento total" value={brlShort(d.kpis.revenue_total)} hint="todo o histórico importado" />
            <Stat label="Hoje" value={brlShort(d.kpis.revenue_today)} />
            <Stat label="Últimos 7 dias" value={brlShort(d.kpis.revenue_7d)} />
            <Stat label="Últimos 30 dias" value={brlShort(d.kpis.revenue_30d)} />
            <Stat label="Investimento em ads" value={d.kpis.ad_spend === null ? "—" : brlShort(d.kpis.ad_spend)} delta={d.kpis.ad_spend === null ? undefined : d.changes.ad_spend} invert icon={<Megaphone className="size-4" />} hint={d.kpis.ad_spend === null ? "sem dados de Product Ads" : undefined} />
            <Stat label="Anúncios ativos" value={int(d.kpis.active_listings)} icon={<Tag className="size-4" />} hint={`${int(d.kpis.paused_listings)} pausados`} />
            <Stat label="Sem estoque" value={int(d.kpis.out_of_stock_listings)} icon={<PackageX className="size-4" />} tone={d.kpis.out_of_stock_listings ? "bad" : undefined} hint="anúncios com 0 disponível" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Link to="/pedidos?shipping=ready_to_ship" className="rounded-xl border border-line bg-surface p-4 hover:border-brand/40 transition flex items-center gap-3">
              <Truck className="size-5 text-warn" /><div><div className="text-lg font-semibold num">{int(d.kpis.awaiting_shipment)}</div><div className="text-xs text-ink-3">pedidos aguardando envio</div></div>
            </Link>
            <Link to="/perguntas" className="rounded-xl border border-line bg-surface p-4 hover:border-brand/40 transition flex items-center gap-3">
              <MessageCircleQuestion className="size-5 text-info" /><div><div className="text-lg font-semibold num">{int(d.kpis.unanswered_questions)}</div><div className="text-xs text-ink-3">perguntas sem resposta</div></div>
            </Link>
            <Link to="/estoque" className="rounded-xl border border-line bg-surface p-4 hover:border-brand/40 transition flex items-center gap-3">
              <PackageX className="size-5 text-bad" /><div><div className="text-lg font-semibold num">{int(d.kpis.out_of_stock_products)}</div><div className="text-xs text-ink-3">produtos sem estoque interno</div></div>
            </Link>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card title="Evolução diária das vendas" subtitle="Faturamento de pedidos pagos, comparado ao período anterior de mesma duração" className="xl:col-span-2">
              {d.charts.series.some((s: any) => s.revenue || s.prev_revenue) ? <RevenueTrend data={d.charts.series} /> : <Empty title="Sem vendas no período" />}
            </Card>
            <Card title="Comparativo entre períodos" subtitle={`${d.range.from.split("-").reverse().join("/")} – ${d.range.to.split("-").reverse().join("/")} vs. ${d.previous.from.split("-").reverse().join("/")} – ${d.previous.to.split("-").reverse().join("/")}`}>
              <dl className="space-y-3 text-sm">
                {[
                  ["Faturamento", brl(d.kpis.revenue), brl(d.previous_kpis.revenue)],
                  ["Pedidos", int(d.kpis.orders), int(d.previous_kpis.orders)],
                  ["Unidades", int(d.kpis.units), int(d.previous_kpis.units)],
                  ["Ticket médio", brl(d.kpis.avg_ticket), brl(d.previous_kpis.avg_ticket)],
                  ["Lucro estimado", brl(d.kpis.gross_profit), brl(d.previous_kpis.gross_profit)],
                  ["Cancelamentos", int(d.kpis.cancelled), int(d.previous_kpis.cancelled)],
                  ["Tarifas ML", brl(d.kpis.sale_fees), brl(d.previous_kpis.sale_fees)],
                ].map(([k, a, b]) => (
                  <div key={k} className="grid grid-cols-3 gap-2 border-b border-line/60 pb-2 last:border-0">
                    <dt className="text-ink-3 text-xs">{k}</dt><dd className="text-right font-medium num">{a}</dd><dd className="text-right text-ink-3 num">{b}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            <Card title="Comparativo mensal" subtitle="Últimos 12 meses">
              {d.charts.monthly.length ? <MonthlyBars data={d.charts.monthly} /> : <Empty title="Sem histórico mensal" />}
            </Card>
            <Card title="Faturamento por produto" subtitle="Top 10 no período">
              {d.charts.byProduct.length ? <HBars data={d.charts.byProduct} labelKey="title" valueKey="revenue" /> : <Empty title="Sem vendas" />}
            </Card>
            <Card title="Vendas por categoria" subtitle="Unidades no período">
              {d.charts.byCategory.length ? <HBars data={d.charts.byCategory.map((c: any) => ({ ...c, label: c.name ?? c.category_id }))} labelKey="label" valueKey="units" money={false} color="var(--color-info)" /> : <Empty title="Sem vendas" />}
            </Card>
            <Card title="Lucro por produto" subtitle="Somente produtos com ficha de custos" action={<Link to="/financeiro" className="text-xs text-brand hover:underline">Custos →</Link>}>
              {d.charts.profitTop.length ? <HBars data={d.charts.profitTop} labelKey="title" valueKey="profit" color="var(--color-good)" /> : <Empty title="Sem lucro calculável">Cadastre a ficha de custos dos produtos no módulo Financeiro.</Empty>}
            </Card>
            <Card title="Produtos com maior crescimento" subtitle="Unidades vs. período anterior">
              {d.charts.growth.filter((g: any) => g.delta > 0).length ? (
                <ul className="space-y-2 text-xs">
                  {d.charts.growth.filter((g: any) => g.delta > 0).map((g: any) => (
                    <li key={g.listing_id} className="flex items-center justify-between gap-3">
                      <span className="truncate text-ink-2">{g.title}</span>
                      <span className="shrink-0 num"><span className="text-ink-3">{g.prev_units} → </span><b>{g.units}</b> <Badge tone="good">+{g.delta}</Badge></span>
                    </li>
                  ))}
                </ul>
              ) : <Empty title="Nenhum produto em crescimento no período" />}
            </Card>
            <Card title="Desempenho das campanhas" subtitle="Mercado Ads no período" action={<Link to="/publicidade" className="text-xs text-brand hover:underline">Detalhes →</Link>}>
              {d.charts.campaigns.length ? (
                <ul className="space-y-2.5 text-xs">
                  {d.charts.campaigns.map((c: any) => (
                    <li key={c.id} className="flex items-center justify-between gap-3">
                      <span className="truncate text-ink-2">{c.name}</span>
                      <span className="shrink-0 text-right num">{brl(c.cost)} · ACOS {ratioPct(c.acos)} · ROAS {c.roas?.toFixed(1) ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty title="Sem dados de publicidade">Disponível quando a conta tem Product Ads ativo e o app tem permissão de leitura.</Empty>}
            </Card>
          </div>
          <Notice>Lucro e margem consideram tarifas reais do Mercado Livre, frete pago pelo vendedor e as fichas de custos cadastradas. Produtos sem ficha de custos ficam fora do cálculo de lucro, nunca estimados.</Notice>
        </div>
      )}
    </>
  );
}
