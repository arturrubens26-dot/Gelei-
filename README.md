# Geleiô — Geleias Artesanais

E-commerce com área administrativa. Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Prisma 7 · PostgreSQL.

## Rodando localmente

> **Atalho no Windows:** dê dois cliques em `iniciar.bat` (liga o banco e o site e abre o navegador) e em `parar.bat` (desliga). O login de teste do admin está em `ACESSO-LOCAL.txt` (arquivo fora do Git).

```bash
npm install
cp .env.example .env        # preencha SESSION_SECRET e SEED_ADMIN_PASSWORD (veja os comentários)
                            # para o pagamento de demonstração: PAGAMENTOS_SIMULADOS="true"

npm run db:dev              # terminal 1: Postgres local embutido do Prisma (deixe aberto)
# cole no .env a URL "postgres://..." que ele mostrar, em DATABASE_URL
# e descomente DATABASE_POOL_MAX="1" (esse banco executa uma consulta por vez; veja "Banco local sem vagas")

npm run db:deploy           # aplica as migrações em prisma/migrations
npm run db:seed             # produtos de exemplo + usuário admin
npm run dev                 # http://localhost:3000
```

O admin criado pela seed usa `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` do `.env` (o `.env` é um arquivo oculto na raiz; no VS Code abra com `Ctrl+P` e digite `.env`; não confunda com o `.env.example`, onde a senha fica em branco). **Para definir ou trocar a senha do admin**, rode `npm run admin:senha`: você digita a nova senha no terminal (ela não aparece na tela) e ela passa a valer; o `SEED_ADMIN_PASSWORD` do `.env` só vale na criação e depois é ignorado. O seed **não** promove uma conta comum já existente a admin: se o e-mail já estiver cadastrado como cliente, ele falha de propósito.
Para usar outro Postgres (Neon, Supabase, RDS…), basta trocar `DATABASE_URL` e **não** definir `DATABASE_POOL_MAX`.

> **O seed só roda no banco local.** Se o host da `DATABASE_URL` não for `localhost` nem `127.0.0.1`, o `npm run db:seed` se recusa antes de conectar: rodado de uma máquina de desenvolvimento com a URL do Neon, ele sobrescreveria preços e descrições e mexeria no kit da loja no ar. Para um banco remoto de propósito (a primeira carga do Neon, por exemplo): `$env:SEED_PERMITIR_REMOTO='1'; npm run db:seed` (PowerShell). Nesse caso ele só **cria** o que falta, sem sobrescrever nada. O kit nunca é mostrado nem ocultado pelo seed (só no painel); se ele não existir, nasce oculto, a menos que `SEED_KIT_VISIVEL=1`.

> **Criando migrações novas:** o `prisma migrate dev` precisa de um banco-sombra e o Postgres embutido (PGlite) não lida bem com ele. Gere o SQL com
> `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, salve em `prisma/migrations/<data>_<nome>/migration.sql` e aplique com `npm run db:deploy`.

> **Testes:** `npm test` (ou `npm run test:unit`) roda os testes das regras puras com `node:test`: valores digitados, meses, despesas, produção, kits, entrega e telefone, verso dos produtos, redefinição de senha, etapas do pagamento e as regras da InfinitePay (`testes/infinitepay.test.ts`). O teste ponta a ponta do pagamento (`npm run test:pagamento`) roda contra a InfinitePay falsa: veja "Como o pagamento funciona".

> **Banco local "sem vagas" ("Connection terminated unexpectedly", `ConnectionClosed`, `ECONNRESET`):** o Postgres embutido do `prisma dev` aceita 10 conexões, mas tem um defeito (no `@electric-sql/pglite-socket` 0.1.3, que vem com o Prisma; a 0.2.13 ainda tem): cada conexão que cai sem se despedir (processo morto com a conexão aberta: o site fechado no X no meio de uma consulta, um worker no fim do build, um script interrompido) ocupa uma vaga até o banco reiniciar. Sem vagas, o site mostra "This page couldn't load" e o terminal mostra esse erro. Para quase não acontecer, `src/lib/db.ts` usa um único pool por processo e, com `DATABASE_POOL_MAX="1"`, fecha a conexão ociosa em 500 ms; o `iniciar.bat` reinicia o banco a cada início. Se acontecer, reinicie só o banco: `npx prisma dev stop geleio` e depois `npm run db:dev` (ou `parar.bat` e `iniciar.bat`). Os dados ficam.

> **"used `new Date()` ... while prerendering" no terminal:** com `cacheComponents`, toda página dinâmica passa antes por um prerender "de runtime", e ler o relógio nele (depois de `cookies()`) aborta esse prerender com esse erro. O `jwtVerify` da sessão lê o relógio; por isso `lerSessao` (`src/lib/auth/sessao.ts`) chama `await io()` (de `next/cache`) antes dele: no prerender o código para ali sem erro e, numa requisição de verdade, segue na hora. Código novo que leia `new Date()`, `Date.now()` ou `Math.random()` depois de `cookies()`/`headers()` numa página precisa do mesmo `await io()` antes.

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
   - `APP_URL`: o endereço do site (`https://geleio.netlify.app`). É a única fonte do retorno e do aviso da InfinitePay e do link de senha nova;
   - `IP_HEADER_CONFIAVEL`: `x-nf-client-connection-ip`;
   - `DATABASE_POOL_MAX`: `3`;
   - `INFINITEPAY_HANDLE`: `geleio`;
   - `INFINITEPAY_API_KEY`: a chave do Checkout Integrado (`inchk_...`), marcada como **secret**;
   - `INFINITEPAY_WEBHOOK_SECRET` (recomendada): segredo do token do aviso, 32+ caracteres aleatórios, **secret**. Sem ela, vale o `SESSION_SECRET`.
   
   Não defina `PAGAMENTOS_SIMULADOS` nem `INFINITEPAY_API_URL`. Apague as antigas `MERCADOPAGO_*`, se existirem (o servidor só avisa).
