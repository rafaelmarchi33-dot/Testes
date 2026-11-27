import { Link } from "react-router";
import {
  DollarSign, TrendingUp, Percent, ShoppingBag, PackageOpen, Receipt, Eye, MousePointerClick, Megaphone, Repeat, Gauge, Tag, Trophy, Boxes, Timer, Cpu, FileText, AlertTriangle,
} from "lucide-react";
import { useApi } from "../lib/api.ts";
import { useGlobal, PERIODS } from "../lib/global.tsx";
import { Card, PageHeader, Spinner, ErrorBox, Kpi, Pending, SourceTag, Badge, Button, Notice } from "../components/ui.tsx";
import { RevenueTrend, Bars, HBars, GoalChart, AdsReturn, Ring, SmallLine } from "../components/charts.tsx";
import { brl, brlShort, int, pct, relative, date } from "../lib/format.ts";

const monthLabel = (m: string) => new Date(m + "-15").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });

export default function Overview() {
  const g = useGlobal();
  const { data: d, error, loading, reload } = useApi<any>(`/overview?${g.query}`);
  const compare = PERIODS.find((p) => p.value === g.period.period)?.compare ?? "";
  const k = d?.kpis, c = d?.changes, op = d?.operational, goal = d?.goal;
  const src = d?.data_source === "report" ? "report" : d?.data_source === "orders" ? "orders" : d?.data_source === "daily_metrics" ? "daily_metrics" : undefined;
  const pendingKpi = (v: unknown, txt: string) => (v === null || v === undefined ? { value: "—", hint: txt } : null);

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle={d ? <>Central de comando da Mind2Matter · {date(d.range.from)} a {date(d.range.to)} · comparação {compare}{d.connected ? ` · sincronizado ${relative(d.last_sync)}` : ""}</> : "Central de comando da Mind2Matter"}
        actions={<Link to="/mind"><Button variant="primary" size="sm">Pedir diagnóstico ao CEO Mind2Matter</Button></Link>}
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !d && <Spinner />}
      {d && (
        <div className="space-y-6">
          {d.data_source === "report" && (
            <Notice title="Dados de relatório importado.">
              Não há pedidos individuais neste período; os indicadores vêm do relatório agregado do Mercado Livre de {date(d.report_used.date_from)} a {date(d.report_used.date_to)}
              {d.report_used.source === "initial_import" ? " (dados iniciais informados na implantação)" : ""}. As variações são as informadas no relatório. Não são métricas em tempo real.
            </Notice>
          )}
          {d.data_source === "daily_metrics" && (
            <Notice title="Métricas diárias importadas.">
              Sem pedidos individuais neste período: os indicadores vêm do relatório “Métricas do desempenho dos seus produtos” do Mercado Livre ({d.metrics_days} dia(s) com dados).
              Conversão = vendas ÷ visitas únicas (definição do ML). {d.previous_kpis.source === "report_derived" ? "O período anterior é derivado das variações do relatório agregado." : ""}
            </Notice>
          )}
          {d.data_source === "none" && (
            <Notice tone="warn" title="Sem vendas registradas no período.">
              Conecte o Mercado Livre ou importe relatórios de vendas. Escolha "Personalizado" de 19/11/2026 a 26/11/2026 para ver o relatório inicial importado.
            </Notice>
          )}

          {/* Meta mensal */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
            <Card className="glow-card" title="Meta mensal de faturamento bruto" subtitle={`${goal.month} · meta ${brl(goal.goal)}`}>
              <div className="flex items-center gap-5">
                <Ring pct={goal.progress_pct} />
                <div className="space-y-1.5 text-xs">
                  <div><span className="text-ink-3">Faturado no mês</span><div className="text-lg font-semibold num">{brl(goal.revenue)}</div></div>
                  <div className="text-ink-3">Esperado até hoje: <span className="text-ink num">{brl(goal.expected_to_date)}</span></div>
                  <div className="text-ink-3">Falta: <span className="text-ink num">{brl(goal.remaining)}</span> em {goal.remaining_days} dias</div>
                  <div className="text-ink-3">Necessário/dia: <span className="font-semibold text-ink num">{brl(goal.needed_per_day)}</span></div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {goal.trajectory_pct !== null && <Badge tone={goal.trajectory_pct >= 100 ? "good" : goal.trajectory_pct >= 80 ? "warn" : "bad"}>{pct(goal.trajectory_pct, 0)} da trajetória</Badge>}
                {goal.from_reports > 0 && <Badge tone="info">inclui relatório importado</Badge>}
                {goal.projection !== null && <Badge tone="warn">projeção {brlShort(goal.projection)} (estimativa)</Badge>}
              </div>
            </Card>
            <Card title="Evolução da meta de R$ 20 mil" subtitle={goal.projection_note}>
              <GoalChart data={d.charts.goal_series} goal={goal.goal} />
            </Card>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Kpi label="Faturamento bruto" value={brlShort(k.revenue)} delta={c.revenue} icon={<DollarSign />} source={src} />
            <Kpi label="Lucro estimado" {...(pendingKpi(k.estimated_profit, "cadastre custos") ?? { value: brlShort(k.estimated_profit), hint: k.profit_coverage_pct < 99.5 ? `custos de ${pct(k.profit_coverage_pct, 0)} da receita` : undefined })} delta={c.estimated_profit} icon={<TrendingUp />} />
            <Kpi label="Margem de contribuição" {...(pendingKpi(k.contribution_margin_pct, "pendente: custos") ?? { value: pct(k.contribution_margin_pct) })} icon={<Percent />} />
            <Kpi label="Pedidos" value={int(k.orders)} delta={c.orders} icon={<ShoppingBag />} source={src} />
            <Kpi label="Unidades vendidas" value={int(k.units)} delta={c.units} icon={<PackageOpen />} source={src} />
            <Kpi label="Ticket médio" {...(pendingKpi(k.avg_ticket, "sem pedidos") ?? { value: brl(k.avg_ticket) })} delta={c.avg_ticket} icon={<Receipt />} hint={k.avg_unit_price ? `${brl(k.avg_unit_price)}/unidade` : undefined} />
            <Kpi label="Visitas" {...(pendingKpi(k.visits, "sem dados de visitas") ?? { value: int(k.visits) })} delta={c.visits} icon={<Eye />} source={k.visits !== null ? src : undefined} />
            <Kpi label="Conversão" {...(pendingKpi(k.conversion_pct, "sem dados de visitas") ?? { value: pct(k.conversion_pct, 1) })} icon={<MousePointerClick />}
              hint={c.conversion_pp !== null ? <span className={c.conversion_pp < 0 ? "text-bad" : "text-good"}>{c.conversion_pp > 0 ? "+" : ""}{c.conversion_pp.toFixed(1)} p.p.</span> : undefined} />
            <Kpi label="Investimento em ads" {...(pendingKpi(k.ad_spend, "sem dados de publicidade") ?? { value: brlShort(k.ad_spend) })} delta={c.ad_spend} invert icon={<Megaphone />} />
            <Kpi label="ROAS" {...(pendingKpi(k.roas, "pendente") ?? { value: `${k.roas.toFixed(2)}x` })} icon={<Repeat />} />
            <Kpi label="ACOS" {...(pendingKpi(k.acos_pct, "pendente") ?? { value: pct(k.acos_pct) })} icon={<Gauge />} />
            <Kpi label="Produtos ativos" value={int(op.active_listings)} icon={<Tag />} hint={op.listings_identified ? `${op.listings_identified} anúncios identificados (informado)` : undefined} />
            <Kpi label="Produtos campeões" value={int(op.champions)} icon={<Trophy />} hint={op.critical ? <span className="text-bad">{op.critical} crítico(s)</span> : "classificação da central"} />
            <Kpi label="Estoque disponível" value={`${int(op.stock_units)} un.`} icon={<Boxes />} hint={op.ml_displayed_stock !== null ? `${int(op.ml_displayed_stock)} exibidas no ML` : "estoque físico interno"} />
            <Kpi label="Horas de impressão" {...(pendingKpi(op.print_hours, "sem OPs concluídas") ?? { value: `${op.print_hours.toFixed(1)} h` })} icon={<Timer />} />
            <Kpi label="Ocupação das máquinas" {...(pendingKpi(op.occupancy_pct, "sem OPs concluídas") ?? { value: pct(op.occupancy_pct, 0) })} icon={<Cpu />} hint={op.capacity_hours ? `capacidade ${int(op.capacity_hours)} h` : undefined} />
          </div>

          {d.funnel && <Funnel f={d.funnel} />}
          {d.charts.daily_conversion && (
            <Card title="Conversão diária" subtitle="Vendas ÷ visitas únicas e intenção de compra ÷ visitas únicas, por dia">
              <SmallLine data={d.charts.daily_conversion} keys={[{ key: "conversion", name: "Conversão em vendas (%)", color: "var(--color-brand)" }, { key: "intent", name: "Intenção de compra (%)", color: "var(--color-warn)" }]} />
            </Card>
          )}

          {/* Relatório inicial importado */}
          <ImportedReports />

          {/* Gráficos */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Faturamento diário" subtitle={`Período atual x ${compare.replace("vs. ", "")}`}>
              {d.charts.daily ? <RevenueTrend data={d.charts.daily} /> : <Pending>Sem pedidos diários registrados. Conecte o Mercado Livre ou importe o relatório de vendas (Vendas › Exportar).</Pending>}
            </Card>
            <Card title="Comparativo de faturamento" subtitle={compare}>
              <div className="space-y-3 text-sm">
                {[["Faturamento", brl(k.revenue), brl(d.previous_kpis.revenue), c.revenue], ["Pedidos", int(k.orders), int(d.previous_kpis.orders), c.orders], ["Unidades", int(k.units), int(d.previous_kpis.units), c.units], ["Visitas", int(k.visits), int(d.previous_kpis.visits), c.visits]].map(([l, a, b, ch]) => (
                  <div key={l as string} className="flex items-center justify-between gap-2 border-b border-line/60 pb-2 last:border-0">
                    <span className="text-ink-3">{l}</span>
                    <span className="text-right num"><span className="font-semibold">{a}</span> <span className="text-xs text-ink-3">ant. {b}</span>
                      {typeof ch === "number" && <span className={`ml-2 text-xs ${ch >= 0 ? "text-good" : "text-bad"}`}>{ch >= 0 ? "+" : ""}{ch.toFixed(1)}%</span>}</span>
                  </div>
                ))}
                {d.previous_kpis.source === "report_derived" && <p className="text-[11px] text-ink-3">Período anterior derivado das variações informadas no relatório.</p>}
              </div>
            </Card>
            <Card title="Evolução semanal">
              {d.charts.weekly ? <Bars data={d.charts.weekly} xKey="week" xFmt={(w) => `S${String(w).slice(-2)}`} bars={[{ key: "revenue", name: "Faturamento", color: "var(--color-brand)" }]} /> : <Pending>Sem vendas registradas nas últimas 16 semanas.</Pending>}
            </Card>
            <Card title="Evolução mensal" subtitle="Pedidos + relatórios agregados importados">
              {d.charts.monthly ? <Bars data={d.charts.monthly} xKey="month" xFmt={monthLabel} bars={[{ key: "revenue", name: "Pedidos", color: "var(--color-brand)", stack: "a" }, { key: "report_revenue", name: "Relatório importado", color: "var(--color-info)", stack: "a" }]} /> : <Pending>Sem histórico mensal.</Pending>}
            </Card>
            <Card title="Investimento x retorno" subtitle="Publicidade no período">
              {d.charts.ads_vs_return ? <AdsReturn data={d.charts.ads_vs_return} /> : <Pending>Sem dados de campanhas. Conecte o Product Ads ou importe o relatório de publicidade.</Pending>}
            </Card>
            <Card title="Produtos mais vendidos">
              {d.charts.top_sold ? <HBars data={d.charts.top_sold} labelKey="title" valueKey="units" money={false} /> : <Pending>Requer pedidos individuais por produto.</Pending>}
            </Card>
            <Card title="Produtos mais lucrativos">
              {d.charts.top_profit ? <HBars data={d.charts.top_profit} labelKey="title" valueKey="profit" /> : <Pending action={<Link to="/financeiro"><Button size="sm">Configurar custos</Button></Link>}>Lucro só é calculado com custos cadastrados — faturamento não é lucro.</Pending>}
            </Card>
            <Card title="Lucro por categoria">
              {d.charts.profit_by_category ? <HBars data={d.charts.profit_by_category} labelKey="category" valueKey="profit" /> : <Pending>Requer vendas de produtos com custos cadastrados.</Pending>}
            </Card>
            <Card className="xl:col-span-2" title="Conversão por anúncio" subtitle="Anúncios com visitas registradas, ordenados por tráfego">
              {d.charts.conversion_by_listing ? (
                <div className="space-y-2">
                  {d.charts.conversion_by_listing.map((l: any) => (
                    <div key={l.title} className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs">
                      <div className="min-w-0"><div className="truncate text-ink-2">{l.title}</div>
                        <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.min(100, l.conversion_pct * 5)}%` }} /></div></div>
                      <span className="num">{pct(l.conversion_pct, 1)} <span className="text-ink-3">· {int(l.visits)} vis.</span></span>
                    </div>
                  ))}
                </div>
              ) : <Pending>Sem visitas por anúncio. Importe a lista de anúncios com visitas ou conecte o Mercado Livre.</Pending>}
            </Card>
            <Card title="Operação agora">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[["Pedidos aguardando envio", op.awaiting_shipment, "/pedidos"], ["Perguntas sem resposta", op.unanswered_questions, "/perguntas"], ["Ordens de produção abertas", op.open_production_orders, "/fabrica"], ["Filamentos abaixo do mínimo", op.filaments_low, "/fabrica"]].map(([l, v, to]) => (
                  <Link key={l as string} to={to as string} className="rounded-lg border border-line p-3 transition hover:border-brand/40"><div className="text-lg font-semibold num">{int(v as number)}</div><div className="text-ink-3">{l}</div></Link>
                ))}
              </div>
            </Card>
          </div>

          {d.pending.length > 0 && (
            <Card title="O que falta para completar os indicadores" subtitle="O sistema não preenche lacunas com números fictícios">
              <ul className="space-y-1.5 text-xs text-ink-2">
                {d.pending.map((p: string) => <li key={p} className="flex gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />{p}</li>)}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/integracoes"><Button size="sm">Conectar Mercado Livre</Button></Link>
                <Link to="/importacao"><Button size="sm">Importar relatórios</Button></Link>
                <Link to="/financeiro"><Button size="sm">Configurar custos</Button></Link>
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

function Funnel({ f }: { f: any }) {
  const steps = [
    { label: "Visitas únicas", value: f.unique_visits, sub: `${int(f.likes)} curtidas` },
    { label: "Visitantes com intenção de compra", value: f.intent_unique_visitors, sub: `${int(f.intent_count)} intenções · ${int(f.intent_units)} un. · ${brl(f.intent_value)}` },
    { label: "Vendas", value: f.sales_count, sub: `${int(f.units)} un. · ${brl(f.gross_sales)} · ${int(f.unique_buyers)} compradores únicos` },
  ];
  const max = Math.max(1, f.unique_visits);
  const gap = f.intent_value - f.gross_sales;
  return (
    <Card title="Funil de compra" subtitle="Relatório de desempenho do Mercado Livre (métricas importadas)">
      <div className="space-y-3">
        {steps.map((st, i) => (
          <div key={st.label}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs"><span className="font-medium">{st.label}</span><span className="text-ink-3">{st.sub}</span></div>
            <div className="flex items-center gap-3">
              <div className="h-7 flex-1 rounded-md bg-surface-2"><div className="flex h-7 items-center rounded-md bg-brand/80 px-2 text-xs font-semibold text-white dark:text-[#04130d] num" style={{ width: `${Math.max(6, (st.value / max) * 100)}%` }}>{int(st.value)}</div></div>
              <span className="w-16 text-right text-xs text-ink-3 num">{i === 0 ? "100%" : pct((st.value / max) * 100)}</span>
            </div>
          </div>
        ))}
      </div>
      {gap > 0 && <p className="mt-3 text-[11px] text-ink-3">Intenções de compra somaram {brl(f.intent_value)} contra {brl(f.gross_sales)} em vendas brutas: {brl(gap)} iniciados e não concluídos no período (parte pode ter sido concluída em outro dia).</p>}
    </Card>
  );
}

function ImportedReports() {
  const { data } = useApi<any[]>("/period-reports");
  const company = useApi<any>("/company");
  if (!data?.length) return null;
  const r = data[0];
  const prev = r.derived_previous;
  return (
    <Card title={<span className="flex items-center gap-2"><FileText className="size-4 text-info" /> Relatório do Mercado Livre — {date(r.date_from)} a {date(r.date_to)} <SourceTag kind={r.source} /></span>}
      subtitle="Histórico importado (não é métrica em tempo real). Período anterior derivado das variações informadas.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Vendas brutas", brl(r.gross_sales), r.var_gross_sales_pct, brl(prev.gross_sales)],
          ["Unidades vendidas", int(r.units), r.var_units_pct, int(prev.units)],
          ["Quantidade de vendas", int(r.sales_count), r.var_sales_count_pct, int(prev.sales_count)],
          ["Visitas", int(r.visits), r.var_visits_pct, int(prev.visits)],
          ["Conversão", pct(r.conversion_pct), null, pct(prev.conversion_pct)],
          ["Preço médio/unidade", brl(r.avg_unit_price), r.var_avg_price_pct, brl(prev.avg_unit_price)],
        ].map(([l, v, ch, p]) => (
          <div key={l as string} className="rounded-lg bg-surface-2 p-3">
            <div className="text-[11px] text-ink-3">{l}</div>
            <div className="text-base font-semibold num">{v}</div>
            <div className="text-[11px] num">
              {l === "Conversão" ? <span className="text-bad">{r.var_conversion_pp} p.p.</span> : typeof ch === "number" ? <span className={ch >= 0 ? "text-good" : "text-bad"}>{ch > 0 ? "+" : ""}{String(ch).replace(".", ",")}%</span> : null}
              <span className="ml-1 text-ink-3">ant. ≈ {p}</span>
            </div>
          </div>
        ))}
      </div>
      {company.data && (
        <p className="mt-3 text-[11px] text-ink-3">
          Informado na implantação: {company.data.listings_identified} anúncios identificados · faturamento mensal entre {brl(company.data.monthly_revenue_min)} e {brl(company.data.monthly_revenue_max)} · meta {brl(company.data.monthly_goal)}/mês.
          {r.var_visits_pct > 0 && r.var_conversion_pp < 0 && <> Leitura: visitas {r.var_visits_pct > 0 ? "+" : ""}{r.var_visits_pct}% com conversão {r.var_conversion_pp} p.p. — o tráfego cresceu mais que as vendas.</>}
        </p>
      )}
    </Card>
  );
}
