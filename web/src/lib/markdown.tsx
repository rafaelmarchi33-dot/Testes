import type { ReactNode } from "react";

/** Renderizador Markdown mínimo e seguro (sem HTML bruto): títulos, listas, negrito, itálico, código e tabelas simples. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={`${key}-${i++}`} className="rounded bg-surface-2 px-1 text-[0.9em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const k = `b${i}`;
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)/.exec(line);
    if (h) { const L = h[1]!.length; blocks.push(L <= 2 ? <h2 key={k}>{inline(h[2]!, k)}</h2> : <h3 key={k}>{inline(h[2]!, k)}</h3>); i++; continue; }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i]!)) { items.push(<li key={i}>{inline(lines[i]!.replace(/^\s*[-*•]\s+/, ""), `l${i}`)}</li>); i++; }
      blocks.push(<ul key={k}>{items}</ul>); continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) { items.push(<li key={i}>{inline(lines[i]!.replace(/^\s*\d+[.)]\s+/, ""), `o${i}`)}</li>); i++; }
      blocks.push(<ol key={k}>{items}</ol>); continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i]!)) rows.push(lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      blocks.push(
        <div key={k} className="overflow-x-auto"><table><tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => ri === 0 ? <th key={ci}>{inline(c, `t${ri}${ci}`)}</th> : <td key={ci}>{inline(c, `t${ri}${ci}`)}</td>)}</tr>)}</tbody></table></div>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i]!)) { para.push(lines[i]!); i++; }
    blocks.push(<p key={k}>{inline(para.join(" "), k)}</p>);
  }
  return <div className="prose-ai text-sm leading-relaxed">{blocks}</div>;
}
