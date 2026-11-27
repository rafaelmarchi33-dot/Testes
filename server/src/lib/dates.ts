/** Utilitários de período. Fuso padrão da loja: America/Sao_Paulo (UTC-3, sem horário de verão desde 2019). */
export const TZ_OFFSET_MIN = Number(process.env.STORE_TZ_OFFSET_MIN ?? -180);

/** Converte um instante em data local da loja (YYYY-MM-DD). */
export function localDate(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d) : d;
  return new Date(t.getTime() + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Início do dia local como instante UTC ISO. */
export function localDayStartUtc(day: string): string {
  return new Date(Date.parse(day + "T00:00:00.000Z") - TZ_OFFSET_MIN * 60_000).toISOString();
}

export function addDays(day: string, n: number): string {
  const d = new Date(day + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface Range {
  from: string;
  to: string;
  fromUtc: string;
  toUtc: string;
  days: number;
}

function build(from: string, to: string): Range {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return { from, to, fromUtc: localDayStartUtc(from), toUtc: localDayStartUtc(addDays(to, 1)), days };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Intervalo [from, to] em dias locais (inclusive) e limites UTC [fromUtc, toUtc). */
export function resolvePeriod(period: string, customFrom?: string, customTo?: string, now = new Date()): Range {
  const today = localDate(now);
  switch (period) {
    case "today":
      return build(today, today);
    case "yesterday":
      return build(addDays(today, -1), addDays(today, -1));
    case "7d":
      return build(addDays(today, -6), today);
    case "90d":
      return build(addDays(today, -89), today);
    case "month":
      return build(today.slice(0, 8) + "01", today);
    case "custom": {
      if (!customFrom || !customTo || !DAY_RE.test(customFrom) || !DAY_RE.test(customTo)) {
        throw new Error("Período personalizado requer 'from' e 'to' no formato AAAA-MM-DD");
      }
      const [a, b] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
      if ((Date.parse(b) - Date.parse(a)) / 86_400_000 > 730) throw new Error("Período máximo: 2 anos");
      return build(a, b);
    }
    case "30d":
    default:
      return build(addDays(today, -29), today);
  }
}

/** Período de comparação: para "month", o mesmo intervalo de dias do mês anterior; nos demais, o período imediatamente anterior. */
export function comparisonRange(period: string, r: Range): Range {
  if (period === "month") {
    const [y, m] = [Number(r.from.slice(0, 4)), Number(r.from.slice(5, 7))];
    const prevStart = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    const prevEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
    const end = addDays(prevStart, r.days - 1);
    return build(prevStart, end < prevEnd ? end : prevEnd);
  }
  return previousRange(r);
}

/** Período imediatamente anterior, de mesma duração. */
export function previousRange(r: Range): Range {
  const to = addDays(r.from, -1);
  return build(addDays(to, -(r.days - 1)), to);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
