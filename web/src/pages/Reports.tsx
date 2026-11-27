import { useState } from "react";
import { FileSpreadsheet, FileText, Eye } from "lucide-react";
import { useApi } from "../lib/api.ts";
import { Card, PageHeader, PeriodFilter, periodQuery, Button, Modal, Spinner, ErrorBox, Table, ExportButtons, type PeriodValue } from "../components/ui.tsx";
import { brl, pct } from "../lib/format.ts";

const DESC: Record<string, string> = {
  sales: "Pedidos, itens, valores, pagamento, envio e rastreio.",
  products: "Anúncios com preço, estoque e vendas no período.",
  financial: "Receita, tarifas, frete, custos, impostos e lucro.",
  profitability: "Lucro e margem por produto.",
  stock: "Estoque, giro, cobertura e plano de produção.",
  ads: "Investimento, CTR, CPC, ACOS e ROAS por campanha.",
  monthly: "Faturamento mensal e indicadores do período.",
  opportunities: "Oportunidades comerciais e estimativas.",
};

function Preview({ k, q, onClose }: { k: string; q: string; onClose: () => void }) {
  const { data, error, loading } = useApi<any>(`/reports/${k}?${q}`);
  return (
    <Modal open onClose={onClose} title={data?.title ?? "Relatório"} wide>
      {loading && <Spinner />}
      <ErrorBox error={error} />
      {data && (
        <div className="space-y-4">
          <p className="text-xs text-ink-3">{data.subtitle}</p>
          <dl className="grid gap-2 sm:grid-cols-2">{data.summary.map(([a, b]: string[]) => <div key={a} className="rounded-lg bg-surface-2 px-3 py-2 text-sm"><dt className="text-[11px] text-ink-3">{a}</dt><dd className="font-medium">{b}</dd></div>)}</dl>
          <Table rows={data.rows.slice(0, 100).map((r: any, i: number) => ({ ...r, __i: i }))} rowKey={(r: any) => r.__i}
            cols={data.columns.map((c: any) => ({ key: c.key, header: c.header, align: ["money", "int", "pct", "num"].includes(c.fmt) ? "right" : undefined,
              render: (r: any) => { const v = r[c.key]; return v === null || v === undefined ? "—" : c.fmt === "money" ? brl(v) : c.fmt === "pct" ? pct(v) : c.fmt === "num" && typeof v === "number" ? v.toFixed(2) : String(v); } }))} />
          {data.rows.length > 100 && <p className="text-xs text-ink-3">Mostrando 100 de {data.rows.length} linhas. Exporte para ver tudo.</p>}
        </div>
      )}
    </Modal>
  );
}

export default function Reports() {
  const [period, setPeriod] = useState<PeriodValue>({ period: "30d" });
  const { data } = useApi<Record<string, string>>("/reports");
  const [preview, setPreview] = useState<string | null>(null);
  const q = periodQuery(period);
  return (
    <>
      <PageHeader title="Relatórios e exportações" subtitle="Exporte em Excel ou PDF com os dados reais da loja." actions={<PeriodFilter value={period} onChange={setPeriod} />} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(data ?? {}).map(([k, title]) => (
          <Card key={k} className="flex flex-col">
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-xs text-ink-3 flex-1">{DESC[k]}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" icon={<Eye className="size-3.5" />} onClick={() => setPreview(k)}>Ver</Button>
              <a href={`/api/reports/${k}?${q}&format=xlsx`}><Button size="sm" icon={<FileSpreadsheet className="size-3.5" />}>Excel</Button></a>
              <a href={`/api/reports/${k}?${q}&format=pdf`}><Button size="sm" icon={<FileText className="size-3.5" />}>PDF</Button></a>
            </div>
          </Card>
        ))}
      </div>
      <h2 className="mb-3 mt-8 text-sm font-semibold">Relatórios da Mind2Matter Intelligence</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Central de anúncios", "Preço, estoque, visitas, vendas, conversão, qualidade, classe, margem e lucro por unidade.", "/listings-center/export?days=30"],
          ["Ranking — 20 anúncios prioritários", "Prioridades de otimização com motivos.", "/listings-center/export?days=30&list=priority"],
          ["Ordens de produção", "Fila, tempos, filamento, prazos e status.", "/factory/export?kind=orders"],
          ["Estoque de filamentos", "Disponível, mínimo, custo/kg e consumo.", "/factory/export?kind=filaments"],
          ["DRE gerencial do mês", "Receita, tarifas, custos, margem de contribuição e resultado.", `/finance/dre?month=${new Date().toISOString().slice(0, 7)}`],
          ["Metas e crescimento", "Simulação de pedidos, unidades, horas e filamento por ticket.", "/goals/export"],
        ].map(([t, dsc, path]) => (
          <Card key={t} className="flex flex-col"><h3 className="text-sm font-semibold">{t}</h3><p className="mt-1 flex-1 text-xs text-ink-3">{dsc}</p><div className="mt-4"><ExportButtons path={path} label="" /></div></Card>
        ))}
      </div>
      {preview && <Preview k={preview} q={q} onClose={() => setPreview(null)} />}
    </>
  );
}