5. **Admin do site no ar:** um e-mail seu e uma senha forte, nunca o admin de teste deste computador.
6. **Pagamento (InfinitePay):** sem `INFINITEPAY_HANDLE`, `INFINITEPAY_API_KEY` e `APP_URL` com https, o checkout mostra "Pedidos pelo site em breve" e a API recusa pedidos (503) sem gravá-los. Então dá para publicar o código antes da chave. Para abrir a loja:
   - No app InfinitePay: *Vendas → Checkout → Configurações → Habilitar Checkout Integrado → criar API Key* (nome `site-geleio`). Ela aparece **uma vez só**: copie direto para a Netlify. Nunca no chat, no Git ou em print.
   - A chave é obrigatória: só com ela o link ganha validade (`valid_until`) e aceita um pagamento só (`single_payment`).
   - Não há o que configurar de webhook no app: cada link leva o próprio endereço de aviso.
   - **Antes de abrir:** o ensaio com dinheiro real (abaixo) e depois um pedido real de valor baixo, do começo ao fim, com devolução pelo app.

### Como o pagamento funciona (`src/lib/pagamentos.ts`)

A cliente paga com **PIX ou cartão até 12x** na página segura da InfinitePay (Checkout Integrado) e volta para a loja. Regras puras em `src/lib/infinitepay-regras.ts` e `src/lib/pagamentos-regras.ts`; as chamadas HTTP, só em `src/lib/infinitepay.ts`.

