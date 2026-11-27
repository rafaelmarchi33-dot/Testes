# Auditoria — MIND2MATTER INTELLIGENCE

Auditoria funcional completa com banco de dados novo, servidor real e um servidor simulado (mock) do Mercado Livre e da API da Anthropic. O mock permite exercitar o código real de OAuth, sincronização e IA de ponta a ponta e inspecionar exatamente o que é enviado.

**Resultado final:** 181/181 verificações de API · 69/69 passos de interface (computador e celular) · 24/24 testes unitários · nenhum erro de console ou de API.

Para repetir: `npm run audit` (ou `AUDIT_FILES=/pasta/com/relatorios npm run audit` para incluir relatórios reais da loja: `desempenho.xlsx` e `vendas.pdf`).

## Funcionalidades testadas

### Autenticação e controle de acesso
- Rotas protegidas sem sessão retornam 401; configuração inicial única (segunda tentativa → 409); senha curta rejeitada; senha errada → 401.
- Proteção anti-CSRF: POST sem o cabeçalho exigido → 403.
- Papéis: leitura não altera custos, não cria ordens, não importa; operador não altera custos, não aprova ações, não desfaz importações, não unifica anúncios, não inicia OAuth.
- Exclusões exigem confirmação explícita (sem `confirm: true` → 400).
- Arquivos do laboratório inacessíveis sem sessão; conversas da IA visíveis apenas ao próprio usuário.

### Integração Mercado Livre (código real contra API simulada)
- Status: não conectado → aguardando autorização → conectado.
- URL de autorização com `client_id`, `response_type=code`, `state` e PKCE S256.
- Callback com `state` inválido recusado; reuso do mesmo `state` bloqueado.
- Troca do código envia `client_secret` e `code_verifier`, e o `code_verifier` confere com o `code_challenge`.
- Tokens nunca aparecem nas respostas ao frontend; chamadas usam `Authorization: Bearer`.
- Sincronização de anúncios, pedidos (pagos e cancelados), envios, perguntas, visitas e reputação.
- Alteração de preço só é enviada ao ML depois da aprovação do administrador, com registro na auditoria.

### Dados compartilhados entre módulos
- O mesmo pedido aparece de forma consistente em: visão geral (faturamento, pedidos, unidades, ticket, conversão, gráfico diário, mais vendidos), central de anúncios (unidades, pedidos e visitas por anúncio), meta do mês, DRE (receita e tarifas reais) e contexto da IA.
- A ficha de custos salva pela calculadora é usada pela central de anúncios, pelo ranking, pela rentabilidade real e pelo lucro da visão geral.
- Uma ordem de produção concluída baixa filamento, soma horas à máquina, dá entrada no estoque e alimenta horas de impressão e ocupação na visão geral. O alerta de filamento baixo é disparado.
- Fluxos radar → laboratório → produto comercial, e marketing usando produto e calculadora.

### Cálculos financeiros (conferidos com cálculo independente)
Filamento com perdas, energia, custo de produção, custo variável total, margem de contribuição (R$ e %), preço mínimo (margem zero), preço recomendado (margem-alvo), preço promocional, lucro por hora, ponto de equilíbrio, cenários de volume, rentabilidade real com a tarifa cobrada em cada pedido, DRE com despesas lançadas. Faturamento ≠ lucro: o lucro só aparece para itens com custo, com cobertura indicada.

### Filtros
Hoje × ontem, 7 dias, mês atual × mesmo intervalo do mês anterior, período personalizado e canal (Mercado Livre/Shopee) alteram visão geral, gráficos, central de anúncios, publicidade e metas. Período inválido → 400.

### Importação
- XLSX real "Métricas do desempenho" do ML: detecção automática, 8 dias válidos, linha de totais ignorada, efetivação e reimportação marcada como duplicada.
- PDF de etiquetas/DACE reconhecido e não importado.
- CSV de vendas (Shopee): linha inválida apontada, mapeamento corrigido manualmente respeitado, filtro por canal e desfazer.
- Histórico de importações.
- Combinação sem dupla contagem: pedidos > métricas diárias > relatório agregado, dia a dia.

### Mind AI
- A chamada parte do backend com a chave do servidor.
- O modelo recebe o snapshot da empresa (Mind2Matter, anúncios sincronizados, meta, indicadores) e as regras de rotulagem real/estimativa/hipótese/recomendação. Apelidos de compradores não são enviados.
- O histórico da conversa é enviado nas perguntas seguintes.
- Diagnóstico do CEO estruturado e salvo.
- O gerador de anúncios usa o preço calculado pelo sistema, não pela IA.
- A rotina diária combina dados calculados com a análise da IA.

