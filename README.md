# MIND2MATTER INTELLIGENCE

Central de inteligência empresarial da **Mind2Matter** — fabricação e venda de produtos impressos em 3D (Bambu Lab A1 Combo, FDM, bico 0,4 mm, PLA/PETG, multicolor com AMS) no Mercado Livre e na Shopee.

Gestão comercial, financeira, produção, desenvolvimento de produtos, inteligência artificial e automação em uma única aplicação, com banco de dados, autenticação, papéis de acesso e auditoria.

Princípios que valem para todos os módulos:

- **Nenhum dado fictício.** Quando falta informação, a tela mostra "pendente" e diz o que precisa ser conectado ou cadastrado.
- **Origem do dado sempre visível:** API, pedidos importados, relatório agregado importado, importação inicial, estimativa ou derivado.
- **Faturamento não é lucro.** Lucro e margem só aparecem com custos cadastrados.
- **Nada muda sem aprovação:** preço, estoque do anúncio, publicação, pausa, respostas e publicidade passam pela Central de Aprovações. Compras nunca são feitas pelo sistema. Toda operação importante pede confirmação e fica no histórico de auditoria.

## Módulos

| Módulo | Rota | O que faz |
|---|---|---|
| Visão geral | `/` | 16 indicadores (faturamento, lucro estimado, margem de contribuição, pedidos, unidades, ticket, visitas, conversão, ads, ROAS, ACOS, produtos ativos, campeões, estoque, horas de impressão, ocupação), anel de progresso da meta, 10 gráficos e comparações hoje×ontem, 7d, 30d, mês×mês anterior e personalizado. Filtros globais de período e canal. |
| Mercado Livre Seller | `/seller` | Central de anúncios (imagem, título, SKU, ID, preço, estoque, visitas, vendas, conversão, qualidade, situação, margem, lucro/un.), busca, filtros, ordenação, paginação, classificação Campeões/Oportunidades/Escaláveis/Subperformers/Críticos, ranking dos 20 prioritários, detalhe com tarifas por anúncio e pedido de alteração de preço, status real da conexão OAuth (não conectado, aguardando autorização, conectado, erro de autenticação, token expirado), exportação Excel/PDF. |
| Mind AI | `/mind` | Conversas com histórico salvo, agentes "Mind AI" e "CEO Mind2Matter", atalhos para as 16 capacidades, respostas rotuladas [REAL]/[ESTIMATIVA]/[HIPÓTESE]/[RECOMENDAÇÃO], visualização exata do contexto enviado à IA e diagnóstico completo estruturado do CEO. |
| Radar de produtos 3D | `/radar` | Pesquisa por categoria no Mercado Livre (API oficial) e em fontes públicas via busca web da IA (com links), cadastro manual, nota 0–100 (demanda 25, margem 25, fabricação 15, concorrência 15, diferenciação 10, logística 10), observado × estimado separados, botão **Adicionar ao laboratório de produtos**. |
| Laboratório | `/laboratorio` | Quadro por status (ideia → descontinuado), SKU, categoria, fornecedor do modelo, licença, peso, tempo, material, custo, preço, margem, anexos STL/3MF/imagens, histórico de testes e alterações, conversão de produto aprovado em cadastro comercial. |
| Financeiro — CFO | `/financeiro` | Cadastro de custos (filamento por material, energia, consumo, depreciação, manutenção, mão de obra, embalagem, acabamento, perdas, impostos, publicidade, frete, custos fixos), tarifas por canal e por anúncio, calculadora 3D completa (custos, margem de contribuição, preço mínimo/recomendado/promocional, lucro por hora, ponto de equilíbrio), simulador 1/10/50/100/500 un., ranking de rentabilidade, DRE gerencial e despesas. |
| Rentabilidade real | `/rentabilidade` | Lucro por anúncio com as tarifas e fretes reais de cada pedido do ML. |
| Mind Factory | `/fabrica` | Impressoras (A1 Combo cadastrada), manutenções, ordens de produção com status Aguardando → Concluída e confirmação a cada mudança, baixa automática e idempotente de filamento, horas de máquina e entrada em estoque ao concluir, planejamento (prazo, prioridade, lucro/hora, lotes, mesa, filamento necessário, risco de atraso) e recomendação da IA, estoque de filamentos com mínimo e consumo. |
| Anúncios e marketing | `/marketing` | Gerador de anúncio (3 títulos, descrição, palavras-chave, ficha técnica com itens a confirmar, diferenciais, FAQ, kits, posicionamento; preço calculado pelo sistema), planejador das 7 fotografias com checklist, análise de publicidade somente leitura (impressões, cliques, CPC, investimento, receita, ACOS, ROAS, margem após ads). |
| Metas e crescimento | `/metas` | Meta de R$ 20 mil, trajetória diária, projeção pelo histórico real (marcada como estimativa), alerta de atraso, simulação por ticket (pedidos, unidades, faturamento diário/semanal, horas de impressão, uso da capacidade, impressoras, filamento, investimento) e metas intermediárias. |
| Concorrência | `/concorrencia` | Cadastro manual e importação de links públicos (lidos pela API oficial quando conectada), comparativo de preço e posicionamento, sinalizações e análise da IA. |
| Importação | `/importacao` | CSV, XLSX e PDF; detecção do tipo e do cabeçalho (inclusive relatórios do ML com linhas de título), mapeamento automático editável, validação de duplicidade, datas, valores, SKUs, pedidos e quantidades, prévia, histórico e desfazer. Tipos: vendas, anúncios, métricas do período, publicidade, visitas, produtos. |
| Relatórios | `/relatorios` | Exportação Excel e PDF de vendas, produtos, financeiro, lucratividade, estoque, publicidade, mensal, oportunidades, central de anúncios, ranking, produção, filamentos, DRE e metas. |
| Central de alertas | `/alertas` | 20 regras (conversão, meta, campeão com estoque baixo, desempenho, filamento, atraso, campanha sem retorno, margem negativa, oportunidade de mercado, entre outras) com ativação, prioridade e limites configuráveis; notificações na barra superior. |
| Rotinas da diretoria | `/rotinas` | Diária, segunda (mercado), terça (anúncios), quarta (preços), quinta (produção), sexta (relatório executivo) e fim do mês (DRE). Agendamento interno real, execução manual, horário configurável, histórico, webhook opcional. |

