import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ImagePlus, Sparkles, Save, ShieldCheck, Send, ExternalLink, Trash2, AlertTriangle, CheckCircle2, Wand2, X, Camera } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, Button, PageHeader, Field, Input, Select, Textarea, ErrorBox, Badge, Empty, Spinner, Notice, Modal, useToast, cx } from "../components/ui.tsx";
import { brl, dateTime, LISTING_TYPE } from "../lib/format.ts";
import { useUser, canOperate, isAdmin } from "../components/Layout.tsx";

const DRAFT_STATUS: Record<string, [string, any]> = {
  draft: ["Rascunho", "neutral"], pending_approval: ["Aguardando aprovação", "warn"], publishing: ["Publicando", "info"],
  published: ["Publicado", "good"], failed: ["Falhou", "bad"],
};
const img = (f: string) => `/api/uploads/${encodeURIComponent(f)}`;

function NewProduct({ onCreated }: { onCreated: (id: number) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const numOrUndef = (v?: string) => (v === undefined || v === "" ? undefined : Number(v.replace(",", ".")));
  const add = (list: FileList | null) => list && setFiles((x) => [...x, ...Array.from(list).filter((i) => i.type.startsWith("image/"))].slice(0, 12));

  const submit = async () => {
    setErr(null);
    const payload = {
      name: f.name || undefined, material: f.material || undefined, dimensions: f.dimensions || undefined, weight_g: numOrUndef(f.weight_g),
      features: f.features || undefined, category_hint: f.category_hint || undefined, quantity: numOrUndef(f.quantity),
      package_contents: f.package_contents || undefined, usage: f.usage || undefined,
      material_cost: numOrUndef(f.material_cost), manufacturing_cost: numOrUndef(f.manufacturing_cost), packaging_cost: numOrUndef(f.packaging_cost), production_minutes: numOrUndef(f.production_minutes),
    };
    const form = new FormData();
    form.append("input", JSON.stringify(payload));
    files.forEach((file) => form.append("images", file));
    try {
      setBusy("Enviando fotos…");
      const { id } = await api("/drafts", { form });
      setBusy("A IA está analisando as fotos e preparando o anúncio… (pode levar até 1 minuto)");
      try { await api(`/drafts/${id}/generate`, { body: {} }); } catch (e) { setErr(e as Error); }
      onCreated(id);
    } catch (e) { setErr(e as Error); } finally { setBusy(null); }
  };

  return (
    <Card title="Novo produto" subtitle="Envie fotos e, se quiser, os detalhes. Com apenas uma foto a IA sugere as informações e indica o que precisa ser confirmado.">
      <div className="space-y-5">
        <div
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
          onClick={() => input.current?.click()}
          className="cursor-pointer rounded-xl border-2 border-dashed border-line bg-surface-2/50 p-6 text-center hover:border-brand/50 transition"
        >
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => add(e.target.files)} />
          <Camera className="mx-auto size-6 text-ink-3" />
          <p className="mt-2 text-sm font-medium">Arraste fotos ou clique para selecionar</p>
          <p className="text-xs text-ink-3">JPG, PNG ou WebP · até 12 imagens · 10 MB cada · fundo claro e boa iluminação aumentam a conversão</p>
        </div>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((file, i) => (
              <div key={i} className="relative">
                <img src={URL.createObjectURL(file)} alt="" className="size-20 rounded-lg border border-line object-cover" />
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-bg" aria-label="Remover"><X className="size-3" /></button>
                {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] text-white">capa</span>}
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Nome do produto"><Input value={f.name ?? ""} onChange={set("name")} placeholder="Ex.: Suporte de headset de mesa" /></Field>
          <Field label="Material"><Input value={f.material ?? ""} onChange={set("material")} placeholder="Ex.: PLA, PETG, resina" /></Field>
          <Field label="Categoria (opcional)"><Input value={f.category_hint ?? ""} onChange={set("category_hint")} placeholder="Ex.: acessórios gamer" /></Field>
          <Field label="Dimensões"><Input value={f.dimensions ?? ""} onChange={set("dimensions")} placeholder="Ex.: 12 x 8 x 25 cm" /></Field>
          <Field label="Peso (g)"><Input inputMode="decimal" value={f.weight_g ?? ""} onChange={set("weight_g")} /></Field>
          <Field label="Quantidade disponível"><Input inputMode="numeric" value={f.quantity ?? ""} onChange={set("quantity")} /></Field>
          <Field label="Custo de matéria-prima (R$)"><Input inputMode="decimal" value={f.material_cost ?? ""} onChange={set("material_cost")} /></Field>
          <Field label="Custo de fabricação (R$)" hint="energia, desgaste, mão de obra"><Input inputMode="decimal" value={f.manufacturing_cost ?? ""} onChange={set("manufacturing_cost")} /></Field>
          <Field label="Custo de embalagem (R$)"><Input inputMode="decimal" value={f.packaging_cost ?? ""} onChange={set("packaging_cost")} /></Field>
          <Field label="Características e diferenciais" className="sm:col-span-2 lg:col-span-3"><Textarea value={f.features ?? ""} onChange={set("features")} placeholder="Ex.: encaixe sem parafusos, base antiderrapante, 6 cores disponíveis" /></Field>
          <Field label="Conteúdo da embalagem"><Input value={f.package_contents ?? ""} onChange={set("package_contents")} placeholder="Ex.: 1 suporte" /></Field>
          <Field label="Como usar" className="lg:col-span-2"><Input value={f.usage ?? ""} onChange={set("usage")} /></Field>
        </div>
        <ErrorBox error={err} />
        <div className="flex items-center justify-end gap-3">
          {busy && <span className="text-xs text-ink-3 flex items-center gap-1.5"><Sparkles className="size-3.5 animate-pulse text-brand" />{busy}</span>}
          <Button variant="primary" icon={<Wand2 className="size-4" />} loading={!!busy} disabled={!files.length && !f.name} onClick={submit}>Gerar anúncio com IA</Button>
        </div>
      </div>
    </Card>
  );
}

function Editor({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const user = useUser();
  const { data, error, loading, reload } = useApi<any>(`/drafts/${id}`);
  const [final, setFinal] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [validation, setValidation] = useState<any>(null);
  const [publishAction, setPublishAction] = useState<number | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const { toast, node } = useToast();
  const more = useRef<HTMLInputElement>(null);
  useEffect(() => { if (data) setFinal(data.final); }, [data]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const ai = data.ai_output;
  const meta: any[] = ai?.attributes_meta ?? [];
  const maxLen = ai?.category?.max_title_length ?? 60;
  const locked = ["published", "publishing"].includes(data.status);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(null);
    try { await fn(); } catch (e) { setErr(e as Error); } finally { setBusy(null); }
  };
  const save = () => api(`/drafts/${id}`, { method: "PUT", body: { ...final, price: Number(final.price), available_quantity: Number(final.available_quantity) } });
  const setAttr = (attrId: string, value: string) => {
    const m = meta.find((a) => a.id === attrId);
    const match = m?.values?.find((v: any) => v.name === value);
    const rest = (final.attributes ?? []).filter((a: any) => a.id !== attrId);
    setFinal({ ...final, attributes: value ? [...rest, match ? { id: attrId, value_id: match.id, value_name: match.name } : { id: attrId, value_name: value }] : rest });
  };
  const attrVal = (attrId: string) => (final?.attributes ?? []).find((a: any) => a.id === attrId)?.value_name ?? "";
  const toConfirm = new Map((ai?.composition?.atributos ?? []).map((a: any) => [a.id, a.origem]));
  const missingRequired = meta.filter((a) => a.required && !attrVal(a.id));

  return (
    <div className="space-y-6">
      {node}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={DRAFT_STATUS[data.status]?.[1]}>{DRAFT_STATUS[data.status]?.[0] ?? data.status}</Badge>
        <span className="text-xs text-ink-3">Rascunho #{data.id} · atualizado {dateTime(data.updated_at)}</span>
        {!locked && canOperate(user) && <Button size="sm" variant="ghost" className="ml-auto text-bad" icon={<Trash2 className="size-3.5" />} onClick={() => run("del", async () => { await api(`/drafts/${id}`, { method: "DELETE" }); onDeleted(); })}>Excluir</Button>}
      </div>

      {data.status === "published" && (
        <div className="flex flex-col gap-2 rounded-xl border border-good/30 bg-good-soft p-4 text-sm sm:flex-row sm:items-center">
          <CheckCircle2 className="size-5 text-good" />
          <div className="flex-1"><b>Anúncio publicado no Mercado Livre.</b> ID <b>{data.ml_item_id}</b> · status <b>{data.ml_status}</b></div>
          {data.permalink && <a href={data.permalink} target="_blank" rel="noreferrer"><Button size="sm" icon={<ExternalLink className="size-3.5" />}>Abrir anúncio</Button></a>}
        </div>
      )}
      {data.error && <ErrorBox error={new Error(data.error)} />}

      <Card title="Fotos">
        <div className="flex flex-wrap gap-2">
          {data.images.map((f: string, i: number) => (
            <div key={f} className="relative"><img src={img(f)} alt="" className="size-24 rounded-lg border border-line object-cover" />{i === 0 && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] text-white">capa</span>}</div>
          ))}
          {!locked && canOperate(user) && (
            <button onClick={() => more.current?.click()} className="grid size-24 place-items-center rounded-lg border-2 border-dashed border-line text-ink-3 hover:border-brand/50"><ImagePlus className="size-5" /></button>
          )}
          <input ref={more} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => {
            const fd = new FormData(); Array.from(e.target.files ?? []).forEach((x) => fd.append("images", x));
            run("img", async () => { await api(`/drafts/${id}/images`, { form: fd }); await reload(); });
          }} />
        </div>
        {ai?.composition?.sugestoes_imagens?.length > 0 && (
          <div className="mt-4 text-xs text-ink-2"><span className="font-medium text-ink">Fotos recomendadas pela IA:</span> {ai.composition.sugestoes_imagens.join(" · ")}</div>
        )}
      </Card>

      {ai && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Análise da IA" subtitle={`Gerado em ${dateTime(ai.generated_at)}`}>
            {ai.identification && (
              <div className="space-y-2 text-sm">
                <div><span className="text-ink-3 text-xs">Produto identificado: </span><b>{ai.identification.produto_identificado}</b> <Badge tone={ai.identification.confianca === "alta" ? "good" : "warn"}>confiança {ai.identification.confianca}</Badge></div>
                <p className="text-ink-2">{ai.identification.descricao_visual}</p>
                <div className="text-xs text-ink-2">Material provável: {ai.identification.provavel_material} · Processo: {ai.identification.provavel_processo}</div>
                {ai.identification.riscos?.length > 0 && <Notice tone="warn" title="Atenção:">{ai.identification.riscos.join(" · ")}</Notice>}
              </div>
            )}
            {(ai.composition?.pontos_a_confirmar?.length > 0 || ai.identification?.informacoes_a_confirmar?.length > 0) && (
              <div className="mt-4">
                <p className="text-xs font-medium flex items-center gap-1.5"><AlertTriangle className="size-3.5 text-warn" />Confirme antes de publicar</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-ink-2 space-y-0.5">
                  {[...new Set([...(ai.identification?.informacoes_a_confirmar ?? []), ...(ai.composition?.pontos_a_confirmar ?? [])])].map((x: string) => <li key={x}>{x}</li>)}
                </ul>
              </div>
            )}
            {ai.notes?.length > 0 && <div className="mt-4 space-y-1">{ai.notes.map((n: string) => <Notice key={n} tone="warn">{n}</Notice>)}</div>}
          </Card>
          <Card title="Preço e concorrência">
            {ai.pricing?.simulation ? (
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-ink-3">Preço sugerido (margem-alvo)</span><b className="num">{brl(ai.pricing.price)}</b></div>
                <div className="flex justify-between"><span className="text-ink-3">Preço mínimo (lucro zero)</span><span className="num">{brl(ai.pricing.simulation.min_price)}</span></div>
                <div className="flex justify-between"><span className="text-ink-3">Tarifa ML ({LISTING_TYPE[ai.pricing.fee.listing_type_id] ?? ""})</span><span className="num">{(ai.pricing.fee.percentage * 100).toFixed(1)}% + {brl(ai.pricing.fee.fixed)}</span></div>
                <div className="flex justify-between"><span className="text-ink-3">Custo de produção</span><span className="num">{brl(ai.pricing.simulation.production_cost)}</span></div>
                <div className="flex justify-between"><span className="text-ink-3">Lucro líquido estimado</span><span className="num text-good font-medium">{brl(ai.pricing.simulation.net_profit)} ({ai.pricing.simulation.margin_pct}%)</span></div>
              </div>
            ) : <p className="text-xs text-ink-3">Preço sugerido indisponível: informe custos e conecte o Mercado Livre para consultar a tarifa oficial.</p>}
            {ai.market && (
              <div className="mt-4 border-t border-line pt-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-ink-3">Concorrentes analisados</span><span className="num">{ai.market.count} anúncios · {ai.market.sellers} vendedores</span></div>
                <div className="flex justify-between"><span className="text-ink-3">Faixa de preço</span><span className="num">{brl(ai.market.price_min)} – {brl(ai.market.price_max)}</span></div>
                <div className="flex justify-between"><span className="text-ink-3">Preço mediano</span><span className="num">{brl(ai.market.price_median)}</span></div>
                {ai.market.limitations?.map((l: string) => <p key={l} className="text-[11px] text-ink-3">{l}</p>)}
              </div>
            )}
          </Card>
        </div>
      )}

      {final && (
        <Card title="Prévia e edição do anúncio" subtitle={locked ? "Somente leitura" : "Revise tudo antes de solicitar a publicação."}>
          <fieldset disabled={locked || !canOperate(user)} className="space-y-5">
            <Field label={<span className="flex justify-between"><span>Título</span><span className={cx("num", final.title.length > maxLen && "text-bad")}>{final.title.length}/{maxLen}</span></span>}>
              <Input value={final.title} maxLength={maxLen} onChange={(e) => setFinal({ ...final, title: e.target.value })} />
            </Field>
            {ai?.composition?.titulos_alternativos?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {ai.composition.titulos_alternativos.map((t: string) => <button type="button" key={t} onClick={() => setFinal({ ...final, title: t })} className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-brand/50">{t}</button>)}
              </div>
            )}
            {ai?.composition?.justificativa_titulo && <p className="text-[11px] text-ink-3">Por que este título: {ai.composition.justificativa_titulo}</p>}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Categoria" hint={ai?.category?.path}>
                <Select value={final.category_id} onChange={(e) => setFinal({ ...final, category_id: e.target.value })}>
                  <option value="">Selecione</option>
                  {(ai?.categories ?? []).map((c: any) => <option key={c.category_id} value={c.category_id}>{c.category_name} ({c.category_id})</option>)}
                  {final.category_id && !(ai?.categories ?? []).some((c: any) => c.category_id === final.category_id) && <option value={final.category_id}>{final.category_id}</option>}
                </Select>
              </Field>
              <Field label="Preço (R$)"><Input type="number" step="0.01" min="0" value={final.price} onChange={(e) => setFinal({ ...final, price: e.target.value })} /></Field>
              <Field label="Quantidade"><Input type="number" min="1" value={final.available_quantity} onChange={(e) => setFinal({ ...final, available_quantity: e.target.value })} /></Field>
              <Field label="Tipo de anúncio">
                <Select value={final.listing_type_id} onChange={(e) => setFinal({ ...final, listing_type_id: e.target.value })}>
                  <option value="gold_special">Clássico</option><option value="gold_pro">Premium</option>
                </Select>
              </Field>
              <Field label="SKU"><Input value={final.sku ?? ""} onChange={(e) => setFinal({ ...final, sku: e.target.value })} /></Field>
              <Field label="Condição"><Select value={final.condition} onChange={(e) => setFinal({ ...final, condition: e.target.value })}><option value="new">Novo</option><option value="used">Usado</option></Select></Field>
              <Field label="Garantia"><Input value={final.warranty_time ?? ""} placeholder="Ex.: 30 dias" onChange={(e) => setFinal({ ...final, warranty_type: e.target.value ? "Garantia do vendedor" : undefined, warranty_time: e.target.value || undefined })} /></Field>
              <Field label="Frete grátis">
                <Select value={final.free_shipping === undefined ? "" : String(final.free_shipping)} onChange={(e) => setFinal({ ...final, free_shipping: e.target.value === "" ? undefined : e.target.value === "true" })}>
                  <option value="">Padrão da conta</option><option value="true">Sim</option><option value="false">Não</option>
                </Select>
              </Field>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-ink-2">Ficha técnica {missingRequired.length > 0 && <Badge tone="bad">{missingRequired.length} obrigatório(s) sem valor</Badge>}</p>
              {meta.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[...meta].sort((a, b) => Number(b.required) - Number(a.required)).slice(0, 45).map((a) => (
                    <Field key={a.id} label={<span className="flex items-center gap-1">{a.name}{a.required && <span className="text-bad">*</span>}{toConfirm.get(a.id) === "a_confirmar" && <Badge tone="warn">confirmar</Badge>}{toConfirm.get(a.id) === "inferido" && <Badge tone="info">inferido</Badge>}</span>}>
                      {a.values?.length ? (
                        <Select value={attrVal(a.id)} onChange={(e) => setAttr(a.id, e.target.value)}>
                          <option value="">—</option>
                          {a.values.map((v: any) => <option key={v.id} value={v.name}>{v.name}</option>)}
                          {attrVal(a.id) && !a.values.some((v: any) => v.name === attrVal(a.id)) && <option value={attrVal(a.id)}>{attrVal(a.id)}</option>}
                        </Select>
                      ) : <Input value={attrVal(a.id)} onChange={(e) => setAttr(a.id, e.target.value)} placeholder={a.allowed_units?.length ? `ex.: 10 ${a.allowed_units[0]}` : ""} />}
                    </Field>
                  ))}
                </div>
              ) : (
                <div className="space-y-1">{(final.attributes ?? []).map((a: any) => <div key={a.id} className="text-xs"><b>{a.id}</b>: {a.value_name}</div>)}<p className="text-[11px] text-ink-3">Atributos oficiais da categoria aparecem quando o Mercado Livre está conectado.</p></div>
              )}
            </div>
            <Field label="Descrição"><Textarea value={final.description} onChange={(e) => setFinal({ ...final, description: e.target.value })} className="min-h-72 font-mono text-[12.5px]" /></Field>
            {ai?.composition?.palavras_chave?.length > 0 && <div className="flex flex-wrap gap-1">{ai.composition.palavras_chave.map((k: string) => <Badge key={k} tone="brand">{k}</Badge>)}</div>}
          </fieldset>

          {validation && (
            <div className={cx("mt-5 rounded-lg p-3 text-sm", validation.valid ? "bg-good-soft" : "bg-bad-soft")}>
              {validation.valid ? <span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-good" />O Mercado Livre validou o anúncio sem erros.</span> : (
                <><b>O Mercado Livre apontou problemas:</b><ul className="mt-1 list-disc pl-5 text-xs">{validation.errors.map((e: any, i: number) => <li key={i}>{e.message}{e.code ? ` (${e.code})` : ""}</li>)}</ul></>
              )}
            </div>
          )}
          <ErrorBox error={err} />
          {!locked && canOperate(user) && (
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
              {busy && <span className="mr-auto text-xs text-ink-3">{busy}</span>}
              <Button icon={<Sparkles className="size-4" />} loading={busy === "Regenerando com IA…"} onClick={() => run("Regenerando com IA…", async () => { await save(); await api(`/drafts/${id}/generate`, { body: {} }); await reload(); })}>Regenerar com IA</Button>
              <Button icon={<Save className="size-4" />} loading={busy === "Salvando…"} onClick={() => run("Salvando…", async () => { await save(); await reload(); toast("Rascunho salvo"); })}>Salvar rascunho</Button>
              <Button icon={<ShieldCheck className="size-4" />} loading={busy === "Validando no Mercado Livre…"} onClick={() => run("Validando no Mercado Livre…", async () => { await save(); setValidation(await api(`/drafts/${id}/validate`, { body: {} })); })}>Validar no ML</Button>
              <Button variant="primary" icon={<Send className="size-4" />} loading={busy === "Solicitando…"} onClick={() => run("Solicitando…", async () => {
                await save();
                const r = await api(`/drafts/${id}/request-publish`, { body: {} });
                await reload();
                if (isAdmin(user)) { setAuthorized(false); setPublishAction(r.action_id); } else toast("Publicação enviada para aprovação do administrador");
              })}>Publicar no Mercado Livre</Button>
            </div>
          )}
        </Card>
      )}

      <Modal open={publishAction !== null} onClose={() => setPublishAction(null)} title="Autorizar publicação"
        footer={<>
          <Button variant="ghost" onClick={() => { setPublishAction(null); toast("Publicação ficou pendente em Aprovações"); }}>Decidir depois</Button>
          <Button variant="primary" disabled={!authorized} loading={busy === "Publicando…"} onClick={() => run("Publicando…", async () => {
            await api(`/actions/${publishAction}/approve`, { body: { confirm: true } });
            setPublishAction(null); await reload(); toast("Anúncio publicado!");
          })}>Publicar agora</Button>
        </>}>
        <div className="space-y-3 text-sm">
          <p>O anúncio <b>"{final?.title}"</b> será enviado à sua loja por <b>{brl(Number(final?.price))}</b> com <b>{final?.available_quantity}</b> unidade(s).</p>
          {missingRequired.length > 0 && <Notice tone="warn">Há {missingRequired.length} atributo(s) obrigatório(s) sem valor. O Mercado Livre pode recusar a publicação.</Notice>}
          <label className="flex items-start gap-2 rounded-lg border border-line p-3">
            <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-0.5" />
            <span>Revisei as informações e <b>autorizo a publicação</b> deste anúncio na minha conta do Mercado Livre.</span>
          </label>
          <ErrorBox error={err} />
        </div>
      </Modal>
    </div>
  );
}