- **Link por tentativa.** O pedido abre um link (`POST /links`) com `order_nsu = ped-<pedido>-<n>`, os potes, os kits e a "Entrega" em centavos (a soma é conferida com o total antes de enviar; nunca há desconto), validade de **60 min** e `single_payment`. Tabela `pagamentos`: um pedido pode ter vários links (até 10). "Pagar" de novo devolve o mesmo link enquanto ele vale por mais de 5 min; o vencido vira `CANCELADO` no nosso banco. Duas chamadas ao mesmo tempo abrem um link só (índice único).
- **Parcelas:** `assured_installments = 0`: à vista e PIX sem acréscimo; no parcelado, a cliente paga os juros, que a InfinitePay mostra antes de confirmar. Por isso o valor pago (`valor_pago`) pode ser maior que o do pedido; o faturamento continua sendo o total do pedido.
- **O pedido só vira PAGO pelo `payment_check` feito por ESTE servidor** com a própria chave e a referência do nosso banco. Ele exige `success` e `paid`, `amount` igual ao total em centavos (sem tolerância), `paid_amount >= amount`, `pix` ou `credit_card`, de 1 a 12 parcelas (PIX só 1), e ainda moeda BRL e o mesmo `order_nsu` se a resposta trouxer esses dois (a API real não traz: veja o ensaio). Divergência nunca vira PAGO: fica pendente (`status_gateway = divergente:<motivo>`), o painel mostra o alerta **"Pago com divergência"** (`PAGO_COM_DIVERGENCIA`) e a cliente vê "Confirmando: fale com a loja" sem prazo, sem botão de pagar de novo (o POST de pagamento responde 409). A dona confere no app e, se o dinheiro estiver certo, marca como pago.
- **A API amarra a transação ao pedido consultado** (ensaio de 2026-10-22): a mesma transação, consultada com outro `order_nsu`, responde `success=true, paid=false, amount=0`; com o `order_nsu` certo e o slug errado, `success=false`. Como o servidor sempre consulta com o `order_nsu` do **nosso banco** (nunca o que veio da cliente), uma transação de outro link da loja, mesmo de valor igual, nunca confirma este pedido. Por isso o **retorno do navegador confirma sozinho**, sem esperar o aviso (veja abaixo). `paid=false` nunca é divergência nem gera alerta: é "ainda não pago" ou transação de outro pedido.
- **"Transação não encontrada" (HTTP 4xx) logo depois do pagamento** é tratada como passageira por 30 min desde o primeiro aviso (o webhook responde 400 e a InfinitePay repete); depois disso, o candidato é descartado.
- **O aviso (webhook) não é assinado.** Cada link leva `APP_URL/api/webhooks/infinitepay/<referência>/<token>`, com `token = HMAC-SHA256(INFINITEPAY_WEBHOOK_SECRET ou, sem ela, SESSION_SECRET, referência)`. Sem o token certo: 401 e nada é gravado. Aviso com o slug de outra fatura é ignorado **antes** de gravar (um aviso falso não toma o lugar do verdadeiro). Com o token, a transação do corpo vira só um *candidato* e dispara a conferência. A rota responde 200 (confirmado, divergente ou recusado de vez) ou 400 (a InfinitePay não respondeu, ainda não acha a transação, ou **qualquer falha nossa**, banco incluído: ela repete o aviso). Trocar o segredo invalida o aviso dos links abertos (até 60 min); eles continuam pelo retorno, pela tela e pelo plano C.
- **Aviso que não fecha** (InfinitePay fora, chave recusada, resposta estranha): a cliente continua vendo "Confirmando" **sem prazo** e não consegue abrir outro link (409 "Não pague de novo"). Só sai disso quando a conferência recusa o candidato de vez, ou quando a dona marca pago ou cancela. Depois de 30 min, o painel mostra **"Aviso não conferido"** (`AVISO_NAO_CONFERIDO`).
- **Retorno do navegador** (`/pagamento/retorno?capture_method&transaction_id&transaction_nsu&slug&order_nsu&receipt_url`): o `order_nsu` da query só localiza a cobrança. Se a sessão é da dona do pedido, grava a hora (`pagamentos.retorno_em`, que segura "Confirmando" e bloqueia link novo por **30 min**), reconfere o candidato do aviso (se houver) e confere a transação e o slug da query no `payment_check` com o `order_nsu` do nosso banco, pelas regras de sempre (valor exato, `paid_amount >= amount`, método, parcelas). Antes de confirmar, o **canário de amarração**: a mesma transação e slug consultados com um `order_nsu` que nunca existe precisam responder "não pago"; se o canário disser "pago" (a API não amarrou a transação ao pedido) ou falhar (tempo, 5xx, 4xx), o retorno não confirma nem grava nada e o aviso decide. O comprovante só é gravado se for `https://recibo.infinitepay.io/<uuid da própria transação>`. Aprovada, o pedido vira **PAGO** ali mesmo, com os mesmos alertas de sempre (pago após cancelamento, em dobro, depois da baixa manual) e o `UNIQUE(gateway, transacao_nsu)`. Recusada (`paid=false`, `success=false`, 4xx, divergência, transação já usada, canário), nada é gravado além do `retorno_em`: é dado da cliente. Se a cobrança tiver o slug da fatura gravado, o slug da query precisa ser o mesmo (senão nem consulta). Sem sessão ou de outra conta, não grava nada. Sempre responde 303 para `/order-confirmation/<id>?retorno=1`, sem a transação na URL. A página do pedido pergunta a cada 5 s, e o servidor confere de novo no máximo a cada 8 s.
- **Exigir o `order_nsu` na resposta:** a constante `EXIGIR_ORDER_NSU_NA_CONFERENCIA` em `src/lib/pagamentos.ts` fica `false`: a API real não devolve o `order_nsu`, mas amarra pelo que enviamos. Ligada, todo "pago" viraria divergência; só ligue se a InfinitePay passar a devolver o campo.
- **Antes de gravar um link novo,** a linha do pedido é travada (`FOR UPDATE`) e o status conferido de novo: não nasce link depois de um cancelamento.
- **A mesma transação nunca quita duas cobranças:** `UNIQUE(gateway, transacao_nsu)`, gravada só depois de confirmada. Se o link trouxe o slug da fatura, o candidato precisa ter o mesmo slug (a API real não devolve o slug em `/links`: aí quem amarra é o `payment_check`).
- **Prazo:** o pedido pendente pode ser pago por até **48 h**. Depois disso, ele "expira" sem mudar de status: não abre link novo (409), a cliente vê "Faça um novo pedido" e a dona vê o selo "Expirado". Os expirados não contam no teto de 20 pendentes por conta nem nos "pendentes" do painel. Pagamento confirmado de um pedido expirado vira PAGO normalmente: o dinheiro entrou.
- **Cancelar não cancela o link** (a API não tem isso): o link ainda aceita pagamento por até 1 hora, e o painel avisa. Pago depois do cancelamento, ou pago duas vezes, a cobrança fica aprovada, o pedido não muda e o painel mostra o alerta **"Pago após o cancelamento"** ou **"Pago em dobro"**. A devolução é sempre pelo app InfinitePay (não há API).
- **Plano C:** se nada chegar (a cliente fechou a aba e o aviso falhou), a dona confere o dinheiro no app e marca o pedido como pago no painel. Isso encerra os links abertos (que ainda aceitam pagamento por até 1 hora na InfinitePay, e o painel avisa). Se depois disso a InfinitePay confirmar um pagamento do site, o painel mostra **"Confirmado após marcar como pago"** (`CONFIRMADO_APOS_BAIXA_MANUAL`): confira no app se a cliente não pagou duas vezes.
- **Alertas do painel** (`PedidoAdminDTO.pagamento.alerta`, um por pedido, nesta prioridade): `PAGO_APOS_CANCELAMENTO`, `PAGO_EM_DOBRO`, `CONFIRMADO_APOS_BAIXA_MANUAL`, `PAGO_COM_DIVERGENCIA` e `AVISO_NAO_CONFERIDO`. Os dois últimos somem quando a dona marca pago ou cancela.
- **Logs:** só ids e referências; nunca a chave, nome, e-mail ou endereço da cliente (que vão no link para a InfinitePay: consta na política de privacidade).
- **Teste local sem dinheiro:** `node testes/infinitepay-falso.mjs` sobe uma InfinitePay falsa em `127.0.0.1:4010`, que imita o formato real do ensaio (`/links` só com `url`, `payment_check` sem `order_nsu` e amarrado ao pedido consultado), com uma página que paga por PIX, cartão 3x com juros, valor errado ou aviso falso. Suba o site com `INFINITEPAY_API_URL=http://127.0.0.1:4010`, `INFINITEPAY_HANDLE=geleio`, `INFINITEPAY_API_KEY=inchk_falsa`, `APP_URL=http://localhost:3100`, `PAGAMENTOS_SIMULADOS=false` e `IP_HEADER_CONFIAVEL=x-forwarded-for` (`npx next dev -p 3100`), e rode `npm run test:pagamento` (cerca de 100 verificações, inclusive o retorno sozinho marcando PAGO e a transação de outro link apresentada no retorno, recusada pela amarração; portas diferentes com `E2E_BASE` e `E2E_PORTA_FALSA`; se o site tiver `INFINITEPAY_WEBHOOK_SECRET`, rode o teste com a mesma; ele mesmo sobe a falsa, recusa banco que não seja local e apaga o que criou).

