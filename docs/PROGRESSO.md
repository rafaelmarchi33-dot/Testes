# Registro de progresso — MIND2MATTER INTELLIGENCE

Registro mantido para continuar o desenvolvimento sem perder a arquitetura.

## Situação por fase

| Fase | Escopo | Situação |
|---|---|---|
| 1 | Estrutura, autenticação, banco, dashboard | Concluída — migrações 001–003, sessões/papéis, visão geral com 16 KPIs e 10 gráficos |
| 2 | Mercado Livre, anúncios, pedidos, importação | Concluída — OAuth oficial com status detalhado, central de anúncios, importação CSV/XLSX/PDF com desfazer |
| 3 | Financeiro, precificação, rentabilidade | Concluída — cadastro de custos, calculadora 3D, simulador, ranking, DRE, tarifas por canal/anúncio |
| 4 | Produção, máquinas, estoque, filamentos | Concluída — Mind Factory com planejador e baixa automática |
| 5 | Mind AI, radar, concorrência | Concluída — conversas, CEO, diagnóstico, radar com nota 0–100, concorrentes |
| 6 | Marketing, metas, alertas, automações | Concluída — gerador de anúncios, plano de fotos, ads, metas, 20 regras de alerta, 7 rotinas |
| 7 | Testes, segurança, refinamento visual | Concluída — 22 testes, verificação ponta a ponta no navegador (desktop e celular), tema Emerald Night |

## Mapa do código

- `server/src/db/schema.ts` — migrações (nunca editar uma publicada; acrescentar nova).
- `server/src/services/company.ts` — empresa, relatórios de período, meta, projeção, simulação.
- `server/src/services/overview.ts` — visão geral e lista de dados pendentes.
- `server/src/services/listingsIntel.ts` — classificação e ranking de anúncios.
- `server/src/services/costs3d.ts` — configuração de custos, calculadora, cenários, ranking.
- `server/src/services/dre.ts` — DRE gerencial.
- `server/src/services/factory.ts` — máquinas, filamentos, ordens e planejador.
- `server/src/services/rnd.ts` — radar (nota, pesquisa ML e web) e laboratório.
- `server/src/services/imports.ts` — leitura, mapeamento, validação, efetivação e desfazer.
- `server/src/services/routines.ts` — rotinas e agendamento.
- `server/src/services/alerts.ts` — regras de alerta (configuráveis em `alert_rules`).
- `server/src/ai/mind.ts` — snapshot da empresa, conversas, CEO, gerador de anúncios.
- `server/src/routes/v2.ts` — rotas REST dos módulos novos; `routes/api.ts` — rotas anteriores.
- `web/src/pages/*` — uma página por módulo; `web/src/lib/global.tsx` — filtros globais.

## Pendências que dependem do dono da loja

1. Criar o app no DevCenter do Mercado Livre e preencher `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`; conectar em Integrações.
2. Definir `ANTHROPIC_API_KEY` para habilitar Mind AI, CEO, pesquisa web e gerador.
3. Preencher o cadastro de custos (filamento, energia, consumo da A1, depreciação, embalagem, impostos) e as tarifas dos canais.
4. Cadastrar peso e tempo de impressão dos produtos (ou importar a planilha de produtos).
5. Importar relatórios de vendas da Shopee e históricos anteriores do ML.

## Próximas evoluções sugeridas

- Migração opcional para PostgreSQL/Supabase (o SQL é compatível; trocar a camada `db/index.ts`).
- Envio real de notificações por e-mail/WhatsApp (a fila `notification_outbox` já existe).
- Integração oficial com a API da Shopee quando houver credenciais de parceiro.
- Pré-visualização 3D de STL no laboratório.