### Interface (Playwright)
- **Computador:** login, seletor de período e canal, busca global, notificações, menu de perfil, tema, menu lateral recolhível, gráficos.
- **Seller:** tabela, busca, ordenação, detalhe do anúncio, tarifas, pedido de preço, abas, exportação Excel.
- **Demais módulos:** aprovação, chat e CEO da IA, radar (cadastro e envio ao laboratório), laboratório (teste, STL, novo produto), CFO (calculadora, cadastro de custos, ranking, DRE com despesa), fábrica (ordem, status com confirmação, planejamento com IA, máquinas, filamentos), marketing (gerador, foto, publicidade), metas (simulação, marco), concorrência (cadastro e análise), importação, regras de alerta, rotinas (executar, ver resultado, configurar), demais páginas e download de PDF.
- **Celular (iPhone 13):** as 22 páginas sem rolagem horizontal; menu móvel; seletor de período.

### Exportação
32 exportações (16 relatórios × Excel e PDF) validadas pelo conteúdo do arquivo (assinatura XLSX/PDF).

## Problemas encontrados e corrigidos

| # | Problema | Impacto | Correção |
|---|---|---|---|
| 1 | Rota `/marketing/:id` registrada antes de `/marketing/ads` | A aba "Análise de publicidade" sempre falhava ("ID inválido") | Ordem das rotas corrigida |
| 2 | Visão geral ignorava métricas diárias quando o período também tinha pedidos | Faturamento subestimado e diferente da meta | Combinação dia a dia: pedidos onde existem, métricas nos demais dias |
| 3 | Alerta de queda de conversão contava apenas pedidos | Alerta falso com métricas importadas | Conta também as vendas das métricas diárias (teste de regressão) |
| 4 | Central de anúncios só aceitava "últimos N dias" | "Mês atual" e período personalizado eram ignorados (e o ranking da visão geral também) | Aceita o intervalo do filtro global |
| 5 | Conversão por anúncio usava total de visitas sem período | Conversão distorcida (períodos misturados) | Só visitas do mesmo período; o total importado aparece marcado e fora da conversão |
| 6 | Contexto da IA não tinha as métricas diárias nem os indicadores da visão geral | IA respondia sem os dados importados | Snapshot inclui métricas diárias e visão geral de 30 dias |
| 7 | Anúncio da importação inicial duplicava o produto depois da conexão com o ML | "Produtos ativos" contados em dobro | Ação "Unificar" leva ficha, custos, tarifas e concorrentes ao anúncio real |
| 8 | Preço digitado no detalhe do anúncio era sobrescrito ao recarregar | Pedido de alteração enviado com o valor antigo | Estado inicializado só ao trocar de anúncio |
| 9 | Cartões e abas sem `min-w-0` | Rolagem horizontal no celular (Mind AI, Pedidos, Concorrência, Relatórios) | Correção nos componentes base (vale para todas as páginas) |

## Integrações que dependem de credenciais ou configuração externa

| Integração | O que falta | Sem ela |
|---|---|---|
| Mercado Livre (OAuth, sincronização, publicação, preço) | App no DevCenter do ML; `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI` (idêntica à cadastrada); domínio HTTPS público para o callback e as notificações | Status "não configurado"; dados entram por importação de relatórios |
| Mercado Livre Ads (Product Ads) | Conta com Product Ads ativo e permissão do app | Publicidade só por importação do relatório de campanhas |
| Mind AI, CEO, pesquisa web do Radar, gerador de anúncios, análise das rotinas | `ANTHROPIC_API_KEY` | Recursos mostram "integração indisponível"; rotinas geram só os dados calculados |
| Criptografia dos tokens em produção | `ENCRYPTION_KEY` (32 bytes, base64) | Obrigatória em produção |
| Shopee | Não há integração por API (exige credenciais de parceiro) | Importação do relatório de vendas da Shopee |
| Google Trends | Sem API pública oficial | Radar usa ML e pesquisa web via IA |
| Notificações por e-mail/WhatsApp | Provedor de envio (a fila já existe) | Alertas na plataforma; webhook opcional nas rotinas |
| Agendamento das rotinas | Processo do servidor em execução contínua | Execução manual pelo botão "Executar agora" |

O OAuth e a IA foram validados com o código real contra servidores simulados. A conexão com a conta verdadeira do Mercado Livre e o uso da chave real da Anthropic precisam ser confirmados no seu ambiente, depois de configuradas as credenciais.
