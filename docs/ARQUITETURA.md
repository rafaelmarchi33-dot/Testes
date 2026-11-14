# Arquitetura e documentação técnica

## Visão geral

```
web/ (React 19 + Vite + Tailwind 4 + Recharts)         server/ (Node 22 + TypeScript + Express 5)
 ├─ páginas por módulo                                  ├─ auth/        sessões, papéis, CSRF, usuários
 ├─ lib/api.ts  → /api (cookie HttpOnly, sem tokens)    ├─ ml/          client (taxa, retry, refresh), oauth, sync, ads, publish
 └─ build servido pelo backend em produção              ├─ ai/          Claude: gerente, relatório diário, anúncios (visão)
                                                        ├─ services/    métricas, financeiro, estoque, alertas, aprovações,
                                                        │               mercado, relatórios (xlsx/pdf), backup, agendador
                                                        ├─ db/          SQLite (node:sqlite, WAL) + migrações versionadas
                                                        └─ test/        node:test
```

**Por que SQLite?** Uma loja tem volume que cabe com folga em SQLite com WAL; não há serviço extra para operar e o backup é um arquivo. Toda a camada de dados usa SQL padrão via `q.all/get/run/tx`; migrar para PostgreSQL exige trocar `db/index.ts` e ajustar poucas funções de data (`datetime`, `json_extract`).

## Fluxo de dados

1. **OAuth** (`ml/oauth.ts`): `state` + PKCE S256 guardados no banco (verifier criptografado), troca de código, tokens salvos com AES-256-GCM.
2. **Cliente** (`ml/client.ts`): renova o token 5 min antes de expirar (e após 401), com trava para o refresh de uso único; limita concorrência; repete GET em 429/5xx/rede; registra cada chamada em `api_logs` sem segredos. Conta revogada → status `needs_reauth` + alerta crítico.
3. **Sincronização** (`ml/sync.ts`): por recurso, com trava (`sync_state`) e cursor. Pedidos são incrementais por `date_last_updated` com sobreposição de 10 min. Upserts são idempotentes, então webhook + agendamento nunca duplicam.
4. **Produtos internos**: cada anúncio é vinculado a um produto (por SKU ou criado automaticamente com saldo inicial). Custos e estoque vivem no produto; vários anúncios podem apontar para o mesmo produto.
5. **Estoque**: `applyOrderStock` baixa em `paid` e estorna em `cancelled`, com índice único `(produto, tipo, ref)` garantindo idempotência.
6. **Métricas** (`services/metrics.ts`): datas no fuso da loja (UTC−3, configurável por `STORE_TZ_OFFSET_MIN`). Lucro = receita − tarifa real (`sale_fee`) − frete real rateado − custo de produção − impostos − ads. Sem ficha de custos, o lucro fica `null` e a cobertura é mostrada.
7. **IA** (`ai/`): o snapshot enviado ao modelo contém somente dados agregados da loja (sem dados pessoais de compradores) e uma lista explícita de lacunas (`data_gaps`). Saídas estruturadas validadas por Zod. Fallback automático de modelo em caso de recusa por política.

## Segurança

| Tema | Implementação |
|---|---|
| Credenciais | Tokens ML e PKCE verifier criptografados (AES-256-GCM) no servidor; nunca enviados ao navegador. `ENCRYPTION_KEY` obrigatória em produção. |
| Autenticação | Senhas com scrypt; sessão em cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção; token de sessão guardado como hash. Limite de 5 tentativas de login / 15 min. |
| Autorização | Papéis `admin` > `operator` > `viewer`. Só admin conecta o ML, aprova ações, gerencia usuários e vê auditoria. |
| CSRF | Toda requisição de escrita exige `X-Requested-With: mli` (exceto o webhook do ML, que valida `user_id` e `application_id`). |
| Cabeçalhos | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS em produção. |
| Uploads | Somente JPEG/PNG/WebP, 10 MB, nomes aleatórios, servidos apenas a usuários autenticados. |
| Auditoria | `audit_log` registra login, conexão, aprovações, execuções, falhas, edição de custos, publicação, exportações. |
| Logs | JSON estruturado com mascaramento de chaves sensíveis. |

