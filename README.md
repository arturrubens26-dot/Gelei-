# Geleiô — Geleias Artesanais

E-commerce com área administrativa. Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Prisma 7 · PostgreSQL.

## Rodando localmente

> **Atalho no Windows:** dê dois cliques em `iniciar.bat` (liga o banco e o site e abre o navegador) e em `parar.bat` (desliga). O login de teste do admin está em `ACESSO-LOCAL.txt` (arquivo fora do Git).

```bash
npm install
cp .env.example .env        # preencha SESSION_SECRET e SEED_ADMIN_PASSWORD (veja os comentários)
                            # para o pagamento PIX de demonstração: PAGAMENTOS_SIMULADOS="true"

npm run db:dev              # terminal 1: Postgres local embutido do Prisma (deixe aberto)
# cole no .env a URL "postgres://..." que ele mostrar, em DATABASE_URL
# e descomente DATABASE_POOL_MAX="1" (esse banco executa uma consulta por vez; veja "Banco local sem vagas")

npm run db:deploy           # aplica as migrações em prisma/migrations
npm run db:seed             # produtos de exemplo + usuário admin
npm run dev                 # http://localhost:3000
```

O admin criado pela seed usa `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` do `.env` (o `.env` é um arquivo oculto na raiz; no VS Code abra com `Ctrl+P` e digite `.env`; não confunda com o `.env.example`, onde a senha fica em branco). **Para definir ou trocar a senha do admin**, rode `npm run admin:senha`: você digita a nova senha no terminal (ela não aparece na tela) e ela passa a valer; o `SEED_ADMIN_PASSWORD` do `.env` só vale na criação e depois é ignorado. O seed **não** promove uma conta comum já existente a admin: se o e-mail já estiver cadastrado como cliente, ele falha de propósito.
Para usar outro Postgres (Neon, Supabase, RDS…), basta trocar `DATABASE_URL` e **não** definir `DATABASE_POOL_MAX`.

