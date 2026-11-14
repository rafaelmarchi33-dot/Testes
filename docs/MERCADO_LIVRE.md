# Conectando sua loja do Mercado Livre

## 1. Criar o aplicativo no DevCenter

1. Acesse <https://developers.mercadolivre.com.br/devcenter> com a conta da loja (ou uma conta de desenvolvedor da empresa).
2. **Criar aplicação**:
   - **URI de redirect**: `https://SEU_DOMINIO/api/ml/oauth/callback` (em desenvolvimento local o ML pode exigir HTTPS; use um túnel como ngrok/cloudflared e ajuste `ML_REDIRECT_URI` e `APP_URL`).
   - **PKCE**: pode ser habilitado — o sistema sempre envia `code_challenge` S256.
   - **Escopos**: leitura e escrita (`read`, `write`) e `offline_access` (necessário para o refresh token).
   - **Permissões (tópicos)**: Usuários, Itens/Publicações, Vendas/Pedidos, Envios, Perguntas e respostas, Métricas/Visitas e, se usar publicidade, **Publicidade (Product Ads)**.
   - **URL de notificações**: `https://SEU_DOMINIO/api/ml/notifications` com os tópicos `orders_v2`, `items`, `questions` e `shipments`.
3. Copie **App ID** e **Secret Key** para `ML_CLIENT_ID` e `ML_CLIENT_SECRET` no `server/.env`.

## 2. Conectar

Em **Integrações e ajustes → Conectar minha conta** (somente administradores). Você será levado ao Mercado Livre para autorizar. Ao voltar, a importação completa começa automaticamente:

- reputação e dados da conta;
- anúncios ativos, pausados, encerrados, inativos e em revisão (busca `scan`, sem limite de 1.000);
- pedidos dos últimos 12 meses, com envios e custo de frete do vendedor;
- perguntas;
- visitas (loja e principais anúncios);
- publicidade (quando disponível).

Depois disso, a sincronização é **incremental** (pedidos pela data de atualização) a cada `SYNC_INTERVAL_MINUTES` e em tempo real pelas notificações.

## 3. Endpoints oficiais utilizados

| Recurso | Endpoint |
|---|---|
| OAuth | `auth.mercadolivre.com.br/authorization`, `POST /oauth/token` |
| Conta / reputação | `/users/me`, `/users/{id}` |
| Anúncios | `/users/{id}/items/search?search_type=scan`, `/items?ids=` (multiget), `PUT /items/{id}` |
| Publicação | `POST /pictures/items/upload`, `POST /items/validate`, `POST /items`, `POST /items/{id}/description` |
| Categorias | `/sites/MLB/domain_discovery/search`, `/categories/{id}`, `/categories/{id}/attributes` |
| Tarifas | `/sites/MLB/listing_prices` |
| Pedidos | `/orders/search?seller=&order.date_last_updated.from=`, `/orders/{id}` |
| Envios | `/shipments/{id}` (`x-format-new`), `/shipments/{id}/costs` |
| Perguntas | `/questions/search?seller_id=&api_version=4`, `POST /answers` |
| Visitas | `/users/{id}/items_visits/time_window`, `/items/{id}/visits/time_window` |
| Mercado | `/sites/MLB/search`, `/products/search`, `/products/{id}/items`, `/reviews/item/{id}`, `/trends/MLB/{cat}` |
| Publicidade | `/advertising/advertisers?product_id=PADS`, `/advertising/{site}/advertisers/{id}/product_ads/campaigns/search`, `.../ads/search` |

## 4. Limitações conhecidas (exibidas na interface)

- **Busca pública** (`/sites/MLB/search`) pode estar restrita para alguns aplicativos. O sistema passa a usar a busca de catálogo e informa a limitação.
- **Quantidade vendida de concorrentes** nem sempre é exposta pela API; quando ausente, a demanda **não** é estimada como se fosse dado real.
- **Publicidade** exige Product Ads ativo e permissão específica; sem isso, o módulo mostra "indisponível" com o motivo retornado.
- **Mensagens pós-venda** não fazem parte desta versão (a central cobre as perguntas pré-venda).
- O formato das respostas de Product Ads muda com frequência; se a sincronização de publicidade falhar, a mensagem do ML aparece em Integrações → Sincronização.

## 5. Limites de requisição

O cliente HTTP limita a concorrência (`ML_MAX_CONCURRENCY`, padrão 4) e o intervalo entre chamadas (`ML_MIN_INTERVAL_MS`, padrão 120 ms), respeita `Retry-After` em respostas 429 e aplica backoff exponencial em erros 5xx e de rede. Escritas (POST/PUT) não são repetidas automaticamente para evitar duplicidade.