#### Ensaio com dinheiro real (antes de abrir a loja)

A InfinitePay não tem ambiente de teste, e a documentação não fixa o nome do campo do link na resposta, se vem o slug, nem o formato exato do `payment_check` (o resultado do primeiro ensaio está no fim desta seção). O site lê isso de forma tolerante, mas é preciso confirmar com pagamentos reais (R$ 1 a R$ 10, devolvidos pelo app). O ensaio leva uns 30 minutos, neste computador, no PowerShell. Os passos 7 e 8 usam a rota de ensaio do site publicado, então rode-os depois de publicar o código. Anote o resultado de cada passo:

1. Ponha a chave no `.env` **só durante o ensaio**: `INFINITEPAY_HANDLE="geleio"` e `INFINITEPAY_API_KEY="inchk_..."`.
2. **O link e o slug:** `npm run ensaio:infinitepay -- criar 100` cria um link de **R$ 1,00** e mostra o link, os **nomes** dos campos da resposta, o host e **se veio o slug**. Se aparecer "o site NÃO reconheceu o link", pare e mande os nomes dos campos (não os valores). Anote o `order_nsu` (link A).
3. **O `payment_check` no PIX:** abra o link, pague com **PIX** e clique em **"Continuar"**: o navegador abre a loja com `?ensaio=1&...`. Copie o endereço inteiro e rode `npm run ensaio:infinitepay -- retorno "<endereço>"`. O esperado: `success=true, paid=true, amount=100, paid_amount=100, capture_method=pix`. Anote se veio `order_nsu` na resposta e o que veio em `installments`.
4. **"Não encontrada" logo depois de pagar:** no passo 3, rode o `retorno` **assim que** a página mostrar "pago" (em menos de 10 s). Se vier HTTP 404 ou `success=false` e, um minuto depois, `paid=true`, anote: o site já trata o 4xx como passageiro por 30 min, mas um `success=false` passageiro exigiria mudar a regra.
5. **O `payment_check` no cartão 2x:** `criar 1000` (R$ 10,00, ou o menor valor que a InfinitePay aceitar parcelar), pague no cartão em **2x** e rode o `retorno`. O esperado: `amount=1000`, `paid_amount` maior (os juros) e `installments=2`. Anote o `order_nsu` (link B), a transação e o slug.
6. **Amarração com o pedido:** confira a transação do link B dizendo que é do link A: `npm run ensaio:infinitepay -- conferir <order_nsu do A> <transaction_nsu do B> <slug do B>`. Se a resposta for `success=false` ou `paid=false` (ou outro `order_nsu`), a API amarra a transação ao pedido; se vier `paid=true`, ela NÃO amarra, e o retorno do navegador NÃO pode confirmar sozinho (pare e reveja `confirmarCobranca`).
7. **Repetição do aviso depois de 400:** `criar 100 --aviso` manda o aviso para a rota de ensaio do site publicado, que só registra no log e responde **400**. Pague e veja no log de funções da Netlify (*Logs → Functions*, procure "aviso de ENSAIO") quantas vezes e com que intervalo a InfinitePay repetiu. Se não repetir, o plano C (marcar pago à mão) vira o caminho normal quando o aviso falhar.
8. **O token não aparece para a cliente:** com o link do passo 7 aberto, veja o código da página (`Ctrl+U`) e procure (`Ctrl+F`) "ensaio" e "webhooks". Nada pode aparecer. Faça o mesmo na página do comprovante.
9. **Pagar de novo um link pago ou vencido:** abra outra vez o link já pago do passo 3: a InfinitePay precisa recusar (`single_payment`). Depois rode `criar 100 --minutos 2`, espere 3 minutos e tente pagar: precisa recusar (`valid_until`).
10. Devolva todos os pagamentos pelo app e **apague a chave do `.env`**.
11. Registre aqui o formato real (nomes dos campos de `/links`, do retorno e do `payment_check`) e as respostas dos passos 4, 6, 7 e 9. Se o campo do link ou o host forem outros, ajuste `lerRespostaDoLink` e `urlDaInfinitePay` em `src/lib/infinitepay-regras.ts`.
12. Por fim: um pedido real de valor baixo pelo site, do começo ao fim (o aviso e o retorno devem marcar PAGO), e devolução pelo app.

