# Colocando em produção — checklist

Caminho recomendado: **Railway** (hospedagem com HTTPS, volume persistente e deploy automático pelo GitHub) + **registro.br** (domínio) + **DevCenter do Mercado Livre** + **Console da Anthropic** (IA).
Tempo estimado: 1 a 2 horas. O repositório já tem `Dockerfile` e `railway.json` prontos.

Verificado antes da entrega: instalação limpa (`npm ci`), build e remoção das dependências de desenvolvimento exatamente como o `Dockerfile` faz; o servidor sobe em modo produção, recusa iniciar sem `ENCRYPTION_KEY`, serve a interface, usa cookie `Secure`/`HttpOnly`, cabeçalhos HSTS e anti-clickjacking, e grava banco, uploads e backups em `DATA_DIR`.

Endereço usado nos exemplos: `https://painel.mind2matter.com.br` — troque pelo seu.

---

## 1. Contas e pré-requisitos

| # | O que fazer | Onde |
|---|---|---|
| 1.1 | Registrar o domínio (ex.: `mind2matter.com.br`), se ainda não tiver | registro.br |
| 1.2 | Criar conta (login com GitHub) e assinar o plano **Hobby** | railway.com |
| 1.3 | Criar conta, adicionar créditos e **definir limite de gasto mensal** | console.anthropic.com → Billing / Limits |
| 1.4 | Criar uma **API key** chamada `mind2matter-producao` e guardar | console.anthropic.com → API Keys |
| 1.5 | Entrar no DevCenter **com a conta da loja** no Mercado Livre | developers.mercadolivre.com.br/devcenter |
| 1.6 | Ter um gerenciador de senhas para guardar chaves (1Password, Bitwarden, Keychain) | — |

## 2. Código

| # | O que fazer | Onde |
|---|---|---|
| 2.1 | Abrir um Pull Request do branch `claude/mind2matter-intelligence-platform-8hfymf` para `main` e fazer o merge | GitHub → repositório `Testes` → Pull requests |
| 2.2 | (Opcional) Rodar `npm test` e `npm run audit` localmente antes do merge | Terminal |

## 3. Servidor (Railway)

| # | O que fazer | Onde |
|---|---|---|
| 3.1 | **New Project → Deploy from GitHub repo** → selecione `Testes`, branch `main` | railway.com → Dashboard |
| 3.2 | Adicionar um **Volume** ao serviço com *mount path* `/data` | Serviço → aba *Volumes* (ou botão direito → *Attach volume*) |
| 3.3 | Gerar a chave de criptografia (32 bytes) e **guardar no gerenciador de senhas** — sem ela os tokens salvos não podem ser lidos | Terminal: `openssl rand -base64 32` |
| 3.4 | Cadastrar as variáveis (tabela abaixo) | Serviço → aba *Variables* |
| 3.5 | Adicionar o domínio `painel.mind2matter.com.br` (porta **4000**) | Serviço → *Settings* → *Networking* → *Custom Domain* |
| 3.6 | Criar o registro **CNAME** `painel` apontando para o endereço que o Railway mostrar | registro.br → Domínio → *DNS* → *Editar zona* |
| 3.7 | Aguardar o certificado HTTPS (cadeado verde) e abrir `https://painel.mind2matter.com.br/api/health` → deve mostrar `{"ok":true}` | Navegador |
| 3.8 | Ativar backups automáticos do volume | Serviço → *Volumes* → *Backups* |

**Variáveis do Railway:**

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/data` |
| `PORT` | `4000` |
| `APP_URL` | `https://painel.mind2matter.com.br` |
| `ENCRYPTION_KEY` | a chave gerada no passo 3.3 |
| `ML_REDIRECT_URI` | `https://painel.mind2matter.com.br/api/ml/oauth/callback` |
| `ML_CLIENT_ID` | preencher no passo 4.3 |
| `ML_CLIENT_SECRET` | preencher no passo 4.3 |
| `ANTHROPIC_API_KEY` | a chave do passo 1.4 |
| `SYNC_INTERVAL_MINUTES` | `15` (opcional) |

> Mantenha **1 réplica** do serviço: o banco SQLite fica no volume e não deve ser compartilhado por várias instâncias.

## 4. Aplicativo no Mercado Livre

| # | O que fazer | Onde |
|---|---|---|
| 4.1 | **Criar aplicação**: nome "Mind2Matter Intelligence", logo, descrição | DevCenter → *Minhas aplicações* → *Criar nova aplicação* |
| 4.2 | Preencher: **URI de redirect** `https://painel.mind2matter.com.br/api/ml/oauth/callback`; **PKCE** habilitado; escopos **offline_access, read, write**; permissões de Usuários, Publicações/Itens, Vendas, Envios, Perguntas, Métricas e (se usa anúncios pagos) Publicidade; **URL de notificações** `https://painel.mind2matter.com.br/api/ml/notifications` com os tópicos `orders_v2`, `items`, `questions`, `shipments` | Mesma tela |
| 4.3 | Copiar **App ID** → `ML_CLIENT_ID` e **Secret Key** → `ML_CLIENT_SECRET` | DevCenter → Railway *Variables* (o Railway refaz o deploy sozinho) |

