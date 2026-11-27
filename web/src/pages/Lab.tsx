import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { Plus, FlaskConical, Upload, FileBox, Image as ImageIcon, Trash2, PackageCheck, Megaphone } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { useUser, isAdmin, canOperate } from "../components/Layout.tsx";
import { Card, PageHeader, Button, Input, Select, Field, NumInput, Textarea, ErrorBox, Spinner, Badge, Modal, Pending, ConfirmDialog, useToast, Tabs, cx } from "../components/ui.tsx";
import { brl, pct, dateTime } from "../lib/format.ts";

const STATUS_TONE: Record<string, any> = { idea: "neutral", research: "info", development: "info", testing: "warn", approved: "good", production: "brand", selling: "good", discontinued: "neutral" };
const blank = { name: "", sku: "", category: "", model_supplier: "", license: "", weight_g: null, print_minutes: null, material: "PLA", est_cost: null, sale_price: null, status: "idea", description: "", notes: "" };

export default function Lab() {
  const list = useApi<any>("/lab");
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState<any>(null);
  const [view, setView] = useState<"board" | "list">("board");
  const { toast, node } = useToast();
  const statuses: { value: string; label: string }[] = list.data?.statuses ?? [];
  const openId = params.get("id");
  const create = async () => {
    try { const r = await api("/lab", { body: clean(form) }); setForm(null); list.reload(); setParams({ id: String(r.id) }); } catch (e) { toast((e as Error).message, "bad"); }
  };
  return (
    <>
      {node}
      <PageHeader title="Laboratório de produtos" subtitle="Desenvolvimento de novos produtos: arquivos STL/3MF, fotos, licença, testes, custos e aprovação"
        actions={<><Tabs value={view} onChange={setView} items={[{ value: "board", label: "Quadro" }, { value: "list", label: "Lista" }]} /><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ ...blank })}>Novo produto</Button></>} />
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? <Spinner /> : (list.data?.items ?? []).length === 0 ? (
        <Card><Pending title="Laboratório vazio" action={<Button size="sm" onClick={() => setForm({ ...blank })}>Cadastrar primeira ideia</Button>}>Crie produtos aqui ou envie oportunidades a partir do Radar de Produtos 3D.</Pending></Card>
      ) : view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {statuses.map((s) => {
            const items = list.data.items.filter((i: any) => i.status === s.value);
            return (
              <div key={s.value} className="w-64 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold"><span>{s.label}</span><span className="text-ink-3 num">{items.length}</span></div>
                <div className="space-y-2">
                  {items.map((i: any) => <LabCard key={i.id} i={i} onClick={() => setParams({ id: String(i.id) })} />)}
                  {!items.length && <div className="rounded-lg border border-dashed border-line p-4 text-center text-[11px] text-ink-3">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.data.items.map((i: any) => <LabCard key={i.id} i={i} onClick={() => setParams({ id: String(i.id) })} />)}</div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title="Novo produto no laboratório" wide footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" disabled={!form?.name} onClick={create}>Criar</Button></>}>
        {form && <LabForm f={form} set={setForm} statuses={statuses} />}
      </Modal>
      <LabDetail id={openId} statuses={statuses} onClose={() => setParams({})} onChanged={list.reload} />
    </>
  );
}

const clean = (f: any) => ({ ...f, sku: f.sku || null, category: f.category || null, model_supplier: f.model_supplier || null, license: f.license || null, description: f.description || null, notes: f.notes || null });

function LabCard({ i, onClick }: { i: any; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full rounded-xl border border-line bg-surface p-3 text-left transition hover:border-brand/40">
      {i.cover ? <img src={`/api/lab-files/${i.cover}`} alt="" className="mb-2 h-28 w-full rounded-lg object-cover" /> : <div className="mb-2 grid h-16 place-items-center rounded-lg bg-surface-2 text-ink-3"><FlaskConical className="size-5" /></div>}
      <div className="truncate text-sm font-medium">{i.name}</div>
      <div className="mt-1 flex flex-wrap gap-1 text-[10px]"><Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge>{i.sku && <Badge>{i.sku}</Badge>}{i.files > 0 && <Badge>{i.files} arq.</Badge>}{i.tests > 0 && <Badge tone="warn">{i.tests} teste(s)</Badge>}</div>
      <div className="mt-1.5 text-[11px] text-ink-3 num">Custo {brl(i.est_cost)} · Preço {brl(i.sale_price)} · Margem {pct(i.margin_pct)}</div>
    </button>
  );
}

function LabForm({ f, set, statuses }: { f: any; set: (f: any) => void; statuses: { value: string; label: string }[] }) {
  const u = (k: string) => (e: any) => set({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Nome" className="sm:col-span-2"><Input value={f.name} onChange={u("name")} /></Field>
      <Field label="SKU"><Input value={f.sku ?? ""} onChange={u("sku")} /></Field>
      <Field label="Categoria"><Input value={f.category ?? ""} onChange={u("category")} /></Field>
      <Field label="Fornecedor do modelo"><Input value={f.model_supplier ?? ""} onChange={u("model_supplier")} placeholder="autoral, MakerWorld, Printables…" /></Field>
      <Field label="Licença comercial" hint="Confirme se o modelo permite venda"><Input value={f.license ?? ""} onChange={u("license")} placeholder="ex.: autoral / comercial permitida" /></Field>
      <Field label="Peso (g)"><NumInput value={f.weight_g} onChange={(v) => set({ ...f, weight_g: v })} /></Field>
      <Field label="Tempo de impressão (min)"><NumInput value={f.print_minutes} onChange={(v) => set({ ...f, print_minutes: v })} /></Field>
      <Field label="Material"><Select value={f.material ?? "PLA"} onChange={u("material")}><option>PLA</option><option>PETG</option></Select></Field>
      <Field label="Custo (R$)" hint="Use a calculadora do Financeiro"><NumInput value={f.est_cost} onChange={(v) => set({ ...f, est_cost: v })} /></Field>
      <Field label="Preço de venda (R$)"><NumInput value={f.sale_price} onChange={(v) => set({ ...f, sale_price: v })} /></Field>
      <Field label="Status"><Select value={f.status} onChange={u("status")}>{statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
      <Field label="Descrição" className="sm:col-span-3"><Textarea value={f.description ?? ""} onChange={u("description")} /></Field>
      <Field label="Notas" className="sm:col-span-3"><Textarea className="min-h-16" value={f.notes ?? ""} onChange={u("notes")} /></Field>
      {f.sale_price && f.est_cost !== null && <div className="text-xs text-ink-3 sm:col-span-3">Margem estimada: <b className="text-ink">{pct(((f.sale_price - f.est_cost) / f.sale_price) * 100)}</b> (sem taxas, se o custo não as incluir)</div>}
    </div>
  );
}

function LabDetail({ id, statuses, onClose, onChanged }: { id: string | null; statuses: { value: string; label: string }[]; onClose: () => void; onChanged: () => void }) {
  const d = useApi<any>(id ? `/lab/${id}` : null, [id]);
  const user = useUser();
  const nav = useNavigate();
  const [f, setF] = useState<any>(null);
  const [ev, setEv] = useState({ kind: "test", title: "", details: "", result: "" });
  const [confirm, setConfirm] = useState<null | "convert" | "delete" | { file: any }>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast, node } = useToast();
  useEffect(() => { if (d.data) setF({ ...d.data }); }, [d.data]);
  const refresh = () => { d.reload(); onChanged(); };
  const save = async () => { try { await api(`/lab/${id}`, { method: "PUT", body: clean(f) }); toast("Alterações salvas no histórico"); refresh(); } catch (e) { toast((e as Error).message, "bad"); } };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    for (const x of Array.from(files)) fd.append("files", x);
    setUploading(true);
    try { await api(`/lab/${id}/files`, { form: fd }); toast("Arquivos anexados"); refresh(); } catch (e) { toast((e as Error).message, "bad"); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  return (
    <Modal open={!!id} onClose={onClose} title={d.data?.name ?? "Produto"} wide>
      {node}
      {d.loading && !d.data ? <Spinner /> : f && (
        <div className="space-y-5">
          <LabForm f={f} set={setF} statuses={statuses} />
          {canOperate(user) && <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={save}>Salvar</Button>
            {["approved", "production"].includes(d.data.status) && !d.data.product_id && isAdmin(user) && <Button icon={<PackageCheck className="size-4" />} onClick={() => setConfirm("convert")}>Transformar em cadastro comercial</Button>}
            {d.data.product_id && <Badge tone="good">Produto comercial #{d.data.product_id}</Badge>}
            <Button icon={<Megaphone className="size-4" />} onClick={() => nav(`/marketing?lab=${id}`)}>Gerar anúncio</Button>
            {isAdmin(user) && <Button variant="ghost" className="ml-auto text-bad" onClick={() => setConfirm("delete")}>Excluir</Button>}
          </div>}

          <Card title="Arquivos (STL, 3MF, imagens)" action={canOperate(user) && <><input ref={fileRef} type="file" multiple hidden accept=".stl,.3mf,.obj,.step,image/jpeg,image/png,image/webp" onChange={(e) => upload(e.target.files)} /><Button size="sm" loading={uploading} icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>Anexar</Button></>}>
            {d.data.files.length === 0 ? <p className="text-xs text-ink-3">Nenhum arquivo anexado.</p> : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {d.data.files.map((x: any) => (
                  <div key={x.id} className="group relative rounded-lg border border-line p-2 text-[11px]">
                    {x.kind === "image" ? <img src={`/api/lab-files/${x.filename}`} alt={x.original_name} className="h-20 w-full rounded object-cover" /> : <a href={`/api/lab-files/${x.filename}`} className="grid h-20 place-items-center rounded bg-surface-2 text-ink-3 hover:text-brand"><FileBox className="size-6" /></a>}
                    <div className="mt-1 flex items-center gap-1"><span className="uppercase text-ink-3">{x.kind === "image" ? <ImageIcon className="inline size-3" /> : x.kind}</span><span className="truncate" title={x.original_name}>{x.original_name}</span></div>
                    {canOperate(user) && <button aria-label="Remover" className="absolute right-1 top-1 hidden rounded bg-surface p-1 group-hover:block" onClick={() => setConfirm({ file: x })}><Trash2 className="size-3 text-bad" /></button>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Histórico de testes e alterações">
            {canOperate(user) && (
              <div className="mb-4 grid gap-2 sm:grid-cols-[120px_1fr_130px_auto]">
                <Select value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value })}><option value="test">Teste</option><option value="change">Alteração</option><option value="note">Nota</option></Select>
                <Input placeholder="ex.: Teste PETG 0,2 mm — encaixe" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} />
                <Select value={ev.result} onChange={(e) => setEv({ ...ev, result: e.target.value })} disabled={ev.kind !== "test"}><option value="">Resultado…</option><option value="aprovado">Aprovado</option><option value="ajustar">Ajustar</option><option value="reprovado">Reprovado</option></Select>
                <Button disabled={ev.title.length < 2} onClick={async () => { await api(`/lab/${id}/events`, { body: { kind: ev.kind, title: ev.title, details: ev.details || undefined, result: ev.kind === "test" && ev.result ? ev.result : undefined } }); setEv({ kind: "test", title: "", details: "", result: "" }); refresh(); }}>Registrar</Button>
                <Textarea className="min-h-12 sm:col-span-4" placeholder="Detalhes: parâmetros, tempo real, peso real, problemas…" value={ev.details} onChange={(e) => setEv({ ...ev, details: e.target.value })} />
              </div>
            )}
            <ol className="space-y-2">
              {d.data.events.map((e: any) => (
                <li key={e.id} className="flex gap-3 text-xs">
                  <span className={cx("mt-1 size-2 shrink-0 rounded-full", e.kind === "test" ? (e.result === "aprovado" ? "bg-good" : e.result === "reprovado" ? "bg-bad" : "bg-warn") : e.kind === "status" ? "bg-brand" : "bg-ink-3")} />
                  <div><div className="font-medium">{e.title}{e.result && <Badge className="ml-1.5" tone={e.result === "aprovado" ? "good" : e.result === "reprovado" ? "bad" : "warn"}>{e.result}</Badge>}</div>
                    {e.details && <div className="whitespace-pre-wrap text-ink-3">{e.details}</div>}<div className="text-[10px] text-ink-3">{dateTime(e.created_at)} · {e.user_name ?? "sistema"}</div></div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
      <ConfirmDialog open={confirm === "convert"} onClose={() => setConfirm(null)} title="Transformar em cadastro comercial" confirmLabel="Criar produto"
        onConfirm={async () => { const r = await api(`/lab/${id}/convert`, { body: { confirm: true } }); toast(`Produto #${r.product_id} criado`); refresh(); }}>
        Será criado um produto comercial com SKU, peso, tempo e material deste item. Nenhum anúncio é publicado automaticamente.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} danger title="Excluir produto do laboratório" confirmLabel="Excluir"
        onConfirm={async () => { await api(`/lab/${id}`, { method: "DELETE", body: { confirm: true } }); onChanged(); onClose(); }}>Excluir o produto, seus arquivos e histórico? Esta ação não pode ser desfeita.</ConfirmDialog>
      <ConfirmDialog open={!!confirm && typeof confirm === "object"} onClose={() => setConfirm(null)} danger title="Remover arquivo" confirmLabel="Remover"
        onConfirm={async () => { await api(`/lab-files/${(confirm as any).file.id}`, { method: "DELETE", body: { confirm: true } }); refresh(); }}>Remover “{(confirm as any)?.file?.original_name}”?</ConfirmDialog>
    </Modal>
  );
}
