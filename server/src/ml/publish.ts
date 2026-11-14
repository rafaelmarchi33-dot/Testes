import fs from "node:fs";
import path from "node:path";
import { q, json } from "../db/index.ts";
import { config } from "../config.ts";
import { ml, MLApiError } from "./client.ts";
import { HttpError } from "../lib/errors.ts";
import { upsertListing } from "./sync.ts";
import { requireAccount } from "./client.ts";

export interface DraftFinal {
  title: string;
  category_id: string;
  price: number;
  available_quantity: number;
  listing_type_id: string;
  condition: "new" | "used";
  description: string;
  sku?: string;
  family_name?: string;
  attributes: { id: string; value_name?: string; value_id?: string }[];
  free_shipping?: boolean;
  warranty_type?: string;
  warranty_time?: string;
  image_order?: string[];
}

const mimeOf = (f: string) => ({ ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" })[path.extname(f).toLowerCase()] ?? "image/jpeg";

/** Envia uma imagem local para o Mercado Livre e retorna o ID da imagem. */
export async function uploadPicture(file: string): Promise<string> {
  const abs = path.join(config.dataDir, "uploads", path.basename(file));
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(abs)], { type: mimeOf(abs) }), path.basename(abs));
  const r = await ml<{ id: string }>("/pictures/items/upload", { method: "POST", form, retries: 2 });
  return r.id;
}

export function buildItemBody(final: DraftFinal, pictureIds: string[]) {
  const attributes = final.attributes.filter((a) => a.id && (a.value_name || a.value_id)).map((a) => (a.value_id ? { id: a.id, value_id: a.value_id } : { id: a.id, value_name: a.value_name }));
  if (final.sku && !attributes.some((a) => a.id === "SELLER_SKU")) attributes.push({ id: "SELLER_SKU", value_name: final.sku });
  const saleTerms = [];
  if (final.warranty_type) saleTerms.push({ id: "WARRANTY_TYPE", value_name: final.warranty_type });
  if (final.warranty_time) saleTerms.push({ id: "WARRANTY_TIME", value_name: final.warranty_time });
  const body: Record<string, unknown> = {
    title: final.title,
    category_id: final.category_id,
    price: final.price,
    currency_id: "BRL",
    available_quantity: final.available_quantity,
    buying_mode: "buy_it_now",
    condition: final.condition,
    listing_type_id: final.listing_type_id,
    pictures: pictureIds.map((id) => ({ id })),
    attributes,
  };
  if (saleTerms.length) body.sale_terms = saleTerms;
  if (final.family_name) body.family_name = final.family_name;
  if (final.free_shipping !== undefined) body.shipping = { mode: "me2", free_shipping: final.free_shipping };
  return body;
}

function loadDraft(id: number) {
  const d = q.get<any>("SELECT * FROM listing_drafts WHERE id=?", [id]);
  if (!d) throw new HttpError(404, "Rascunho não encontrado");
  const final = json.parse<DraftFinal | null>(d.final, null);
  if (!final) throw new HttpError(400, "O rascunho ainda não possui conteúdo final. Gere ou edite o anúncio primeiro.");
  const images = json.parse<string[]>(d.images, []);
  return { d, final, images };
}

function checkDraft(final: DraftFinal, images: string[]) {
  const problems: string[] = [];
  if (!final.title || final.title.length < 10) problems.push("Título muito curto");
  if (!final.category_id) problems.push("Categoria não definida");
  if (!(final.price > 0)) problems.push("Preço inválido");
  if (!(final.available_quantity >= 1)) problems.push("Quantidade disponível deve ser ao menos 1");
  if (!images.length) problems.push("É necessária ao menos uma imagem");
  if (problems.length) throw new HttpError(400, `Rascunho incompleto: ${problems.join("; ")}`, "draft_invalid", problems);
}

