import { useState } from "react";
import { MessageCircleQuestion, Sparkles, Send } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, PageHeader, Spinner, ErrorBox, Empty, Tabs, Thumb, Textarea, Button, Badge, Notice, useToast } from "../components/ui.tsx";
import { dateTime, relative } from "../lib/format.ts";
import { useUser, canOperate } from "../components/Layout.tsx";

function QuestionCard({ q, onDone }: { q: any; onDone: () => void }) {
  const user = useUser();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const { toast, node } = useToast();
  return (
    <Card>
      {node}
      <div className="flex gap-3">
        <Thumb src={q.thumbnail} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-ink-3">{q.title ?? q.listing_id}</div>
          <p className="mt-1 text-sm font-medium">{q.text}</p>
          <div className="mt-1 text-[11px] text-ink-3">{dateTime(q.date_created)} · {relative(q.date_created)}</div>
          {q.answer_text && <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm"><span className="text-[11px] text-ink-3">Resposta · {dateTime(q.answer_date)}</span><p>{q.answer_text}</p></div>}
          {q.status === "UNANSWERED" && canOperate(user) && (
            <div className="mt-3 space-y-2">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Escreva a resposta ou peça uma sugestão à IA" className="min-h-20" />
              <ErrorBox error={err} />
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" icon={<Sparkles className="size-3.5" />} loading={busy === "ai"} onClick={async () => {
                  setBusy("ai"); setErr(null);
                  try { setText((await api(`/questions/${q.id}/suggest`, { body: {} })).suggestion); } catch (e) { setErr(e as Error); } finally { setBusy(null); }
                }}>Sugerir com IA</Button>
                <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} disabled={text.trim().length < 2} loading={busy === "send"} onClick={async () => {
                  setBusy("send"); setErr(null);
                  try { await api("/actions", { body: { type: "answer_question", payload: { question_id: q.id, text } } }); toast("Resposta enviada para aprovação"); onDone(); } catch (e) { setErr(e as Error); } finally { setBusy(null); }
                }}>Enviar para aprovação</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Questions() {
  const [status, setStatus] = useState("UNANSWERED");
  const { data, error, loading, reload } = useApi<any[]>(`/questions?status=${status}`);
  return (
    <>
      <PageHeader title="Perguntas dos compradores" subtitle="Responder rápido aumenta a conversão. Respostas em seu nome só são enviadas após aprovação."
        actions={<Tabs value={status} onChange={setStatus} items={[{ value: "UNANSWERED", label: "Sem resposta" }, { value: "ANSWERED", label: "Respondidas" }, { value: "all", label: "Todas" }]} />} />
      <div className="mb-4"><Notice>As mensagens pós-venda dos compradores ficam no Mercado Livre; esta central cobre as perguntas dos anúncios (pré-venda).</Notice></div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : !data?.length ? <Card><Empty icon={<MessageCircleQuestion className="size-5" />} title="Nenhuma pergunta aqui" /></Card> : (
        <div className="space-y-3">
          {status === "UNANSWERED" && <Badge tone="warn">{data.length} aguardando resposta</Badge>}
          {data.map((q) => <QuestionCard key={q.id} q={q} onDone={reload} />)}
        </div>
      )}
    </>
  );
}