**Resultado do ensaio de 2026-10-22** (PIX de R$ 1, devolvido):

- **Passo 2, `POST /links`:** HTTP 200 com **só `{ url }`**, sem slug. Host `checkout.infinitepay.io`, caminho `/geleio/<código>`. O código do caminho (ex.: `aKVH6PwBdw`) **não é** o slug da fatura (o retorno trouxe `slug=sKXhSekbqG`). Por isso `faturaSlug` fica vazio na criação e a amarração é feita pelo `payment_check`.
- **Passo 3, retorno e `payment_check` no PIX:** o retorno traz `capture_method`, `transaction_id` (igual ao `transaction_nsu`, um UUID), `transaction_nsu`, `slug`, `order_nsu` e `receipt_url` (`https://recibo.infinitepay.io/<uuid>`). O `payment_check` respondeu `success=true, paid=true, amount=100, paid_amount=100, installments=1, capture_method=pix`, **sem `order_nsu` e sem moeda**.
- **Passo 6, amarração (com a transação do PIX):** outro `order_nsu` com a transação e o slug certos → `success=true, paid=false, amount=0, paid_amount=0, installments=null, capture_method=null`; o `order_nsu` certo com o slug errado (o código do link) → `success=false`. **A API amarra a transação ao pedido e ao slug.** Daí a mudança: o retorno do navegador passou a confirmar o pedido (`EXIGIR_ORDER_NSU_NA_CONFERENCIA` continua `false`).
- **Passo 9, link pago ou vencido:** o link do PIX já pago, reaberto, recusa ("não deu certo"; a página não traz dados do link, como um código inexistente): `single_payment` funciona. O link de 2 minutos recusou do mesmo jeito depois de vencer: `valid_until` funciona. Um link ainda válido traz na página `single_payment: true`, `valid_until` (com `-03:00`) e `state: null`.
- **Pendentes:**
  - passo 4 ("não encontrada" logo depois de pagar): não testado (a consulta foi feita minutos depois);
  - passo 5 (cartão 2x): não feito, a dona não tinha cartão. O formato do cartão (`paid_amount` maior que `amount`, `installments=2`) e a amarração no cartão estão cobertos **só pela InfinitePay falsa**: acompanhe o primeiro pagamento em cartão em produção;
  - passos 7 (repetição do aviso depois de 400) e 8 (token escondido da cliente): precisam do site publicado. O passo 7 custa mais um PIX de R$ 1. O formato real do aviso (webhook) também ainda não foi visto.

No plano grátis, cada publicação gasta créditos: junte as mudanças antes de enviar ao GitHub.

## Estrutura

| Caminho | O que é |
| --- | --- |
| `src/design-system.ts` | Cores, tipografia, símbolos e padrão gingham. **Fonte única da marca**; o `tailwind.config.ts` lê daqui. |
| `src/app/(loja)/` | Loja: home, `/products`, `/checkout`, `/order-confirmation/[id]` (com Header, Footer e carrinho). |
| `src/app/(acesso)/login` | Tela de login, fora do layout da loja: painel com o formulário em "vidro" e, à direita, o pote real de Maracujá que abre sozinho (`src/components/AnimatedJamJar.tsx`, framer-motion): a tampa desenrosca e sobe, a colher de pau tira geleia e uma gota pinga. Repete ao focar um campo (no máximo a cada 8 s). Tem botão "Pausar animação"; com "reduzir movimento" no sistema fica parada no quadro final. As camadas da foto ficam em `public/login/` e saem de `scripts/recortar-pote-login.mjs`. |
| `src/app/(admin)/admin/` | Painel: `/admin/dashboard`, `/orders` (e `/orders/nova`, venda presencial), `/financial`, `/expenses` (despesas), `/production` (lotes e estoque de insumos; `/production/[id]` é a ficha do lote), `/products`. |
| `src/app/api/` | Rotas da API (produtos, entrega, auth, endereços, pedidos, admin). |
| `src/lib/` | Regras de negócio sem framework: `frete`, `pedidos`, `kits-regras`, `admin`, `pagamentos`, `status`, `limites`, validação (zod). |
| `prisma/` | `schema.prisma`, migrações e `seed.ts`. |