export default function Studio() {
  const [params, setParams] = useSearchParams();
  const drafts = useApi<any[]>("/drafts");
  const user = useUser();
  const sel = params.get("draft");
  const mode = sel ? Number(sel) : params.get("new") || !drafts.data?.length ? "new" : null;

  return (
    <>
      <PageHeader title="Central de criação de anúncios" subtitle="Envie a foto do produto e a IA prepara título, descrição, ficha técnica e preço. Nada é publicado sem sua autorização."
        actions={canOperate(user) && <Button variant="primary" icon={<ImagePlus className="size-4" />} onClick={() => setParams({ new: "1" })}>Novo produto</Button>} />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card title="Rascunhos e publicados" pad={false}>
          <div className="max-h-[70vh] overflow-y-auto p-2">
            {drafts.loading && !drafts.data && <Spinner />}
            {drafts.data?.length === 0 && <Empty title="Nenhum rascunho" />}
            {drafts.data?.map((d) => (
              <button key={d.id} onClick={() => setParams({ draft: String(d.id) })} className={cx("flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-2", Number(sel) === d.id && "bg-brand-soft")}>
                {d.images[0] ? <img src={img(d.images[0])} alt="" className="size-10 rounded-md border border-line object-cover" /> : <div className="size-10 rounded-md bg-surface-2" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{d.final?.title ?? d.input?.name ?? `Rascunho #${d.id}`}</div>
                  <Badge tone={DRAFT_STATUS[d.status]?.[1]} className="mt-0.5">{DRAFT_STATUS[d.status]?.[0]}</Badge>
                </div>
              </button>
            ))}
          </div>
        </Card>
        <div>
          {mode === "new" && canOperate(user) && <NewProduct onCreated={(id) => { drafts.reload(); setParams({ draft: String(id) }); }} />}
          {typeof mode === "number" && <Editor key={mode} id={mode} onDeleted={() => { drafts.reload(); setParams({}); }} />}
          {mode === null && <Card><Empty icon={<Sparkles className="size-5" />} title="Selecione um rascunho ou crie um novo produto" /></Card>}
        </div>
      </div>
    </>
  );
}