## 5. Primeiro acesso (faça logo após o deploy)

| # | O que fazer | Onde |
|---|---|---|
| 5.1 | **Criar o administrador imediatamente** — enquanto não houver usuário, quem abrir o endereço primeiro vira administrador | `https://painel.mind2matter.com.br` |
| 5.2 | Conectar a loja: *Conectar* → autorizar com a conta da loja | Integrações e ajustes (status também em Mercado Livre Seller › Conexão) |
| 5.3 | Aguardar a primeira sincronização e conferir a tabela por recurso (todos "ok"; Publicidade pode ficar indisponível sem Product Ads) | Mercado Livre Seller › Conexão e sincronização |
| 5.4 | **Unificar o anúncio da importação inicial** ("Ímã de reposição para Hollyland Lark M2") com o anúncio real sincronizado | Mercado Livre Seller → abrir o anúncio → *Unificar* |
| 5.5 | Preencher o **cadastro de custos**: preço do filamento PLA/PETG por kg, energia (R$/kWh), consumo da A1, depreciação e manutenção por hora, mão de obra, embalagem, acabamento, perdas, impostos (% do seu regime), custos fixos mensais | Financeiro — CFO › Cadastro de custos |
| 5.6 | Preencher as **tarifas** do Mercado Livre e da Shopee (ou por anúncio, quando diferirem) | Financeiro — CFO › Cadastro de custos / detalhe do anúncio |
| 5.7 | Informar **peso e tempo de impressão** dos produtos — pela calculadora (*Salvar no produto*) ou importando a planilha de produtos | Financeiro — CFO › Calculadora · Importação › Produtos |
| 5.8 | Completar a impressora (potência, valor, vida útil) e cadastrar os rolos de filamento com custo e estoque mínimo | Mind Factory › Máquinas e Filamentos |
| 5.9 | Importar históricos: relatório "Métricas do desempenho" do ML, vendas da Shopee e, se tiver, campanhas | Importação |
| 5.10 | (Opcional) Cadastrar usuários Operador ou Leitura | Integrações e ajustes › Usuários |

## 6. Validação com dados reais

| # | O que fazer | Resultado esperado |
|---|---|---|
| 6.1 | Comparar faturamento, pedidos e visitas dos últimos 7 dias com o painel do Mercado Livre | Mesmos números (a conversão usa visitas únicas, como o ML) |
| 6.2 | Abrir um anúncio campeão e conferir margem e lucro por unidade com a calculadora | Valores coerentes com o cadastro de custos |
| 6.3 | Perguntar ao Mind AI "Quanto faturamos nos últimos 7 dias?" e gerar o diagnóstico do CEO | Resposta citando seus números, com rótulos [REAL]/[ESTIMATIVA] |
| 6.4 | Pedir uma alteração de preço pequena e aprovar na Central de Aprovações | Preço muda no ML; ação registrada na auditoria |
| 6.5 | Após uma venda ou pergunta real, verificar se aparece no sistema em poucos minutos | Webhook funcionando |
| 6.6 | Executar a "Rotina diária" e exportar um relatório em PDF e Excel | Resumo com dados e análise; arquivos com o logo |
| 6.7 | Abrir no celular e adicionar à tela de início (Safari → Compartilhar) | Painel utilizável no celular |

## 7. Segurança e rotina

| # | O que fazer | Onde |
|---|---|---|
| 7.1 | Guardar `ENCRYPTION_KEY`, senha de administrador e chaves de API no gerenciador de senhas | — |
| 7.2 | Revisar o limite de gasto da IA após o primeiro mês | console.anthropic.com |
| 7.3 | Baixar um backup do volume periodicamente para fora do Railway | Railway → *Volumes* → *Backups* |
| 7.4 | Acompanhar logs se algo falhar | Railway → serviço → *Deployments* → *View logs* |
| 7.5 | Atualizações: todo merge em `main` gera um novo deploy automático | GitHub → Railway |
| 7.6 | Manter o serviço sempre ligado (sem "sleep"): sincronização, alertas e rotinas usam o agendador interno | Railway → serviço → *Settings* |

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Deploy cai logo ao iniciar | `ENCRYPTION_KEY` ausente ou inválida (precisa de 32 bytes em base64) |
| "redirect_uri mismatch" ao conectar | `ML_REDIRECT_URI` diferente da URI cadastrada no DevCenter (confira `https`, domínio e barra final) |
| Conta aparece "reautorização necessária" | Permissão revogada no Mercado Livre ou app alterado: reconectar em Integrações |
| Publicidade "indisponível" | Conta sem Product Ads ativo ou app sem permissão de Publicidade |
| Pesquisa de mercado com aviso de limitação | Busca pública restrita para o app; o sistema usa a busca de catálogo |
| Dados somem após novo deploy | Volume não montado em `/data` ou `DATA_DIR` diferente de `/data` |
| Mind AI mostra "integração indisponível" | `ANTHROPIC_API_KEY` ausente, inválida ou sem créditos |
| Rotinas não rodam no horário | Serviço dormindo/reiniciando; confira os logs e se há 1 réplica sempre ativa |