> **Criando migrações novas:** o `prisma migrate dev` precisa de um banco-sombra e o Postgres embutido (PGlite) não lida bem com ele. Gere o SQL com
> `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, salve em `prisma/migrations/<data>_<nome>/migration.sql` e aplique com `npm run db:deploy`.

> **Testes:** `npm run test:unit` roda os testes das regras puras (leitura de valores digitados, meses, validação das despesas, contas da produção) com `node:test`.

> **Banco local "sem vagas" ("Connection terminated unexpectedly", `ConnectionClosed`, `ECONNRESET`):** o Postgres embutido do `prisma dev` aceita 10 conexões, mas tem um defeito (no `@electric-sql/pglite-socket` 0.1.3, que vem com o Prisma; a 0.2.13 ainda tem): cada conexão que cai sem se despedir (processo morto com a conexão aberta: o site fechado no X no meio de uma consulta, um worker no fim do build, um script interrompido) ocupa uma vaga até o banco reiniciar. Sem vagas, o site mostra "This page couldn't load" e o terminal mostra esse erro. Para quase não acontecer, `src/lib/db.ts` usa um único pool por processo e, com `DATABASE_POOL_MAX="1"`, fecha a conexão ociosa em 500 ms; o `iniciar.bat` reinicia o banco a cada início. Se acontecer, reinicie só o banco: `npx prisma dev stop geleio` e depois `npm run db:dev` (ou `parar.bat` e `iniciar.bat`). Os dados ficam.

> **Página recarregando sem parar no `npm run dev`:** no Next 16.4.0 os logs do navegador (como o "Download the React DevTools", que sai em toda página) iam para `.next/dev/logs` e disparavam recompilação e recarga em laço. O `next.config.ts` desliga isso (`logging.browserToTerminal: false` e `experimental.mcpServer: false`). Ao atualizar o Next, dá para testar religar.

## Git e cópia dos dados

- **Este repositório** guarda o código. Pode ir para um GitHub **privado** (é de lá que a Netlify publica).
- **Os dados** (clientes, pedidos, despesas, produção) ficam no banco, fora da pasta, e o Git só guarda arquivos. Por isso `scripts/dados.mjs` tira um retrato do banco em `dados/local.json` (banco deste computador) ou `dados/producao.json` (site no ar, pela `DATABASE_URL` do `.env.producao`), com uma linha por registro e sem data de gravação: sem mudança nos dados, não há commit.
- **A pasta `dados/` é outro repositório Git, só deste computador**, e o `.gitignore` deste a deixa de fora. Tem dados pessoais (LGPD): **nunca a envie para o GitHub** nem para outro lugar.
- **Salvar:** `salvar-dados.bat` (local e, se houver `.env.producao`, o site no ar), ou `npm run dados:salvar` / `npm run dados:salvar:producao`. O `parar.bat` salva o banco local antes de desligá-lo. Histórico: `git -C dados log --oneline`.
- **Restaurar o banco local:** `restaurar-dados.bat` (pede SIM; antes guarda os dados atuais em `dados/copias-de-seguranca/`). Uma cópia mais antiga: `git -C dados show <commit>:local.json > dados/antiga.json` e `node scripts/dados.mjs restaurar dados/antiga.json --confirmar`. O site no ar só com `--producao`, e com cuidado: troca **todos** os dados.
- A restauração exige o banco na mesma versão (as mesmas migrações) da cópia. A ida e volta foi conferida tabela por tabela num banco de teste.

## Publicar na Netlify

O site roda na Netlify (o Next.js 16 é suportado pelo adaptador OpenNext, sem plugin) com o banco no **Neon** (Postgres na nuvem). O `netlify.toml` fixa o build (`npm run build`, que roda `prisma generate`) e o Node 24.

1. **GitHub:** repositório **privado**; envie este repositório (`git push`). A pasta `dados/` não vai junto.
2. **Neon** (projeto "Geleiô", `silent-frog-81081560`, ramo `production`; ligado a esta pasta pelo arquivo `.neon` e descrito no `neon.ts`). Com o CLI (`npm i -g neon`, depois `neon login`), `neon env pull --file .env.producao` grava neste computador, fora do Git:
   - `DATABASE_URL`: a **com pooler** (`-pooler`), a mesma que vai na Netlify;
   - `DATABASE_URL_UNPOOLED`: a **direta**, usada só para as migrações e as cópias dos dados (pelo pooler o Prisma Migrate falha).
   
   **Não rode `neon env pull` nem `neon deploy` sem `--file .env.producao` / `--no-env-pull`:** sem isso, o CLI troca o `DATABASE_URL` do `.env` pelo do Neon, e o site local passa a gravar na produção.
3. **Criar as tabelas no Neon** (daqui): `npm run db:deploy:producao` (`... status` só mostra). Repita a cada migração nova, **antes** de publicar o código que depende dela.
   - **Driver:** com uma URL do Neon, `src/lib/db.ts` usa o driver serverless do Neon (`@prisma/adapter-neon`): consultas avulsas por HTTP e transações por WebSocket, como a Neon recomenda para a Netlify. Com qualquer outra URL (o banco local), usa o `pg`.
   - **Testar sem mexer na produção:** crie um branch no Neon (`neon branches create --name teste --parent production`), rode o site com a `DATABASE_URL` dele e apague-o no fim (`neon branches delete teste`).
4. **Netlify:** "Add new site" → "Import from Git" → o repositório. Em *Site configuration → Environment variables*:
   - `DATABASE_URL`: a URL **com pooler** do Neon;
   - `SESSION_SECRET`: uma nova, gerada como no `.env.example` (nunca a deste computador);
   - `APP_URL`: o endereço do site (ex.: `https://geleio.netlify.app`);
   - `IP_HEADER_CONFIAVEL`: `x-nf-client-connection-ip`;
   - `DATABASE_POOL_MAX`: `3`.
   
   Não defina `PAGAMENTOS_SIMULADOS`.
