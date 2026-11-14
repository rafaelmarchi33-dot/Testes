const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat("pt-BR");

export const brl = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : brlFmt.format(n));
export const brlShort = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Math.abs(n) >= 10_000 ? brlCompact.format(n) : brlFmt.format(n));
export const int = (n: number | null | undefined) => (n === null || n === undefined ? "—" : intFmt.format(n));
export const pct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`);
export const ratioPct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : pct(n * 100));

export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
export const dayShort = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function relative(iso: string | null | undefined) {
  if (!iso) return "nunca";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

export const ORDER_STATUS: Record<string, string> = {
  paid: "Pago", confirmed: "Confirmado", payment_required: "Aguardando pagamento", payment_in_process: "Pagamento em processo",
  partially_paid: "Parcialmente pago", cancelled: "Cancelado", invalid: "Inválido",
};
export const SHIP_STATUS: Record<string, string> = {
  pending: "Pendente", handling: "Em preparação", ready_to_ship: "Pronto para envio", shipped: "Enviado",
  delivered: "Entregue", not_delivered: "Não entregue", cancelled: "Cancelado", to_be_agreed: "A combinar",
};
export const LISTING_STATUS: Record<string, string> = {
  active: "Ativo", paused: "Pausado", closed: "Encerrado", under_review: "Em revisão", inactive: "Inativo", payment_required: "Pagamento pendente",
};
export const LISTING_TYPE: Record<string, string> = { gold_special: "Clássico", gold_pro: "Premium", free: "Grátis", gold_premium: "Diamante" };