## Regras de automação e aprovação

`services/actions.ts` é o único caminho para alterar a loja ou o estoque manualmente. Tipos: `publish_listing`, `update_price`, `update_status`, `update_ml_stock`, `stock_adjust`, `answer_question`, `ads_recommendation`. Cada ação nasce `pending`; a transição atômica `pending → approved` impede execução dupla; o resultado (`executed`/`failed`) e quem decidiu ficam gravados. A aprovação exige `{ "confirm": true }` e papel de administrador. Campanhas de publicidade **nunca** são alteradas pela API — a aprovação de uma recomendação só a registra para execução manual.

## Rotinas automáticas (`services/scheduler.ts`)

| Rotina | Frequência |
|---|---|
| Sincronização incremental + nomes de categoria | `SYNC_INTERVAL_MINUTES` (padrão 15) |
| Importação completa de anúncios | a cada 6 h |
| Reavaliação de alertas | 30 min (e após cada sincronização/webhook) |
| Relatório diário de IA | 1×/dia a partir das 7 h (horário da loja) |
| Backup (`VACUUM INTO`) | `BACKUP_INTERVAL_HOURS` (padrão 24), mantém `BACKUP_KEEP` |
| Limpeza de logs e sessões | 6 h (logs > 30 dias) |

## Notificações externas (preparado)

Alertas novos são enfileirados em `notification_outbox` para cada canal ativo em `notification_channels` com severidade suficiente. Para enviar de fato, implemente um worker que leia a fila e use um provedor (ex.: SMTP/SES para e-mail, WhatsApp Business Cloud API), marcando `status = sent|failed`. Até lá, a interface informa que nenhum envio externo ocorre.

## API (resumo)

Todas as rotas sob `/api`, JSON, autenticadas por sessão.

- `auth`: `GET /auth/status`, `POST /auth/setup|login|logout|password`; `users` (admin).
- `ml/oauth`: `GET /start|status`, `GET /callback`, `POST /disconnect`; `POST /ml/notifications` (webhook).
- `POST /sync`, `GET /system/status`, `GET|PUT /settings`, `GET /audit`, `GET|POST /backups`.
- `GET /dashboard?period=today|yesterday|7d|30d|90d|custom&from&to`.
- `GET /listings`, `/listings/:id`, `/products`, `PATCH /products/:id`, `GET|PUT /products/:id/costs`.
- `GET /finance/fee`, `POST /finance/simulate`, `GET /finance/profitability`.
- `GET /inventory`, `/inventory/movements`; `GET /orders`; `GET /questions`, `POST /questions/:id/suggest`.
- `GET /ads`; `GET|POST /actions`, `POST /actions/:id/approve|reject`; `GET /alerts`, `PATCH /alerts/:id`.
- `POST /ai/ask`, `GET|POST /ai/daily-report`.
- `GET|POST /drafts`, `POST /drafts/:id/generate|validate|request-publish|images`, `PUT|DELETE /drafts/:id`.
- `POST /market/research|discover|opportunities`, `GET /market/research|opportunities|trends`.
- `GET /reports`, `GET /reports/:key?format=json|xlsx|pdf`; `GET /search?q=`.

## Deploy recomendado

- Um processo Node (`npm run build && NODE_ENV=production npm start`) atrás de um proxy HTTPS (Caddy/Nginx) ou em plataformas como Railway/Render/Fly com volume persistente para `DATA_DIR`.
- Defina `ENCRYPTION_KEY`, `APP_URL` e `ML_REDIRECT_URI` com o domínio HTTPS.
- Copie periodicamente `DATA_DIR/backups` para armazenamento externo e guarde a `ENCRYPTION_KEY` separadamente.

## Próximos passos sugeridos

- Variações de anúncios (estoque por variação) e vínculo de vários anúncios a um produto pela interface.
- Mensagens pós-venda (`/messages/packs`) com aprovação.
- Worker de envio de notificações por e-mail/WhatsApp.
- PostgreSQL e multi-loja, se a operação crescer.
