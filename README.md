# MIND2MATTER · MERCADO LIVRE INTELLIGENCE

Plataforma de gestão comercial, inteligência artificial e automação de vendas da **Mind2Matter 3D Printing** no Mercado Livre.

Identidade visual: laranja filamento `#F26A1B`, creme `#EDE6D6` e preto carbono `#0B0B0D`; tipografias Russo One (marca), Saira (títulos) e Inter (texto). Tema escuro é o padrão; o claro fica no botão de tema. Logo oficial (PNG transparente) e ícones em `web/public/brand/`; a versão usada nos relatórios PDF/Excel fica em `server/assets/`.

- **Integração oficial** com a API do Mercado Livre (OAuth 2.0 + PKCE, renovação automática de tokens, sincronização incremental, webhooks).
- **Dados reais**: nenhuma tela usa dados fictícios. Quando uma integração não está disponível, o sistema mostra a limitação — nunca simula sucesso.
- **IA (Claude, Anthropic)**: gerente da loja, relatório diário, criação de anúncios a partir de fotos, análise de mercado.
- **Nada é alterado na loja sem aprovação**: publicar, alterar preço, pausar, mexer em estoque, responder compradores — tudo passa pela Central de Aprovações e fica no histórico de auditoria.

## Módulos

| Módulo | O que faz |
|---|---|
| Dashboard executivo | Faturamento (total, hoje, 7/30 dias, período), pedidos, unidades, ticket médio, lucro e margem, investimento em ads, conversão, anúncios ativos, sem estoque, aguardando envio. Gráficos: evolução diária vs. período anterior, comparativo mensal, faturamento e lucro por produto, categorias, crescimento, campanhas. Filtros: hoje, ontem, 7, 30, 90 dias e personalizado. |
| Gerente IA | Chat com perguntas livres e relatório diário em 8 seções (resumo, mais vendidos, quedas, oportunidades, estoque, preços, novos produtos, ações prioritárias). Cada recomendação vem com motivo, números de apoio, impacto estimado e nível de confiança. Recomendações de preço podem ser enviadas para aprovação. |
| Criar anúncio | Envio de fotos + dados opcionais → IA identifica o produto, aponta o que precisa ser confirmado, escolhe a categoria pelo preditor oficial, preenche a ficha técnica com os atributos da categoria, escreve título (no limite da categoria) e descrição, sugere SKU, palavras-chave e fotos adicionais. O preço sugerido é **calculado** (custos + tarifa oficial + margem-alvo), não inventado. Prévia editável, validação no ML (`/items/validate`), rascunho, publicação após autorização explícita, retorno de link, ID e status. |
| Oportunidades de mercado | Pesquisa de concorrência (preços, vendedores, avaliações, vendidos quando a API informa, tendências de busca) e geração de oportunidades com custo e margem **marcados como estimativa**. |
| Financeiro | Ficha de custos por produto (matéria-prima, fabricação, energia, tempo × mão de obra, embalagem, operacionais, frete, ads, impostos, outros). Rentabilidade real por produto com tarifas e frete reais do ML. Calculadora: preço mínimo, recomendado, lucro, margem, ROI e ponto de equilíbrio. |
| Estoque e produção | Saldo interno, baixa automática e idempotente em vendas pagas, estorno em cancelamentos, estoque mínimo, produtos sob demanda, giro, parados, histórico e plano de produção por velocidade de vendas. |
| Publicidade | Product Ads (somente leitura): investimento, impressões, cliques, CTR, CPC, vendas atribuídas, ACOS, ROAS, por campanha e por produto, com diagnóstico e análise por IA. |
| Pedidos e logística | Número, produtos, quantidade, valor, data, pagamento, envio, prazo de postagem, rastreio; filtros e alertas de atenção. |
| Perguntas | Perguntas sem resposta, sugestão de resposta por IA, envio somente após aprovação. |
| Alertas | 12 regras automáticas (vendas acima da média, sem estoque, estoque baixo, queda de desempenho, parado, margem baixa, oportunidade de preço, cancelamentos, perguntas, prazo de envio, potencial para campanha, reautorização). Estrutura de canais para e-mail/WhatsApp. |
| Relatórios | Vendas, produtos, financeiro, lucratividade, estoque, publicidade, mensal e oportunidades — em Excel e PDF. |
| Integrações e ajustes | Conexão ML, status de sincronização, parâmetros comerciais, usuários e papéis, notificações, auditoria e backups. |

## Como rodar

Requisitos: **Node.js 22.18+** (usa SQLite nativo e execução direta de TypeScript).

```bash
npm run install:all
cp server/.env.example server/.env   # preencha as credenciais
```

Desenvolvimento (dois terminais):

```bash
npm run dev:server   # API em http://localhost:4000
npm run dev:web      # interface em http://localhost:5173
```

Produção (um único processo serve API + interface):

```bash
npm run build
NODE_ENV=production npm start         # http://localhost:4000
```

No primeiro acesso, crie o usuário administrador. Depois, em **Integrações e ajustes**, conecte a conta do Mercado Livre.

### Variáveis essenciais (`server/.env`)

| Variável | Para quê |
|---|---|
| `ML_CLIENT_ID`, `ML_CLIENT_SECRET` | App criado no DevCenter do Mercado Livre |
| `ML_REDIRECT_URI` | Deve ser idêntica à cadastrada no app (ex.: `https://seudominio/api/ml/oauth/callback`) |
| `ANTHROPIC_API_KEY` | Habilita os recursos de IA |
| `ENCRYPTION_KEY` | Chave AES-256 (32 bytes base64) para criptografar tokens — **obrigatória em produção** |
| `APP_URL` | URL pública da interface |

Passo a passo do aplicativo no Mercado Livre: [docs/MERCADO_LIVRE.md](docs/MERCADO_LIVRE.md). Arquitetura, segurança e operação: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Testes

```bash
npm test          # testes do backend (node:test)
npm run typecheck # verificação de tipos do backend e do frontend
```

Os testes cobrem criptografia, PKCE, períodos no fuso da loja, cálculos financeiros, renovação de token e repetição em 429, importação de anúncios, baixa de estoque idempotente, rentabilidade, alertas e o fluxo de aprovação. O transporte HTTP do Mercado Livre é substituído **apenas nos testes**.