Também seguem ativos os módulos já existentes: pedidos e logística, perguntas, estoque, criação de anúncio com IA e publicação após aprovação, publicidade do Product Ads, integrações, usuários e backups.

## Dados iniciais

A migração `003` cadastra os dados informados na implantação, sempre identificados como **importação inicial** (não são métricas em tempo real):

- Empresa Mind2Matter, 95 anúncios identificados, faturamento informado entre R$ 1.000 e R$ 3.000/mês, meta de R$ 20.000/mês.
- Relatório do Mercado Livre de 19/11/2026 a 26/11/2026: vendas brutas R$ 1.872, 39 unidades, 37 vendas, 534 visitas, conversão 6,9%, preço médio R$ 48 e as variações informadas (o período anterior é derivado delas e sinalizado como tal).
- Anúncio "Ímã de reposição para Hollyland Lark M2": R$ 45 (de R$ 50), qualidade 94, situação "ganhando", 949 unidades exibidas no anúncio. O ID oficial do ML não foi informado; estoque físico e custos ficam pendentes.
- Impressora Bambu Lab A1 Combo (bico 0,4 mm, PLA/PETG, AMS lite). Potência, valor e horas não informados.

## Como rodar

Requisitos: **Node.js 22.18+**.

```bash
npm run install:all
cp server/.env.example server/.env   # preencha as credenciais
npm run dev:server   # API em http://localhost:4000
npm run dev:web      # interface em http://localhost:5173
```

Produção (um processo serve API e interface): `npm run build && NODE_ENV=production npm start`. No primeiro acesso, crie o administrador.

| Variável | Para quê |
|---|---|
| `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI` | App do DevCenter do Mercado Livre (OAuth 2.0 + PKCE) |
| `ANTHROPIC_API_KEY` | Mind AI, CEO, pesquisa web do radar, gerador de anúncios, análises das rotinas |
| `ENCRYPTION_KEY` | AES-256 para os tokens — obrigatória em produção |
| `APP_URL` | URL pública da interface |

Sem as integrações, o sistema funciona com importação de relatórios e cadastros, e cada tela informa o que falta conectar.

## Arquitetura

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS 4 + Recharts, tema Emerald Night (claro opcional), responsivo (sidebar recolhível, menu móvel).
- **Backend:** Node.js + Express 5 + TypeScript, API REST, validação Zod, sessões HttpOnly, proteção CSRF, papéis admin/operador/leitura, auditoria, logs de API.
- **Banco:** SQLite nativo do Node (`node:sqlite`, WAL) com migrações versionadas. Escolhido para rodar em um único processo sem infraestrutura extra; o esquema é SQL padrão e pode migrar para PostgreSQL/Supabase quando houver vários usuários simultâneos ou múltiplas instâncias.
- **IA:** API da Anthropic chamada somente pelo backend; o contexto é montado a partir do banco (sem dados pessoais de compradores).
- **Arquivos:** uploads (STL/3MF/imagens/importações) no diretório de dados do servidor, servidos apenas a usuários autenticados.

Detalhes: [docs/ARQUITETURA.md](docs/ARQUITETURA.md) · progresso e próximos passos: [docs/PROGRESSO.md](docs/PROGRESSO.md) · produção: [docs/PRODUCAO.md](docs/PRODUCAO.md) · Mercado Livre: [docs/MERCADO_LIVRE.md](docs/MERCADO_LIVRE.md).

## Testes

```bash
npm test          # 24 testes do backend (node:test)
npm run typecheck # tipos do backend e do frontend
npm run audit     # auditoria completa: API (181 verificações) + interface no computador e no celular (69 passos)
```

A auditoria sobe a aplicação com banco novo e um servidor simulado do Mercado Livre e da Anthropic, exercitando o OAuth real (PKCE), a sincronização, a IA, os cálculos, os filtros, as importações e as permissões. Resultado e correções: [docs/AUDITORIA.md](docs/AUDITORIA.md).

Cobrem dados iniciais, calculadora 3D e preços, nota do radar e fluxo radar → laboratório → produto, importação (formatos brasileiros, cabeçalho deslocado, duplicidade, datas futuras, efetivação e desfazer), extração de PDF, meta sem dupla contagem, visão geral a partir de relatório, produção (transições, baixa idempotente de filamento, horas, estoque), alertas novos, central de anúncios sem margem inventada, rotinas e DRE — além dos testes anteriores de criptografia, OAuth, sincronização e aprovações.
