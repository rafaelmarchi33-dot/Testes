import { useState } from "react";
import { CheckCheck, Bot, User as UserIcon, Check, X } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, PageHeader, Spinner, ErrorBox, Empty, Tabs, Button, Badge, Modal, Textarea, Notice, useToast } from "../components/ui.tsx";
import { brl, dateTime } from "../lib/format.ts";
import { useUser, isAdmin } from "../components/Layout.tsx";

const STATUS: Record<string, [string, any]> = {
  pending: ["Pendente", "warn"], approved: ["Aprovada", "info"], executed: ["Executada", "good"], failed: ["Falhou", "bad"], rejected: ["Rejeitada", "neutral"],
};
const TYPE: Record<string, string> = {
  publish_listing: "Publicar anúncio", update_price: "Alterar preço", update_status: "Status do anúncio", update_ml_stock: "Estoque no ML",
  stock_adjust: "Estoque interno", answer_question: "Responder comprador", ads_recommendation: "Publicidade",
};

function Payload({ a }: { a: any }) {
  const p = a.payload;
  switch (a.type) {
    case "update_price": return <span className="num">{p.current_price ? <>{brl(p.current_price)} → </> : null}<b>{brl(p.price)}</b>{p.current_price ? <span className={p.price >= p.current_price ? "text-good" : "text-bad"}> ({(((p.price - p.current_price) / p.current_price) * 100).toFixed(1)}%)</span> : null}</span>;
    case "answer_question": return <span className="italic">"{p.text}"</span>;
    case "stock_adjust": return <span>{p.type} {p.qty} un. {p.reason ? `· ${p.reason}` : ""}</span>;
    default: return null;
  }
}

export default function Approvals() {
  const user = useUser();
  const [status, setStatus] = useState("pending");
  const { data, error, loading, reload } = useApi<any[]>(`/actions?status=${status}`);
  const [approve, setApprove] = useState<any>(null);
  const [reject, setReject] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const { toast, node } = useToast();
  return (
    <>
      {node}
      <PageHeader title="Central de aprovações" subtitle="Toda operação que altera sua loja ou estoque fica aqui até você aprovar. Histórico completo de decisões."
        actions={<Tabs value={status} onChange={setStatus} items={[{ value: "pending", label: "Pendentes" }, { value: "executed", label: "Executadas" }, { value: "failed", label: "Falhas" }, { value: "rejected", label: "Rejeitadas" }, { value: "all", label: "Todas" }]} />} />
      {!isAdmin(user) && <div className="mb-4"><Notice>Apenas administradores podem aprovar ou rejeitar ações.</Notice></div>}
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : !data?.length ? <Card><Empty icon={<CheckCheck className="size-5" />} title="Nada por aqui" /></Card> : (
        <div className="space-y-2">
          {data.map((a) => (
            <Card key={a.id} pad>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{TYPE[a.type] ?? a.type}</Badge>
                    <Badge tone={STATUS[a.status]?.[1]}>{STATUS[a.status]?.[0]}</Badge>
                    <span className="flex items-center gap-1 text-[11px] text-ink-3">{a.source === "ai" ? <><Bot className="size-3" />sugerido pela IA</> : <><UserIcon className="size-3" />{a.created_by_name ?? "sistema"}</>} · {dateTime(a.created_at)}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium">{a.title}</p>
                  <div className="text-sm text-ink-2"><Payload a={a} /></div>
                  {a.rationale && <p className="mt-1.5 whitespace-pre-line rounded-lg bg-surface-2 p-2.5 text-xs text-ink-2">{a.rationale}</p>}
                  {a.decided_at && <p className="mt-1.5 text-[11px] text-ink-3">Decidido por {a.decided_by_name ?? "—"} em {dateTime(a.decided_at)}{a.executed_at ? ` · executado em ${dateTime(a.executed_at)}` : ""}</p>}
                  {a.error && <p className="mt-1 text-xs text-bad">{a.error}</p>}
                  {a.result?.permalink && <a href={a.result.permalink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand hover:underline">Abrir anúncio publicado ({a.result.item_id}) →</a>}
                  {a.result?.note && <p className="mt-1 text-xs text-ink-2">{a.result.note}</p>}
                </div>
                {a.status === "pending" && isAdmin(user) && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => { setReason(""); setReject(a); }}>Rejeitar</Button>
                    <Button size="sm" variant="success" icon={<Check className="size-3.5" />} onClick={() => { setErr(null); setApprove(a); }}>Aprovar</Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!approve} onClose={() => setApprove(null)} title="Confirmar aprovação"
        footer={<><Button variant="ghost" onClick={() => setApprove(null)}>Cancelar</Button><Button variant="success" loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await api(`/actions/${approve.id}/approve`, { body: { confirm: true } }); setApprove(null); toast("Ação executada"); reload(); } catch (e) { setErr(e as Error); reload(); } finally { setBusy(false); }
        }}>Aprovar e executar</Button></>}>
        {approve && <div className="space-y-3 text-sm"><p><b>{approve.title}</b></p><p className="text-ink-2">Ao aprovar, a operação é executada imediatamente{approve.type !== "stock_adjust" && approve.type !== "ads_recommendation" ? " na sua conta do Mercado Livre" : ""} e registrada no histórico de auditoria.</p><ErrorBox error={err} /></div>}
      </Modal>
      <Modal open={!!reject} onClose={() => setReject(null)} title="Rejeitar ação"
        footer={<><Button variant="ghost" onClick={() => setReject(null)}>Cancelar</Button><Button variant="danger" onClick={async () => { await api(`/actions/${reject.id}/reject`, { body: { reason: reason || undefined } }); setReject(null); reload(); }}>Rejeitar</Button></>}>
        <Textarea placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}