/** Valida o anúncio na API do ML (POST /items/validate) sem publicar. */
export async function validateDraft(id: number) {
  const { final, images } = loadDraft(id);
  checkDraft(final, images);
  // As imagens são enviadas ao ML (ficam privadas até serem usadas em um anúncio).
  const pics = await Promise.all(images.map(uploadPicture));
  try {
    await ml("/items/validate", { method: "POST", body: buildItemBody(final, pics) });
    return { valid: true, errors: [] };
  } catch (e) {
    if (e instanceof MLApiError && e.mlStatus === 400) {
      const causes = ((e.body as any)?.cause ?? []).map((c: any) => ({ code: c.code, message: c.message, type: c.type }));
      return { valid: false, errors: causes.length ? causes : [{ message: e.message }] };
    }
    throw e;
  }
}

/** Publica o rascunho. Só é chamado pelo executor de ações aprovadas. */
export async function publishDraft(id: number) {
  const acc = requireAccount();
  const { d, final, images } = loadDraft(id);
  if (d.status === "published") throw new HttpError(409, "Este rascunho já foi publicado");
  checkDraft(final, images);
  q.run("UPDATE listing_drafts SET status='publishing', error=NULL, updated_at=? WHERE id=?", [new Date().toISOString(), id]);
  try {
    const ordered = final.image_order?.length ? final.image_order.filter((f) => images.includes(f)) : images;
    const pics = [];
    for (const img of ordered) pics.push(await uploadPicture(img));
    const item = await ml<any>("/items", { method: "POST", body: buildItemBody(final, pics), retries: 0 });
    let descriptionError: string | null = null;
    try {
      await ml(`/items/${item.id}/description`, { method: "POST", body: { plain_text: final.description } });
    } catch (e) {
      descriptionError = (e as Error).message;
    }
    upsertListing(item, acc.id);
    if (d.product_id) q.run("UPDATE listings SET product_id=? WHERE id=?", [d.product_id, item.id]);
    q.run("UPDATE listing_drafts SET status='published', ml_item_id=?, permalink=?, ml_status=?, error=?, updated_at=? WHERE id=?", [
      item.id, item.permalink, item.status, descriptionError ? `Anúncio publicado, mas a descrição falhou: ${descriptionError}` : null, new Date().toISOString(), id,
    ]);
    return { item_id: item.id, permalink: item.permalink, status: item.status, description_error: descriptionError };
  } catch (e) {
    q.run("UPDATE listing_drafts SET status='failed', error=?, updated_at=? WHERE id=?", [(e as Error).message, new Date().toISOString(), id]);
    throw e;
  }
}

/** Atributos da categoria (obrigatórios e recomendados) para a ficha técnica. */
export async function categoryAttributes(categoryId: string) {
  const attrs = await ml<any[]>(`/categories/${categoryId}/attributes`);
  return attrs
    .filter((a) => !a.tags?.read_only && !a.tags?.hidden)
    .map((a) => ({
      id: a.id,
      name: a.name,
      value_type: a.value_type,
      required: !!(a.tags?.required || a.tags?.catalog_required || a.tags?.conditional_required),
      values: (a.values ?? []).slice(0, 50).map((v: any) => ({ id: v.id, name: v.name })),
      allowed_units: (a.allowed_units ?? []).map((u: any) => u.name),
      hint: a.hint ?? a.tooltip ?? null,
    }));
}

/** Preditor oficial de categoria a partir do título. */
export async function predictCategory(title: string) {
  const r = await ml<any[]>(`/sites/${config.ml.siteId}/domain_discovery/search?limit=5&q=${encodeURIComponent(title)}`);
  return r.map((x) => ({ category_id: x.category_id, category_name: x.category_name, domain_id: x.domain_id, domain_name: x.domain_name }));
}

export async function categoryInfo(categoryId: string) {
  const c = await ml<any>(`/categories/${categoryId}`);
  return {
    id: c.id,
    name: c.name,
    path: (c.path_from_root ?? []).map((p: any) => p.name).join(" > "),
    max_title_length: c.settings?.max_title_length ?? 60,
    listing_allowed: c.settings?.listing_allowed ?? true,
  };
}
