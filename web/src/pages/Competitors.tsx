import { useState } from "react";
import { Plus, Link2, Brain, ExternalLink } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { useUser, canOperate } from "../components/Layout.tsx";
import { Card, PageHeader, Button, Input, Field, NumInput, Textarea, ErrorBox, Spinner, Badge, Table, Pending, Modal, ConfirmDialog, useToast, Notice, Thumb } from "../components/ui.tsx";
import { HBars } from "../components/charts.tsx";
import { Markdown } from "../lib/markdown.tsx";
import { brl, pct, date } from "../lib/format.ts";

const blank = { name: "", product: "", price: null, url: "", rating: null, reviews: null, public_sales: "", differentials: "", photos_note: "", our_listing_id: "", our_price: null, analyzed_at: new Date().toISOString().slice(0, 10), notes: "" };

export default function Competitors() {
  const user = useUser();
  const list = useApi<any[]>("/competitors");
  const [form, setForm] = useState<any>(null);
  const [links, setLinks] = useState<string | null>(null);
  const [linkOurs, setLinkOurs] = useState("");
  const [del, setDel] = useState<any>(null);
  const [ai, setAi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const { toast, node } = useToast();
  const rows = list.data ?? [];
  const save = async () => {
    const body = Object.fromEntries(Object.entries(form).filter(([k]) => !["id", "flags", "price_diff_pct", "our_effective_price", "created_at", "created_by", "source", "ml_item_id", "thumbnail", "our_product_id"].includes(k)).map(([k, v]) => [k, v === "" ? null : v]));
    try { if (form.id) await api(`/competitors/${form.id}`, { method: "PUT", body }); else await api("/competitors", { body }); setForm(null); list.reload(); } catch (e) { toast((e as Error).message, "bad"); }
  };
  const priceChart = rows.filter((r) => r.price).slice(0, 12).map((r) => ({ label: `${r.name}${r.product ? " · " + r.product : ""}`, price: r.price }));
  return (
    <>
      {node}
      <PageHeader title="Concorrência" subtitle="Acompanhamento de concorrentes com dados públicos: preços, avaliações, vendas observáveis e diferenciais"
        actions={canOperate(user) && <><Button icon={<Link2 className="size-4" />} onClick={() => setLinks("")}>Importar links</Button><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ ...blank })}>Cadastrar concorrente</Button></>} />
      <Notice>Somente dados públicos. Não coletamos dados privados de terceiros. Com o Mercado Livre conectado, links de anúncios são lidos pela API oficial (título, preço, vendidos quando públicos).</Notice>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card pad={false}>
          <div className="p-5">
            {list.loading && !list.data ? <Spinner /> : (
              <Table rows={rows} rowKey={(r: any) => r.id} onRowClick={canOperate(user) ? (r: any) => setForm({ ...blank, ...r }) : undefined} empty={<Pending title="Nenhum concorrente">Cadastre concorrentes ou importe links de anúncios públicos.</Pending>} cols={[
                { key: "t", header: "", render: (r: any) => <Thumb src={r.thumbnail} /> },
                { key: "n", header: "Concorrente / produto", render: (r: any) => <div className="max-w-[240px]"><div className="truncate font-medium">{r.name}</div><div className="truncate text-[11px] text-ink-3">{r.product ?? "—"}</div></div> },
                { key: "p", header: "Preço", align: "right", render: (r: any) => brl(r.price) },
                { key: "o", header: "Nosso preço", align: "right", render: (r: any) => brl(r.our_effective_price) },
                { key: "d", header: "Diferença", align: "right", render: (r: any) => (r.price_diff_pct === null ? "—" : <span className={r.price_diff_pct < -15 ? "text-bad" : r.price_diff_pct > 10 ? "text-good" : ""}>{r.price_diff_pct > 0 ? "+" : ""}{pct(r.price_diff_pct)}</span>) },
                { key: "r", header: "Avaliação", align: "right", render: (r: any) => (r.rating ? `${r.rating.toFixed(1)} (${r.reviews ?? 0})` : "—") },
                { key: "s", header: "Vendas públicas", render: (r: any) => r.public_sales ?? "—" },
                { key: "f", header: "Leitura", render: (r: any) => <div className="flex max-w-[200px] flex-wrap gap-1">{r.flags.map((f: string) => <Badge key={f} tone={f.includes("abaixo") ? "bad" : f.includes("premium") ? "good" : "neutral"}>{f}</Badge>)}</div> },
                { key: "a", header: "Análise", render: (r: any) => <span className="text-xs">{date(r.analyzed_at)}</span> },
                { key: "u", header: "", render: (r: any) => r.url && <a href={r.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} aria-label="Abrir anúncio"><ExternalLink className="size-4 text-brand" /></a> },
              ]} />
            )}
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Comparativo de preços">{priceChart.length ? <HBars data={priceChart} labelKey="label" valueKey="price" /> : <Pending>Sem preços cadastrados.</Pending>}</Card>
          <Card title="Análise da IA" action={canOperate(user) && <Button size="sm" loading={busy} icon={<Brain className="size-3.5" />} disabled={!rows.length} onClick={async () => { setBusy(true); setErr(null); try { setAi((await api("/competitors/analyze", { body: {} })).analysis); } catch (e) { setErr(e as Error); } finally { setBusy(false); } }}>Analisar</Button>}>
            <ErrorBox error={err} />
            {ai ? <div className="prose-ai text-sm"><Markdown text={ai} /></div> : <p className="text-xs text-ink-3">Identifica preços muito abaixo do nosso, diferenciais superiores, espaço para posicionamento premium, pouca diferenciação e oportunidades de kits.</p>}
          </Card>
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Editar concorrente" : "Novo concorrente"} wide
        footer={<>{form?.id && <Button variant="ghost" className="mr-auto text-bad" onClick={() => { setDel(form); setForm(null); }}>Excluir</Button>}<Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" disabled={!form?.name} onClick={save}>Salvar</Button></>}>
        {form && <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nome do concorrente"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Produto" className="sm:col-span-2"><Input value={form.product ?? ""} onChange={(e) => setForm({ ...form, product: e.target.value })} /></Field>
          <Field label="Link do anúncio" className="sm:col-span-3"><Input value={form.url ?? ""} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Preço (R$)"><NumInput value={form.price} onChange={(v) => setForm({ ...form, price: v })} /></Field>
          <Field label="Avaliação (0–5)"><NumInput value={form.rating} onChange={(v) => setForm({ ...form, rating: v })} /></Field>
          <Field label="Nº de avaliações"><NumInput value={form.reviews} onChange={(v) => setForm({ ...form, reviews: v })} /></Field>
          <Field label="Vendas publicamente observáveis"><Input value={form.public_sales ?? ""} onChange={(e) => setForm({ ...form, public_sales: e.target.value })} placeholder="ex.: +500 vendidos" /></Field>
          <Field label="Nosso anúncio (ID)"><Input value={form.our_listing_id ?? ""} onChange={(e) => setForm({ ...form, our_listing_id: e.target.value })} /></Field>
          <Field label="Nosso preço (R$)"><NumInput value={form.our_price} onChange={(v) => setForm({ ...form, our_price: v })} /></Field>
          <Field label="Diferenciais" className="sm:col-span-3"><Textarea className="min-h-16" value={form.differentials ?? ""} onChange={(e) => setForm({ ...form, differentials: e.target.value })} /></Field>
          <Field label="Fotografias (observações)" className="sm:col-span-2"><Input value={form.photos_note ?? ""} onChange={(e) => setForm({ ...form, photos_note: e.target.value })} /></Field>
          <Field label="Data da análise"><Input type="date" value={form.analyzed_at ?? ""} onChange={(e) => setForm({ ...form, analyzed_at: e.target.value })} /></Field>
        </div>}
      </Modal>
      <Modal open={links !== null} onClose={() => setLinks(null)} title="Importar links de anúncios públicos"
        footer={<><Button variant="ghost" onClick={() => setLinks(null)}>Cancelar</Button><Button variant="primary" disabled={!links?.trim()} onClick={async () => {
          try { const r = await api("/competitors/import-links", { body: { urls: links!.split(/\s+/).filter((u) => /^https?:\/\//.test(u)), our_listing_id: linkOurs || null } }); toast(`${r.results.length} link(s) importado(s)`); setLinks(null); list.reload(); } catch (e) { toast((e as Error).message, "bad"); }
        }}>Importar</Button></>}>
        <Field label="Links (um por linha)"><Textarea className="min-h-32" value={links ?? ""} onChange={(e) => setLinks(e.target.value)} /></Field>
        <Field label="Vincular ao nosso anúncio (ID, opcional)" className="mt-3"><Input value={linkOurs} onChange={(e) => setLinkOurs(e.target.value)} /></Field>
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title="Excluir concorrente" confirmLabel="Excluir" onConfirm={async () => { await api(`/competitors/${del.id}`, { method: "DELETE", body: { confirm: true } }); list.reload(); }}>Excluir “{del?.name}”?</ConfirmDialog>
    </>
  );
}
