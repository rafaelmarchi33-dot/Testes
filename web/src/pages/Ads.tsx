import { useState } from "react";
import { Megaphone, Sparkles } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, PageHeader, Spinner, ErrorBox, Table, Badge, Empty, Stat, Button, Notice, Thumb } from "../components/ui.tsx";
import { SmallLine } from "../components/charts.tsx";
import { Markdown } from "../lib/markdown.tsx";
import { brl, int, ratioPct, relative } from "../lib/format.ts";

/** Diagnóstico determinístico (regras transparentes) para cada campanha. */
function diagnose(c: any): { tone: "bad" | "warn" | "good" | "neutral"; text: string } {
  if (!c.cost) return { tone: "neutral", text: "Sem investimento no período" };
  if (c.cost > 0 && !c.total_amount) return { tone: "bad", text: "Investe sem gerar vendas atribuídas" };
  if (c.acos_target && c.acos !== null && c.acos * 100 > c.acos_target * 1.3) return { tone: "bad", text: `ACOS ${ratioPct(c.acos)} acima do objetivo (${c.acos_target}%)` };
  if (c.ctr !== null && c.ctr < 0.003 && c.prints > 1000) return { tone: "warn", text: "CTR baixo: revise fotos/título dos anúncios" };
  if (c.roas !== null && c.roas >= 8) return { tone: "good", text: "Retorno alto: candidato a mais orçamento" };
  return { tone: "neutral", text: "Dentro do esperado" };
}

export default function Ads() {
  const { data, error, loading, reload } = useApi<any>("/ads");
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const t = data?.totals;
  const askAi = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api("/ai/ask", { body: { question: "Analise o desempenho das minhas campanhas de publicidade (ads_campaigns no snapshot). Identifique campanhas com baixo desempenho, explique o motivo com números (ACOS, ROAS, CTR, CPC) e sugira ajustes concretos de orçamento, lances ou anúncios. Lembre que nenhuma alteração será feita automaticamente." } });
      setAnalysis(r.answer);
    } catch (e) { setErr(e as Error); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Publicidade e performance" subtitle={data?.sync?.last_success_at ? `Mercado Ads · últimos 30 dias · sincronizado ${relative(data.sync.last_success_at)}` : "Mercado Ads (Product Ads)"}
        actions={data?.available && <Button icon={<Sparkles className="size-4" />} loading={busy} onClick={askAi}>Analisar com IA</Button>} />
      <ErrorBox error={error ?? err} onRetry={reload} />
      {loading && !data ? <Spinner /> : data && !data.available ? (
        <Card><Empty icon={<Megaphone className="size-5" />} title="Dados de publicidade indisponíveis">
          {data.sync?.message ?? "A sincronização de publicidade ainda não foi executada."}
          <br />Requer Product Ads ativo na conta e permissão de leitura de publicidade no aplicativo do Mercado Livre. Nenhum dado é simulado.
        </Empty></Card>
      ) : data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Investimento" value={brl(t.cost)} />
            <Stat label="Impressões" value={int(t.prints)} />
            <Stat label="Cliques" value={int(t.clicks)} />
            <Stat label="CTR" value={ratioPct(t.ctr)} />
            <Stat label="CPC" value={brl(t.cpc)} />
            <Stat label="Vendas atribuídas" value={brl(t.total_amount)} />
            <Stat label="ACOS" value={ratioPct(t.acos)} />
            <Stat label="ROAS" value={t.roas ? t.roas.toFixed(2) : "—"} />
          </div>
          {analysis && <Card title="Análise da IA"><Markdown text={analysis} /></Card>}
          {data.daily.length > 0 && <Card title="Investimento x vendas atribuídas"><SmallLine data={data.daily} keys={[{ key: "cost", name: "Investimento", color: "var(--color-bad)", money: true }, { key: "total_amount", name: "Vendas", color: "var(--color-good)", money: true }]} /></Card>}
          <Card title="Campanhas">
            <Table rows={data.campaigns} rowKey={(r: any) => r.id}
              cols={[
                { key: "name", header: "Campanha", render: (r: any) => <div><div className="font-medium">{r.name}</div><div className="text-[11px] text-ink-3">{r.status} · orçamento {brl(r.budget)}{r.acos_target ? ` · ACOS alvo ${r.acos_target}%` : ""}</div></div> },
                { key: "cost", header: "Invest.", align: "right", render: (r: any) => brl(r.cost) },
                { key: "prints", header: "Impr.", align: "right", render: (r: any) => int(r.prints) },
                { key: "clicks", header: "Cliques", align: "right", render: (r: any) => int(r.clicks) },
                { key: "ctr", header: "CTR", align: "right", render: (r: any) => ratioPct(r.ctr) },
                { key: "cpc", header: "CPC", align: "right", render: (r: any) => brl(r.cpc) },
                { key: "total_amount", header: "Vendas", align: "right", render: (r: any) => brl(r.total_amount) },
                { key: "acos", header: "ACOS", align: "right", render: (r: any) => ratioPct(r.acos) },
                { key: "roas", header: "ROAS", align: "right", render: (r: any) => r.roas?.toFixed(2) ?? "—" },
                { key: "diag", header: "Diagnóstico", render: (r: any) => { const d = diagnose(r); return <Badge tone={d.tone}>{d.text}</Badge>; } },
              ]} />
          </Card>
          <Card title="Desempenho por produto">
            <Table rows={data.items} rowKey={(r: any) => r.listing_id} empty={<Empty title="Sem métricas por anúncio" />}
              cols={[
                { key: "title", header: "Anúncio", render: (r: any) => <div className="flex items-center gap-2"><Thumb src={r.thumbnail} size={28} /><span className="max-w-[300px] truncate">{r.title ?? r.listing_id}</span></div> },
                { key: "cost", header: "Invest.", align: "right", render: (r: any) => brl(r.cost) },
                { key: "clicks", header: "Cliques", align: "right", render: (r: any) => int(r.clicks) },
                { key: "ctr", header: "CTR", align: "right", render: (r: any) => ratioPct(r.ctr) },
                { key: "total_amount", header: "Vendas", align: "right", render: (r: any) => brl(r.total_amount) },
                { key: "acos", header: "ACOS", align: "right", render: (r: any) => ratioPct(r.acos) },
                { key: "roas", header: "ROAS", align: "right", render: (r: any) => r.roas?.toFixed(2) ?? "—" },
              ]} />
          </Card>
          <Notice>O sistema apenas lê dados de publicidade. Alterações de orçamento ou campanhas nunca são feitas automaticamente: aplique os ajustes no Mercado Ads.</Notice>
        </div>
      )}
    </>
  );
}
