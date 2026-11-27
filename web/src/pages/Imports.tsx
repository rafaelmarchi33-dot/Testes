import { useRef, useState } from "react";
import { Link } from "react-router";
import { FileUp, Undo2, CheckCircle2, AlertTriangle, FileSpreadsheet, FileText } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { useUser, isAdmin, canOperate } from "../components/Layout.tsx";
import { Card, PageHeader, Button, Select, Field, Input, ErrorBox, Spinner, Badge, Table, Pending, ConfirmDialog, useToast, Notice, cx } from "../components/ui.tsx";
import { dateTime, int } from "../lib/format.ts";

const ST: Record<string, [string, any]> = { preview: ["Prévia", "neutral"], imported: ["Importado", "good"], undone: ["Desfeito", "warn"], failed: ["Falhou", "bad"] };

export default function Imports() {
  const user = useUser();
  const kinds = useApi<any[]>("/imports/kinds");
  const hist = useApi<any[]>("/imports");
  const [kind, setKind] = useState("auto");
  const [prev, setPrev] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [pdfVals, setPdfVals] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [undo, setUndo] = useState<any>(null);
  const [discard, setDiscard] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast, node } = useToast();

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file); fd.append("kind", kind);
    setBusy("upload"); setErr(null);
    try { const p = await api("/imports", { form: fd }); setPrev(p); setMapping(p.mapping); setPdfVals(p.file_type === "pdf" ? { ...(p.rows[0]?.values ?? {}) } : {}); hist.reload(); }
    catch (e) { setErr(e as Error); } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  };
  const repreview = async (k = prev.kind, m = mapping) => {
    setBusy("preview"); setErr(null);
    try { const p = await api(`/imports/${prev.import_id}/preview`, { body: { kind: k, mapping: k === prev.kind ? m : undefined } }); setPrev(p); setMapping(p.mapping); } catch (e) { setErr(e as Error); } finally { setBusy(null); }
  };
  return (
    <>
      {node}
      <PageHeader title="Central de importação" subtitle="CSV, XLSX e PDF (inclusive relatórios exportados do Mercado Livre): mapeamento automático, validação, prévia, histórico e desfazer" actions={<Link to="/relatorios"><Button>Exportar relatórios</Button></Link>} />
      {canOperate(user) && (
        <Card title="Novo arquivo">
          <div className="grid gap-3 sm:grid-cols-[260px_1fr_auto] sm:items-end">
            <Field label="Tipo de dado"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="auto">Detectar automaticamente</option>{(kinds.data ?? []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select></Field>
            <p className="text-xs text-ink-3">{(kinds.data ?? []).find((k) => k.key === kind)?.description ?? "O sistema identifica as colunas pelos nomes dos cabeçalhos, inclusive com linhas de título acima da tabela."}</p>
            <><input ref={fileRef} type="file" hidden accept=".csv,.txt,.xlsx,.pdf" onChange={(e) => upload(e.target.files?.[0])} /><Button variant="primary" loading={busy === "upload"} icon={<FileUp className="size-4" />} onClick={() => fileRef.current?.click()}>Enviar arquivo</Button></>
          </div>
          <ErrorBox error={err} />
        </Card>
      )}

      {prev && (
        <Card className="mt-4" title={<span className="flex items-center gap-2">{prev.file_type === "pdf" ? <FileText className="size-4" /> : <FileSpreadsheet className="size-4" />} Prévia da importação #{prev.import_id}</span>}
          action={<div className="flex items-center gap-2"><Select className="h-8 w-48 text-xs" value={prev.kind} disabled={prev.file_type === "pdf"} onChange={(e) => repreview(e.target.value)}>{(kinds.data ?? []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select></div>}>
          {prev.pdf_note && <Notice>{prev.pdf_note}</Notice>}
          <div className="my-3 flex flex-wrap gap-2 text-xs">
            <Badge>{int(prev.totals.rows)} linhas</Badge><Badge tone="good">{int(prev.totals.valid)} válidas</Badge>
            {prev.totals.with_errors > 0 && <Badge tone="bad">{int(prev.totals.with_errors)} com erro (serão ignoradas)</Badge>}
            {prev.totals.duplicates > 0 && <Badge tone="warn">{int(prev.totals.duplicates)} duplicadas</Badge>}
            {prev.totals.warnings > 0 && <Badge tone="info">{int(prev.totals.warnings)} com aviso</Badge>}
          </div>
          {prev.file_type !== "pdf" ? (
            <div className="mb-4">
              <div className="mb-2 text-xs font-semibold">Mapeamento de colunas {prev.missing_required.length > 0 && <span className="text-bad">— obrigatórios sem coluna: {prev.missing_required.join(", ")}</span>}</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {prev.fields.map((f: any) => (
                  <Field key={f.key} label={<>{f.label}{f.required && <span className="text-bad"> *</span>}</>}>
                    <Select value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === "" ? null : Number(e.target.value) })} className={cx(mapping[f.key] == null && f.required && "border-bad")}>
                      <option value="">— não importar —</option>{prev.headers.map((h: string, i: number) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                    </Select>
                  </Field>
                ))}
              </div>
              <Button size="sm" className="mt-2" loading={busy === "preview"} onClick={() => repreview()}>Aplicar mapeamento</Button>
            </div>
          ) : (
            <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {prev.fields.map((f: any) => <Field key={f.key} label={f.label}><Input value={pdfVals[f.key] ?? ""} onChange={(e) => setPdfVals({ ...pdfVals, [f.key]: e.target.value === "" ? null : f.type === "date" || f.type === "text" ? e.target.value : Number(e.target.value.replace(",", ".")) })} placeholder={f.type === "date" ? "AAAA-MM-DD" : ""} /></Field>)}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-line text-left text-ink-3"><th className="px-2 py-1.5">Linha</th>{prev.fields.map((f: any) => <th key={f.key} className="whitespace-nowrap px-2 py-1.5">{f.label}</th>)}<th className="px-2 py-1.5">Validação</th></tr></thead>
              <tbody>{prev.rows.map((r: any) => (
                <tr key={r.row} className={cx("border-b border-line/50", r.errors.length && "bg-bad-soft/50")}>
                  <td className="px-2 py-1.5 text-ink-3">{r.row}</td>
                  {prev.fields.map((f: any) => <td key={f.key} className="max-w-[160px] truncate px-2 py-1.5">{r.values[f.key] === null || r.values[f.key] === undefined ? <span className="text-ink-3">—</span> : String(r.values[f.key])}</td>)}
                  <td className="px-2 py-1.5">{r.errors.length ? <span className="text-bad">{r.errors.join("; ")}</span> : r.warnings.length ? <span className="text-warn">{r.warnings.join("; ")}</span> : <CheckCircle2 className="size-3.5 text-good" />}</td>
                </tr>))}</tbody>
            </table>
            {prev.totals.rows > prev.rows.length && <p className="mt-1 text-[11px] text-ink-3">Mostrando {prev.rows.length} de {prev.totals.rows} linhas.</p>}
          </div>
          <div className="mt-4 flex gap-2"><Button variant="primary" disabled={!prev.totals.valid && prev.file_type !== "pdf"} onClick={() => setConfirm(true)}>Importar {prev.file_type === "pdf" ? "relatório" : `${int(prev.totals.valid)} linha(s) válida(s)`}</Button><Button variant="ghost" onClick={() => setPrev(null)}>Descartar prévia</Button></div>
        </Card>
      )}

      <Card className="mt-4" title="Histórico de importações">
        {hist.loading && !hist.data ? <Spinner /> : (
          <Table rows={hist.data ?? []} rowKey={(r: any) => r.id} empty={<Pending title="Nenhuma importação" />} cols={[
            { key: "id", header: "#", render: (r: any) => r.id },
            { key: "f", header: "Arquivo", render: (r: any) => <span className="max-w-[240px] truncate">{r.original_name}</span> },
            { key: "k", header: "Tipo", render: (r: any) => (kinds.data ?? []).find((k) => k.key === r.kind)?.label ?? r.kind },
            { key: "s", header: "Status", render: (r: any) => <Badge tone={ST[r.status]![1]}>{ST[r.status]![0]}</Badge> },
            { key: "n", header: "Linhas", align: "right", render: (r: any) => `${int(r.rows_imported)} / ${int(r.rows_total)}` },
            { key: "d", header: "Data", render: (r: any) => dateTime(r.imported_at ?? r.created_at) },
            { key: "u", header: "Usuário", render: (r: any) => r.user_name ?? "—" },
            { key: "x", header: "", render: (r: any) => r.status === "imported" && isAdmin(user) ? <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => setUndo(r)}>Desfazer</Button>
              : r.status === "preview" && canOperate(user) && prev?.import_id !== r.id ? <Button size="sm" variant="ghost" onClick={() => setDiscard(r)}>Descartar prévia</Button> : null },
          ]} />
        )}
      </Card>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Confirmar importação" confirmLabel="Importar"
        onConfirm={async () => { const r = await api(`/imports/${prev.import_id}/commit`, { body: { kind: prev.kind, mapping, confirm: true, values: prev.file_type === "pdf" ? pdfVals : undefined } }); toast(`${r.imported} linha(s) importada(s), ${r.skipped} ignorada(s)`); setPrev(null); hist.reload(); }}>
        Os dados válidos serão gravados e identificados como importados (é possível desfazer depois). Linhas com erro são ignoradas.
      </ConfirmDialog>
      <ConfirmDialog open={!!discard} onClose={() => setDiscard(null)} title="Descartar prévia" confirmLabel="Descartar"
        onConfirm={async () => { await api(`/imports/${discard.id}`, { method: "DELETE", body: { confirm: true } }); toast("Prévia descartada"); hist.reload(); }}>
        Remover a prévia #{discard?.id} ({discard?.original_name}) do histórico? Ela nunca foi importada; nenhum número muda.
      </ConfirmDialog>
      <ConfirmDialog open={!!undo} onClose={() => setUndo(null)} danger title="Desfazer importação" confirmLabel="Desfazer"
        onConfirm={async () => { const r = await api(`/imports/${undo.id}/undo`, { body: { confirm: true } }); toast(`Removidos: ${Object.entries(r.removed).filter(([, v]) => (v as number) > 0).map(([k, v]) => `${v} ${k}`).join(", ") || "nada"}`); hist.reload(); }}>
        <div className="flex gap-2"><AlertTriangle className="size-4 shrink-0 text-warn" />Remover todos os registros criados pela importação #{undo?.id} ({undo?.original_name}) e restaurar valores atualizados?</div>
      </ConfirmDialog>
    </>
  );
}