5. **Admin do site no ar:** um e-mail seu e uma senha forte, nunca o admin de teste deste computador.
6. **Pagamento (PIX pelo Mercado Pago):** sem `MERCADOPAGO_ACCESS_TOKEN`, o checkout mostra "Pedidos pelo site em breve" e a API recusa pedidos (503) sem gravá-los. Para abrir a loja:
   - No [painel de desenvolvedor](https://www.mercadopago.com.br/developers/panel/app), crie uma aplicação (Pagamentos online, Checkout Transparente). A conta precisa ter uma chave PIX cadastrada.
   - `MERCADOPAGO_ACCESS_TOKEN`: o Access Token de **produção** (`APP_USR-...`). Para ensaiar sem cobrar, use o de teste (`TEST-...`).
   - Em *Webhooks → Configurar notificações*: URL `https://SEU-SITE/api/webhooks/mercadopago`, evento **Pagamentos**. Salve e copie a **assinatura secreta** para `MERCADOPAGO_WEBHOOK_SECRET`.
   - Teste final: um pedido de valor baixo pago com o seu próprio banco. O comprador não pode usar o mesmo e-mail da conta do Mercado Pago (ele recusa).

### Como o PIX funciona (`src/lib/pagamentos.ts`)

- O pedido abre uma cobrança no Mercado Pago (validade de 1 hora) e a página do pedido mostra o QR Code e o copia e cola. Tabela `pagamentos`: um pedido pode ter vários PIX (o vencido dá lugar a um novo, pelo botão "Gerar novo PIX").
- **O pedido só vira PAGO quando o servidor consulta o Mercado Pago com o próprio token** e confere pedido (`external_reference`), valor, moeda e forma de pagamento. O aviso (webhook) e a tela do cliente só disparam essa consulta: um aviso forjado não paga nada. Com a assinatura secreta, avisos sem assinatura válida são recusados (401); avisos de pagamentos que não criamos são ignorados sem consulta.
- A página do pedido pergunta a cada 5 s (o servidor consulta o Mercado Pago no máximo a cada 8 s), então o pedido é confirmado mesmo se o aviso atrasar.
- Repetir o pedido (mesma Idempotency-Key) ou pedir o PIX de novo devolve o mesmo PIX; a `X-Idempotency-Key` enviada ao Mercado Pago (`geleio-<pedido>-<n>`) impede cobrança duplicada em nova tentativa.
- Admin cancelou um pedido pendente: o PIX aberto é cancelado no Mercado Pago. Se ele já tinha sido pago, o painel avisa para devolver o valor pelo Mercado Pago (a devolução não é automática).
- Teste ponta a ponta com um Mercado Pago falso: `MERCADOPAGO_API_URL` aceita só `127.0.0.1`/`localhost`.

No plano grátis, cada publicação gasta créditos: junte as mudanças antes de enviar ao GitHub.

## Estrutura

| Caminho | O que é |
| --- | --- |
| `src/design-system.ts` | Cores, tipografia, símbolos e padrão gingham. **Fonte única da marca**; o `tailwind.config.ts` lê daqui. |
| `src/app/(loja)/` | Loja: home, `/products`, `/checkout`, `/order-confirmation/[id]` (com Header, Footer e carrinho). |
| `src/app/(acesso)/login` | Tela de login, fora do layout da loja: painel com o formulário em "vidro" e, à direita, o pote real de Maracujá que abre sozinho (`src/components/AnimatedJamJar.tsx`, framer-motion): a tampa desenrosca e sobe, a colher de pau tira geleia e uma gota pinga. Repete ao focar um campo (no máximo a cada 8 s). Tem botão "Pausar animação"; com "reduzir movimento" no sistema fica parada no quadro final. As camadas da foto ficam em `public/login/` e saem de `scripts/recortar-pote-login.mjs`. |
| `src/app/(admin)/admin/` | Painel: `/admin/dashboard`, `/orders` (e `/orders/nova`, venda presencial), `/financial`, `/expenses` (despesas), `/production` (lotes e estoque de insumos; `/production/[id]` é a ficha do lote), `/products`. |
| `src/app/api/` | Rotas da API (produtos, entrega, auth, endereços, pedidos, admin). |
| `src/lib/` | Regras de negócio sem framework: `frete`, `pedidos`, `admin`, `pagamentos`, `status`, `limites`, validação (zod). |
| `prisma/` | `schema.prisma`, migrações e `seed.ts`. |

## API

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /api/products` | público | lista os produtos |
| `POST /api/delivery/calculate` | público | `{ cep, pesoTotalGramas }` → valida o CEP (cep-promise) e calcula o frete simulado |
| `POST /api/auth/register` · `login` · `logout` · `GET /api/auth/me` | — | conta e sessão (cookie httpOnly) |
| `GET/POST /api/addresses` | logado | endereços salvos; o CEP é conferido (existência, cidade e UF); limite de 10 por conta |
| `POST /api/orders` | logado | cria o pedido PENDENTE + itens. **Recalcula preço, peso e frete no servidor**. Aceita o cabeçalho `Idempotency-Key` (reenviar a mesma chave devolve o mesmo pedido, 200) e `totalEsperadoCentavos` (se o total calculado for outro, responde 409 com os valores atuais) |
| `GET /api/orders/[id]/pagamento` | logado | situação do pedido e do PIX (consulta o Mercado Pago se o PIX está aberto) |
| `POST /api/orders/[id]/pagamento` | logado | gera o PIX do pedido (ou devolve o que ainda vale) |
| `POST /api/webhooks/mercadopago` | Mercado Pago | aviso de pagamento: só dispara a consulta (assinatura conferida com `MERCADOPAGO_WEBHOOK_SECRET`) |
| `POST /api/orders/[id]/simular-pagamento` | logado | demonstração: marca o próprio pedido como PAGO (só com `PAGAMENTOS_SIMULADOS=true` e sem Mercado Pago) |
| `GET /api/admin/orders?status=&canal=` · `PATCH /api/admin/orders/[id]` | **admin** | lista/filtra pedidos (por status e canal `ONLINE`/`PRESENCIAL`) e muda o status (só transições válidas para o canal) |
| `POST /api/admin/orders` | **admin** | lança uma **venda presencial** `{ itens: [{ productId, quantidade, precoUnitarioCentavos }], formaPagamento, status?: ENTREGUE \| PAGO, data?: "AAAA-MM-DD", clienteNome?, observacao? }`. Cabeçalho `Idempotency-Key` **obrigatório** (a mesma chave com o mesmo conteúdo devolve a venda já lançada, 200; com conteúdo diferente, 422). Limite de 200 por hora por admin |
| `GET /api/admin/financial-stats?mes=AAAA-MM` | **admin** | o Financeiro de um mês: resumo, entradas por canal e por sabor, saídas por categoria, 12 meses até ele e movimentações |
| `GET /api/admin/products` | **admin** | todos os produtos, inclusive os ocultos, com o histórico de vendas e produções |
| `POST /api/admin/products` | **admin** | cria produto (multipart: sabor, pesoGramas, precoCentavos, descricao, ativo, foto) |
| `PATCH /api/admin/products/[id]` | **admin** | edita (multipart; foto opcional) ou mostra/oculta na loja (JSON `{ ativo }`) |
| `DELETE /api/admin/products/[id]` | **admin** | exclui produto sem vendas nem produções (com histórico: 409, oculte) |
| `GET /fotos/[id]` | público | foto enviada pelo painel (guardada no banco; cache permanente) |
| `GET /api/admin/expenses?mes=AAAA-MM` · `POST /api/admin/expenses` | **admin** | o mês das despesas (lançamentos, total por categoria, vendas pagas e saldo) · lança uma despesa `{ descricao, categoria, quantidade, unidade, valorCentavos, data, fornecedor?, observacao? }` |
| `PATCH` · `DELETE /api/admin/expenses/[id]` | **admin** | corrige (envia todos os campos) ou exclui uma despesa |
| `GET/POST /api/admin/supplies` · `PATCH /api/admin/supplies/[id]` · `POST …/[id]/adjustments` | **admin** | insumos com estoque (comprado, usado, ajustes, sobra, custo médio); cadastro/edição; ajuste de estoque (perda, recontagem) |
| `GET/POST /api/admin/production` · `GET/PATCH/DELETE /api/admin/production/[id]` · `GET …/form-data` | **admin** | lotes de geleia com custo por pote e margem; ficha do lote; dados do formulário (insumos, sabores, custos sugeridos) |

Erros seguem `{ "erro": "mensagem", "detalhes": ... }`. Erros de validação trazem `detalhes` com o caminho do campo (`"endereco.cep": ["…"]`). Falha do banco vira `503`.
As rotas `/api/admin/*` conferem `is_admin` **no banco a cada chamada** (não confiam no token).

## Regras de negócio

- **Frete (simulado):** CEP `01…` → R$ 15; `20…` → R$ 25; demais CEPs → R$ 30 (valor provisório). Peso total acima de 2 kg soma R$ 5. Regras em `src/lib/frete.ts` — trocar por Correios/Loggi mantendo `calcularFrete`. Como o frete sai do CEP, o endereço do pedido é conferido contra o CEP (senão daria para pagar frete de capital entregando em outro estado).
- **Faturamento:** soma dos pedidos **Pago + Enviado + Entregue** (o pedido enviado já foi pago). Pendentes e cancelados ficam de fora. O gráfico mensal agrupa pela **data de criação** do pedido, no horário de Brasília.
- **Status:** `PENDENTE → PAGO → ENVIADO → ENTREGUE`; `PENDENTE` e `PAGO` podem ir a `CANCELADO`.
- **Venda presencial (`/admin/orders/nova`):** venda de feira ou balcão lançada pelo admin. Fica na mesma tabela de pedidos, com `canal = PRESENCIAL`, então entra no faturamento, no gráfico e no planner de despesas como qualquer pedido pago; o Financeiro mostra à parte as **vendas na feira e no balcão**.
  - **Sem cliente cadastrado nem entrega:** `user_id` e `address_id` ficam vazios, frete 0, total = soma dos itens. O nome do cliente (opcional) aparece como "Venda presencial · Maria". O cliente nunca vê essas vendas (a confirmação de pedido só busca pedidos online).
  - **Preço:** vem do catálogo, mas o admin pode mudar por item (desconto de feira); viaja em **centavos inteiros**, de R$ 0 a R$ 999,99 por pote (o teto pega "2490" digitado no lugar de "24,90"). Um item pode custar 0, mas a venda não pode ter total zero: brinde e amostra vão em Despesas. Uma linha por produto.
  - **Forma de pagamento** obrigatória: dinheiro, PIX, cartão de débito, cartão de crédito ou outro.
  - **Status inicial:** `ENTREGUE` (levou na hora, padrão) ou `PAGO` (encomenda, para entregar depois). Transições: `PAGO → ENTREGUE` ou `CANCELADO`; `ENTREGUE → CANCELADO` ("Estornar venda", para corrigir um lançamento errado). Não passa por `PENDENTE` nem `ENVIADO`.
  - **Data:** sem data, vale hoje no relógio do servidor; pode ser um dia passado (desde 2020), nunca futuro. A venda retroativa é gravada ao meio-dia de Brasília daquele dia, e `lancado_em` guarda quando ela foi lançada (a lista mostra "lançada em …"). `registrado_por_id` guarda qual admin lançou.
  - **Banco:** a CHECK `orders_canal_coerente` garante que pedido online tem cliente e endereço, e que venda presencial não tem endereço nem frete, tem forma de pagamento e só usa os status `PAGO`, `ENTREGUE` e `CANCELADO`.
  - **Desfazer a migração** `20261016230000_venda_presencial`: o passo a passo está no topo do `migration.sql` (antes, apague ou arquive as vendas presenciais, senão o `SET NOT NULL` falha).
- **Despesas (`/admin/expenses`):** tudo o que a loja gasta, com quantidade, unidade e valor pago (ex.: Adesivos, 50 un, R$ 20,00 → R$ 0,40 cada). Categorias fixas (ingredientes, potes e embalagens, rótulos e adesivos, entrega, divulgação, equipamentos, taxas e impostos, outros) em `src/lib/despesas.ts`; mudar a lista exige migração (enum no banco). Cada mês mostra vendas pagas, despesas e saldo; o Financeiro mostra o mesmo mês com mais detalhe (de onde veio e para onde foi o dinheiro).
  - **Data da compra:** de 2020 até hoje; **data futura não entra** (o Resultado somaria um gasto que ainda não aconteceu). Sem data, vale hoje no relógio do servidor.
  - **Valores digitados:** formato brasileiro ("1.234,56", "20,5", ",50"; "20.5" também). O malformado ("1.2345", "12.34,56") é recusado em vez de adivinhado (`lerNumeroBrasileiro` em `src/lib/dinheiro.ts`). O valor viaja em centavos; quantidade até 3 casas, mínimo 0,001. O banco recusa valor ou quantidade ≤ 0.
  - **Mês das vendas:** as duas telas (Despesas e Financeiro) deixam o Postgres converter a meia-noite de Brasília (`AT TIME ZONE 'America/Sao_Paulo'`), então contam o mesmo mês mesmo com horário de verão.
  - **Desfazer a migração** `20261016220000_despesas` (perde as despesas): `DROP TABLE "expenses"; DROP TYPE "ExpenseUnit"; DROP TYPE "ExpenseCategory"; DELETE FROM "_prisma_migrations" WHERE migration_name = '20261016220000_despesas';`

## Segurança e operação

- **Ambiente validado na subida** (`src/instrumentation.ts`): sem `DATABASE_URL` ou com `SESSION_SECRET` fraco (< 32 caracteres) o servidor não funciona (responde 500 a tudo e loga o motivo).
- **Sessão:** JWT em cookie `httpOnly` + `SameSite=Lax` (`Secure` e prefixo `__Host-` em produção). Só o id do usuário vai no token; papel de admin é sempre lido do banco. Duração: 7 dias (cliente) e 12 h (admin). Não há revogação de sessão no servidor: sair só apaga o cookie.
- **Senhas:** bcrypt custo 11, com no máximo 2 operações simultâneas (o bcryptjs é JS puro e caro); acima da fila a requisição recebe 503. Limite de 72 **bytes**.
- **CSRF:** rotas que mudam estado rejeitam requisições cross-site (`Sec-Fetch-Site`/`Origin`; com `APP_URL` definida, compara com ela) e exigem `Content-Type: application/json` exato. Corpo limitado a 32 KB (413).
- **Limites de taxa (em memória):** login 8 falhas/15 min por **conta+IP** e 40 por conta (a reserva é feita *antes* do bcrypt, então rajadas paralelas não passam); pedidos 30/h e endereços 60/h por usuário; no máximo 20 pedidos pendentes por conta. **Limites por IP só existem se `IP_HEADER_CONFIAVEL` estiver definido** (nome do cabeçalho que o seu proxy/CDN confiável define). Sem isso, qualquer cabeçalho de IP viria do cliente e seria forjável, então é ignorado, e o login fica limitado só por conta (quem erra 8 vezes pode travar a conta de outra pessoa por 15 min; mitigue com CAPTCHA/e-mail se virar problema). Consultas de CEP: no máximo 4 simultâneas, com cache.
- **Cabeçalhos:** `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, CSP parcial (`frame-ancestors`, `base-uri`, `form-action`, `object-src`) e HSTS em produção. Há também uma CSP completa em modo **Report-Only** (`Content-Security-Policy-Report-Only`): confira o console do navegador em produção e, se não houver violações, troque para `Content-Security-Policy`. Respostas da API com dados de conta/pedido saem com `Cache-Control: no-store`.
- **Banco:** restrições `CHECK` (preço, peso, quantidade, total ≥ frete) e índices, além da validação na API. Falha de conexão vira 503 (não 500).
- **Pagamento simulado:** só vale com `PAGAMENTOS_SIMULADOS=true`; em produção (`NODE_ENV=production`) exige também `APP_ENV="demo"`. Sem os dois, o servidor recusa iniciar e a rota de simulação responde 404.
- **LGPD:** o carrinho e o CEP ficam no `localStorage` por até 7 dias e são apagados ao finalizar o pedido e ao sair da conta. Ainda faltam política de privacidade e rotina de exportação/anonimização de dados.

### Produtos (`/admin/products`)

- Criar, editar (preço, peso, descrição, foto), ocultar/mostrar na loja e excluir. O nome segue o rótulo: "Sabor, 112g". Produto novo ganha id legível (`morango-112g`); editar não muda o id.
- **Foto:** o navegador recorta em quadrado pelo centro e reduz para 800×800 JPEG antes de enviar. O servidor confere o tipo pelos primeiros bytes (JPG, PNG ou WebP, até 2 MB) e guarda na tabela `produto_fotos`, porque a Netlify não guarda arquivos enviados. Cada foto nova tem outro endereço (`/fotos/<id>`), então pode ficar em cache para sempre.
- **Excluir x ocultar:** produto com vendas ou produções não pode ser excluído (pedidos e fichas apontam para ele): oculte. Oculto, ele some da vitrine e não pode ser comprado (o pedido responde 422 "indisponível"), mas o histórico continua certo.
- A vitrine usa o catálogo em cache (tag `produtos`): toda mudança no painel o expira na hora (`revalidateTag("produtos", { expire: 0 })`).

### Financeiro (`/admin/financial`)

- Um mês por vez (setas para navegar): frase-resumo ("entraram X e saíram Y: sobraram Z"), **De onde veio o dinheiro** (site, feira/balcão, frete, valor médio, por sabor), **Para onde foi** (despesas por categoria), **Últimos 12 meses** até o mês escolhido (gráfico ou tabela; clicar no mês abre ele) e **Movimentações do mês** (vendas e despesas na mesma lista).
- Mesma conta do painel de Despesas: vendas pagas pela data do pedido (horário de Brasília), despesas pela data da compra.

### Produção (`/admin/production`)

O caderno de produção com as contas feitas. Regras em `src/lib/producao.ts` (puro; testado em `testes/producao.test.ts` com a Receita 1 do caderno).

- **Insumos** (ingredientes e embalagens), contados em g, mL ou un. **Estoque = compras − usos + ajustes**. As compras entram pela tela de **Despesas** ("Entra no estoque da produção como…"): kg → g e L → mL são convertidos sozinhos; pacote/caixa pedem "quantos g vieram". Custo médio = total pago ÷ total comprado. "Controlar estoque" desligado = o que vem de casa (limão do quintal): entra na produção com custo informado (0) e não aparece como falta.
- **Produção (lote):** data, sabor do catálogo, ingredientes e embalagens usados, custos do dia (gás, energia, água, mão de obra — sugeridos a partir da última produção) e potes que renderam. O custo de cada item é o custo médio das compras **congelado no dia** (compras depois não mudam lotes antigos), ou o valor informado. Custo por pote = (ingredientes + custos do dia) ÷ potes + embalagem ÷ potes; margem = preço de venda do catálogo − custo por pote. Mostra a sobra de cada insumo depois do lote e avisa quando falta compra lançada.
- **Produzir de novo** (`/admin/production/new?de=<id>`) copia um lote; **Corrigir** (`?editar=<id>`) refaz o lote mantendo o custo do dia original nos itens que continuam; excluir devolve o que foi usado ao estoque.
- **Financeiro × Produção (não somar):** o Financeiro e as Despesas são o **caixa** (o que entrou e saiu). A Produção é o **custo por pote**: reaproveita as compras já lançadas em Despesas e soma custos que não são saída de caixa (mão de obra). Um relatório que some Despesas com custo de produção conta o mesmo gasto duas vezes.
- **Planilhas:** "Baixar planilha" (CSV que abre no Excel: `;`, vírgula decimal, acentos; texto que começa com `=`, `+`, `-` ou `@` ganha um `'` na frente para o Excel não executá-lo como fórmula) no estoque e nas produções. A ficha do lote tem "Imprimir" (o menu do painel não sai na impressão).
- Tabelas `insumos`, `producoes`, `producao_itens`, `producao_custos`, `ajustes_estoque` e as colunas `expenses.insumo_id` / `quantidade_base` (migração `20261017140000_producao`, só aditiva; o comentário no topo dela diz como desfazer).

## O que ainda é simulado / pendente

- **Pagamento:** PIX real pelo Mercado Pago (ver "Como o PIX funciona"); falta o teste com dinheiro de verdade. Devolução de valor é feita no painel do Mercado Pago. Os pedidos pendentes com PIX vencido não são cancelados sozinhos (o admin cancela).
- **Receita pela data de pagamento:** hoje usa a data de criação (como pedido). Para pagamento tardio/cancelamento retroativo, guardar `paidAt` e um histórico de status.
- **Admin:** falta uma tela de detalhe do pedido (itens e endereço) para despachar, e edição de produtos (preço, estoque, fotos). A tela de produtos é só leitura.
- **Estoque de potes à venda:** não existe (a Produção controla só os insumos); ao implementar, decrementar com `UPDATE … WHERE estoque >= qtd` dentro da transação do pedido.
- **Despesas, o que falta (pede migração):** histórico de quem editou/excluiu (hoje só `criado_por_id`, e a exclusão apaga a linha); controle de edição simultânea (`atualizado_em` + 409, como no status do pedido); `Idempotency-Key` no lançamento (rede caiu depois de gravar → reenvio duplica); despesas planejadas/recorrentes; anexar nota fiscal; categorias editáveis com uma "natureza" fixa (insumo, embalagem, imposto…) para custo por pote e relatório do MEI.
- **Sessão e conta:** revogação de sessão no servidor (versão de sessão por usuário), MFA/CAPTCHA no login do admin, e verificação de e-mail no cadastro (hoje a mensagem "e-mail já cadastrado" permite descobrir quem tem conta).
- **Preços do carrinho:** ficam no navegador e só são conferidos ao finalizar (o servidor responde 409 e o checkout mostra o que mudou). Dá para revalidar via `GET /api/products` ao abrir o carrinho.
- **Logo:** recortado do painel de identidade, com o fundo removido (`public/marca/logo*.png`, 430 px de largura). Fica bom na tela, mas um arquivo vetorial (SVG/PDF) do logo deixaria tudo nítido em qualquer tamanho: substitua mantendo os caminhos de `logos` em `src/design-system.ts`.
- **Fotos dos produtos:** Pimenta, Abacaxi com Pimenta, Abacaxi e Maracujá têm foto real (`public/produtos/<id>.jpg`); o Morango ainda usa uma ilustração no formato do rótulo (`public/produtos/morango-112g.svg`). Para trocar: recorte a foto em quadrado de 700 px (pote centralizado, com cerca de 62% da largura, como as outras), salve como `public/produtos/<id>.jpg`, inclua o id em `COM_FOTO` no `prisma/seed.ts` e rode `npm run db:seed`. Fotos originais recebidas ficam em `fotos-originais/`.
- **Catálogo:** Pimenta (112g), Abacaxi com Pimenta (125g), Abacaxi (125g), Morango (112g) e Maracujá (125g), com o peso como no rótulo real. Morango ainda sem foto do rótulo: confirme o peso. **Preços provisórios** em `prisma/seed.ts`: ajuste para os reais. O id do produto leva o peso (`maracuja-125g`); se o peso mudar, troque o id também no banco (a FK de `order_items` tem `ON UPDATE CASCADE`).
- **Login:** não há "Esqueci minha senha" (recuperação por e-mail) nem "Entrar com Google"; a referência visual tinha os dois. Precisam de envio de e-mail e de OAuth.
- **Limites de taxa e cache:** em memória (por instância). Com várias instâncias, use Redis/Upstash e `cacheHandlers` do Next para o cache de produtos.
- **Fontes:** vêm do Google Fonts via `@import` no `globals.css`, como pedido. `next/font` as hospedaria localmente (mais rápido e sem requisição externa).