## API

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /api/products` | público | lista os produtos |
| `POST /api/delivery/calculate` | público | `{ cep }` → CEP de Teresina (640…): valida o CEP (cep-promise) e devolve a taxa do painel; fora da área, 422 com `foraDaArea` |
| `POST /api/auth/register` · `login` · `logout` · `GET /api/auth/me` | — | conta e sessão (cookie httpOnly) |
| `GET/POST /api/addresses` | logado | endereços salvos; o CEP é conferido (existência, cidade e UF); limite de 10 por conta |
| `POST /api/orders` | logado | cria o pedido PENDENTE com potes avulsos (`itens`) e/ou caixas de kit (`kits: [{ kitId, quantidade, sabores: [{ productId, quantidade }] }]`; os dois podem faltar, mas não ambos vazios). **Recalcula preço, peso, frete e a composição do kit no servidor**. Aceita o cabeçalho `Idempotency-Key` (reenviar a mesma chave com o mesmo conteúdo devolve o mesmo pedido, 200; com outro conteúdo, 422) e `totalEsperadoCentavos` (se o total calculado for outro, responde 409 com os preços e pesos atuais dos produtos e dos kits). Produto ou kit oculto: 422 com `indisponiveis` e `kitsIndisponiveis`; caixa com potes a mais ou a menos: 400 em `kits.N.sabores` |
| `GET /api/orders/[id]/pagamento` | logado | `SituacaoPagamentoDTO`: etapa (`PAGAR`, `CONFIRMANDO`, `PAGO`, `EXPIRADO`, `CANCELADO`, `INDISPONIVEL`), prazo para pagar e a última cobrança. Na etapa `CONFIRMANDO`, confere de novo na InfinitePay (no máximo a cada 8 s) |
| `POST /api/orders/[id]/pagamento` | logado | `{}` → `{ cobranca }` com o `checkoutUrl` da InfinitePay (o mesmo link, se ainda vale). 409 já pago, expirado (48 h) ou não pendente; 429; 502 InfinitePay fora; 503 pagamento desligado |
| `GET /pagamento/retorno` | navegador | volta da InfinitePay: confere a transação (se a sessão é da dona do pedido) e responde 303 para a confirmação do pedido |
| `POST /api/webhooks/infinitepay/[referencia]/[token]` | InfinitePay | aviso de pagamento: com o token HMAC certo, só dispara a conferência (`payment_check`); 401 sem ele |
| `POST /api/orders/[id]/simular-pagamento` | logado | demonstração: marca o próprio pedido como PAGO (só com `PAGAMENTOS_SIMULADOS=true` e sem a InfinitePay) |
| `POST /api/auth/esqueci-senha` · `POST /api/auth/redefinir-senha` | público | senha nova por e-mail (202 sempre igual; 404 sem SMTP) · troca a senha com o token do link (uso único, 60 min) |
| `POST /api/admin/clientes/[id]/link-senha` | **admin** | gera o link de senha nova de uma cliente, com a conferência de identidade registrada (nunca para admin) |
| `GET` · `PATCH /api/admin/entrega` | **admin** | taxa de entrega em Teresina, em centavos (0 a 10000) |
| `GET /api/admin/orders?status=&canal=` · `PATCH /api/admin/orders/[id]` | **admin** | lista/filtra pedidos (por status e canal `ONLINE`/`PRESENCIAL`) e muda o status (só transições válidas para o canal) |
| `GET /api/admin/orders/[id]` | **admin** | ficha do pedido: cliente, endereço, potes avulsos, caixas de kit com a composição e as fotos dos sabores, e o bloco "Separar…" (caixas a montar e potes por sabor) |
| `GET /api/admin/kits` · `PATCH /api/admin/kits/[id]` | **admin** | kits com caixas vendidas, faixa de economia e aviso de preço · edita (JSON `{ nome, descricao, precoCentavos, pesoCaixaGramas, ativo }`) ou mostra/oculta na loja (JSON `{ ativo }`). Sem criar nem excluir na v1 |
| `POST /api/admin/orders` | **admin** | lança uma **venda presencial** `{ itens: [{ productId, quantidade, precoUnitarioCentavos }], formaPagamento, status?: ENTREGUE \| PAGO, data?: "AAAA-MM-DD", clienteNome?, observacao? }`. Cabeçalho `Idempotency-Key` **obrigatório** (a mesma chave com o mesmo conteúdo devolve a venda já lançada, 200; com conteúdo diferente, 422). Limite de 200 por hora por admin |
| `GET /api/admin/financial-stats?mes=AAAA-MM` | **admin** | o Financeiro de um mês: resumo, entradas por canal e por sabor (com os potes vendidos em kit, `potesEmKits`), caixas de kit (`entradas.kits`: caixas, valor e desconto dado), saídas por categoria, 12 meses até ele e movimentações |
| `GET /api/admin/products` | **admin** | todos os produtos, inclusive os ocultos, com o histórico de vendas (avulsas e dentro de kits) e produções |
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

- **Entrega:** só em **Teresina** (CEP 64000-000 a 64099-999, prefixo 640), com **taxa fixa** (padrão R$ 15,00, editável no painel; tabela `config_loja`), ou **retirada grátis na loja** (endereço de `src/lib/dados-loja.ts`). Fora da área, o checkout sugere a retirada e o servidor recusa a entrega (422). O endereço é conferido contra o CEP (cidade e UF). Regras em `src/lib/entrega-regras.ts` (puro, testado em `testes/entrega.test.ts`). Pedido com retirada não tem endereço e tem frete 0 (CHECK `orders_canal_coerente`).
- **WhatsApp da cliente:** obrigatório em todo pedido online (`orders.telefone`, só dígitos, 10 ou 11 com DDD); fica também em `users.telefone` para preencher a próxima compra. O painel mostra o link `wa.me`.
- **Pagamento:** InfinitePay (PIX ou cartão até 12x). Veja "Como o pagamento funciona".
- **Senha esquecida:** sem e-mail configurado, "Esqueci minha senha" orienta a chamar a loja no Instagram (@ge.leio); a dona confere a identidade e gera um link em `/admin/clientes` (vale 60 min, uma vez só; o link novo invalida o anterior; nunca para contas de admin, que usam `npm run admin:senha`). Com SMTP, o mesmo link vai por e-mail. A troca de senha derruba as sessões antigas (`users.sessao_versao`).
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
- **Sessão:** JWT em cookie `httpOnly` + `SameSite=Lax` (`Secure` e prefixo `__Host-` em produção). Só o id do usuário vai no token; papel de admin é sempre lido do banco. Duração: 7 dias (cliente) e 12 h (admin). O token leva a versão de sessão da conta (`v`): trocar a senha (pelo link ou por `npm run admin:senha`) derruba todas as sessões antigas.
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

### Kits de presente ("Monte seu kit")

A cliente monta uma caixa de **3 potes** escolhendo os sabores (pode repetir: 3× Pimenta). Regras puras em `src/lib/kits-regras.ts` (servidor e navegador, testadas em `testes/kits.test.ts`); catálogo da loja em `src/lib/kits.ts`; painel em `src/lib/kits-admin.ts`.

- **Preço com desconto**, configurável no painel (padrão R$ 40,00 contra 3 avulsos de R$ 15,00). Se o kit não sair mais barato que os avulsos, o painel avisa, sem bloquear, e a loja esconde o "Economize".
- **Nasce oculto** (`ativo = false`): a dona confere preço e peso da caixa e ativa em `/admin/products`. Nome padrão "Kit Presente", editável. O `npm run db:seed` **não** mostra nem oculta o kit (a migração já o cria oculto; para testar `/kits` num banco novo, ative no painel).
- **Só os sabores marcados entram no kit.** Cada produto tem, no painel, a caixinha **"Pode entrar no Kit Presente"** (coluna `products.permitido_em_kit`): só os potes do tamanho padrão; um pote maior ou mais caro dentro da caixa sairia com desconto grande demais (um pote de 250 g a R$ 28 sairia 3 por R$ 40). Produto novo nasce **desmarcado**. O catálogo (`ProdutoDTO.permitidoEmKit`) diz quais são; o montador lista só esses, e o servidor recusa os outros com 400 em `kits.N.sabores` ("Kit Presente: Morango 250g não entra no kit."). A economia e os avisos do painel contam só os sabores à venda e marcados.
- **Avisos do painel** (não bloqueiam): o kit não sai mais barato que os avulsos; a economia máxima passa de **30% do preço do kit** (sinal de pote grande marcado por engano ou de preço do kit baixo demais); ou nenhum sabor à venda está marcado.
- **Peso da caixa vazia: 150 g (provisório)**, somado ao dos potes no frete. Troque pelo real no painel.
- **Limites:** 20 caixas por pedido (somando as linhas), 20 composições diferentes, até 6 potes por caixa na validação (o kit leva exatamente `potes`, conferido no servidor). Constantes em `src/lib/limites.ts`.
- **O servidor nunca confia no cliente:** lê do banco o preço do kit e o preço/peso de cada sabor; kit e sabores precisam estar ativos; a caixa precisa ter exatamente os potes do kit. Carrinho e servidor usam a mesma conta (`somarConteudo`, em centavos inteiros).
- **Pedido:** `order_items` continua só com os avulsos. Cada caixa vai em `order_kits` (mesma composição = uma linha com quantidade > 1; preço da caixa congelado) e a composição em `order_kit_sabores` (potes de cada sabor em UMA caixa, preço avulso do dia e a parte rateada do preço da caixa).
- **Rateio:** o preço da caixa é dividido entre os sabores proporcionalmente ao preço avulso × potes (maiores restos, em centavos; empate pelo id). A soma é sempre o preço da caixa, então no Financeiro a soma **por sabor** = entradas − frete. `entradas.kits` mostra caixas, valor e o desconto dado (avulsos do dia − preço da caixa).
- **Idempotência:** a mesma `Idempotency-Key` com os mesmos avulsos e as mesmas caixas (em qualquer ordem) devolve o pedido já criado; o mesmo sabor avulso de um lado e dentro de uma caixa do outro é outro conteúdo (422).
- **Sabor vendido só em kit** também tem histórico: o painel não oferece "Excluir" (oculte).
- **Fotos:** o kit não tem foto. A loja desenha a caixa e põe nas vagas as fotos REAIS dos sabores escolhidos. **Os mockups `fotos-originais/Kit-*.png` não são foto do kit** (logo errado "Gelêiô", 250 g e sabores que não existem) e **nunca vão para `public/`**.
- **Migração `20261021120000_kits`:** só cria tabelas (`kits`, `order_kits`, `order_kit_sabores`) e insere o kit padrão oculto; o código antigo continua funcionando com ela. **Na produção ainda não foi aplicada:** ensaie num branch do Neon e depois rode `npm run db:deploy:producao`, antes de publicar o código. Como desfazer está no topo do `migration.sql` (só enquanto nenhum pedido tiver kit).
- **Migração `20261021130000_kits_sabores_permitidos`:** acrescenta `products.permitido_em_kit` (default `false`) e marca os potes de 100 g a 130 g que já existem. Também não foi aplicada na produção: vai junto com a anterior (`npm run db:deploy:producao` aplica as duas). Como desfazer está no topo do `migration.sql`.

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

- **Pagamento:** InfinitePay (ver "Como o pagamento funciona"); falta a API Key e o ensaio com dinheiro de verdade, que confirma o formato real da API. Devolução de valor só pelo app InfinitePay. Os pedidos pendentes não são cancelados sozinhos: depois de 48 h eles só "expiram" (não abrem link novo). Quando houver estoque de potes, a expiração precisa virar um status de verdade, para devolver a reserva.
- **Avisos por e-mail** ("Recebemos seu pagamento", "Novo pedido pago"): dependem do SMTP. Até lá, a dona vê as vendas no app InfinitePay e no painel.
- **Receita pela data de pagamento:** hoje usa a data de criação (como pedido). Para pagamento tardio/cancelamento retroativo, guardar `paidAt` e um histórico de status.
- **Admin:** a ficha do pedido já tem API (`GET /api/admin/orders/[id]`); falta a tela (`/admin/orders/[id]`).
- **Kits, etapa 2:** venda presencial com kit; editar o kit pelo carrinho; foto real da caixa; banner; baixa da caixa como insumo da Produção; mensagem de presente; vários tipos de kit (criar/excluir no painel). Peso da caixa (150 g) ainda provisório. As migrações dos kits (`20261021120000_kits` e `20261021130000_kits_sabores_permitidos`) ainda não foram aplicadas na produção.
- **Estoque de potes à venda:** não existe (a Produção controla só os insumos); ao implementar, decrementar com `UPDATE … WHERE estoque >= qtd` dentro da transação do pedido.
- **Despesas, o que falta (pede migração):** histórico de quem editou/excluiu (hoje só `criado_por_id`, e a exclusão apaga a linha); controle de edição simultânea (`atualizado_em` + 409, como no status do pedido); `Idempotency-Key` no lançamento (rede caiu depois de gravar → reenvio duplica); despesas planejadas/recorrentes; anexar nota fiscal; categorias editáveis com uma "natureza" fixa (insumo, embalagem, imposto…) para custo por pote e relatório do MEI.
- **Sessão e conta:** revogação de sessão no servidor (versão de sessão por usuário), MFA/CAPTCHA no login do admin, e verificação de e-mail no cadastro (hoje a mensagem "e-mail já cadastrado" permite descobrir quem tem conta).
- **Preços do carrinho:** ficam no navegador e só são conferidos ao finalizar (o servidor responde 409 e o checkout mostra o que mudou). Dá para revalidar via `GET /api/products` ao abrir o carrinho.
- **Logo:** recortado do painel de identidade, com o fundo removido (`public/marca/logo*.png`, 430 px de largura). Fica bom na tela, mas um arquivo vetorial (SVG/PDF) do logo deixaria tudo nítido em qualquer tamanho: substitua mantendo os caminhos de `logos` em `src/design-system.ts`.
- **Fotos dos produtos:** Pimenta, Abacaxi com Pimenta, Abacaxi e Maracujá têm foto real (`public/produtos/<id>.jpg`); o Morango ainda usa uma ilustração no formato do rótulo (`public/produtos/morango-112g.svg`). Para trocar: recorte a foto em quadrado de 700 px (pote centralizado, com cerca de 62% da largura, como as outras), salve como `public/produtos/<id>.jpg`, inclua o id em `COM_FOTO` no `prisma/seed.ts` e rode `npm run db:seed`. Fotos originais recebidas ficam em `fotos-originais/`.
- **Catálogo:** Pimenta (112g), Abacaxi com Pimenta (125g), Abacaxi (125g), Morango (112g) e Maracujá (125g), com o peso como no rótulo real. Morango ainda sem foto do rótulo: confirme o peso. **Preços provisórios** em `prisma/seed.ts`: ajuste para os reais. O id do produto leva o peso (`maracuja-125g`); se o peso mudar, troque o id também no banco (a FK de `order_items` tem `ON UPDATE CASCADE`).
- **Login:** não há "Entrar com Google" (precisa de OAuth). O e-mail de senha nova está pronto e desligado até haver SMTP.
- **Limites de taxa e cache:** em memória (por instância). Com várias instâncias, use Redis/Upstash e `cacheHandlers` do Next para o cache de produtos.
- **Fontes:** vêm do Google Fonts via `@import` no `globals.css`, como pedido. `next/font` as hospedaria localmente (mais rápido e sem requisição externa).
