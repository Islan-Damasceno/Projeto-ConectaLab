# Plano de Trabalho Paralelo para 3 Desenvolvedores (WORKPLAN) — ConectaLab

> **Projeto:** ConectaLab — Smart Lockers Universitários  
> **Objetivo:** Permitir que **3 desenvolvedores trabalhem 100% em paralelo** desde o minuto zero, sem bloqueios de dependência e com **zero conflito de merge no Git**.  
> **Documentos de Referência:** [`docs/SPEC.md`](file:///C:/Script/Pessoal/ConectaLab/docs/SPEC.md) e [`docs/ADT.md`](file:///C:/Script/Pessoal/ConectaLab/docs/ADT.md)

---

## 1. Divisão da Equipe e Isolamento de Arquivos no Git (Ownership Matrix)

Para evitar conflitos de merge (*Git Merge Conflicts*), a arquitetura foi particionada em **fronteiras estritas de arquivos**. **Nenhum arquivo de implementação é compartilhado entre dois desenvolvedores.**

> [!IMPORTANT]
> **Decisão Crítica de Isolamento no Backend:**  
> As rotas de locação (`/api/rentals/*`) foram divididas fisicamente em **dois arquivos distintos**:
> - `src/server/routes/rentals.routes.ts` (**Dev 2**): Criação de reserva (`POST /api/rentals`), consulta (`GET /api/rentals/:id`), prorrogação (`extend`) e vistoria (`report-issue`).
> - `src/server/routes/unlock.routes.ts` (**Dev 3**): Comandos físicos IoT de abertura para retirada (`POST /api/rentals/:id/unlock`) e abertura para devolução (`POST /api/rentals/:id/return-unlock`).

### 1.1. Matriz de Propriedade de Arquivos (Quem edita o quê)

| Caminho / Arquivo | Dono Exclusivo | Regra de Modificação |
| :--- | :---: | :--- |
| `src/shared/types.ts` | **Tech Lead (Commit Zero)** | **CONGELADO (Read-Only).** Contém todos os contratos. Alterações exigem alinhamento dos 3 devs. |
| `src/client/**` | **Dev 1 (Frontend)** | Exclusivo do **Dev 1**. Nenhum dev de Backend altera arquivos dentro de `src/client/`. |
| `src/server/db/**` | **Dev 2 (Backend A)** | Exclusivo do **Dev 2** (Dev 3 apenas importa `db` de `connection.ts` em modo leitura/escrita SQL). |
| `src/server/routes/auth.routes.ts` | **Dev 2 (Backend A)** | Exclusivo do **Dev 2** (RF01). |
| `src/server/routes/lockers.routes.ts` | **Dev 2 (Backend A)** | Exclusivo do **Dev 2** (RF02, RF11). |
| `src/server/routes/rentals.routes.ts` | **Dev 2 (Backend A)** | Exclusivo do **Dev 2** (RF03, RF04, RF07, RF09, RF10). |
| `src/server/routes/payments.routes.ts` | **Dev 2 (Backend A)** | Exclusivo do **Dev 2** (RF05). |
| `src/server/workers/ttl-worker.ts` | **Dev 2 (Backend A)** | Exclusivo do **Dev 2** (RF16). |
| `src/server/index.ts` | **Dev 3 (Backend B)** | Exclusivo do **Dev 3** (Já registra os plugins de rotas dos Devs 2 e 3 no Commit Zero). |
| `src/server/ws/broker.ts` | **Dev 3 (Backend B)** | Exclusivo do **Dev 3** (Dev 2 apenas importa e chama as funções já exportadas). |
| `src/server/routes/unlock.routes.ts` | **Dev 3 (Backend B)** | Exclusivo do **Dev 3** (RF06, RF08, RN03, RN04, RNF01, RNF05). |
| `src/server/routes/admin.routes.ts` | **Dev 3 (Backend B)** | Exclusivo do **Dev 3** (RF14, RF15, RF17). |

### 1.2. Padrão de Branches e Integração Contínua Local
- Branch principal: `main` (contém o **Commit Zero** compilável).
- Branches de trabalho por Desenvolvedor:
  - **Dev 1:** `feat/fe-client-ui`
  - **Dev 2:** `feat/be1-commercial-core`
  - **Dev 3:** `feat/be2-realtime-iot`

---

## 2. Contratos de Interface e Desacoplamento entre os Times

### 2.1. Como o Dev 1 (Frontend) trabalha sem esperar os Devs 2 e 3 (`USE_MOCK`)
No arquivo [`src/client/lib/api.ts`](file:///C:/Script/Pessoal/ConectaLab/src/client/lib/api.ts), foi implementada uma camada de abstração com a chave `USE_MOCK`:
1. Enquanto `USE_MOCK = true` (ou quando o servidor backend não estiver rodando), todas as chamadas de `api.*` operam sobre um **Estado Mockado Persistido no `localStorage`** com os mesmos dados do `seeds.sql`.
2. Além disso, o mock utiliza a API nativa **`BroadcastChannel('conectalab_mock_ws')`** do navegador! Isso significa que o **Dev 1** pode abrir duas abas no seu próprio navegador (`http://localhost:5173/app` e `http://localhost:5173/locker`), clicar em "Destravar Armário" na aba do aluno e ver a porta abrir na aba do Simulador imediatamente, mesmo com o Backend desligado!
3. Na hora de integrar com os Devs 2 e 3, basta mudar `USE_MOCK = false` (ou clicar no botão de alternância Mock/Real API na barra de desenvolvimento).

### 2.2. Como o Dev 2 (Backend A) dispara eventos WebSocket sem esperar o Dev 3 (`broker.ts`)
No arquivo [`src/server/ws/broker.ts`](file:///C:/Script/Pessoal/ConectaLab/src/server/ws/broker.ts), o **Commit Zero** já exporta funções prontas e tipadas com *Null-Safety*:
- `broadcastEvent(event, payload)`
- `sendToClient(target, event, payload)`
- `broadcastCatalogStockUpdated(lockerId, door)`
- `sendRentalStatusUpdated(userId, payload)`

O **Dev 2** simplesmente importa essas funções em `rentals.routes.ts`, `payments.routes.ts` e `ttl-worker.ts` e as invoca normalmente após cada `COMMIT` no SQLite. Se nenhum cliente WebSocket estiver conectado durante os testes unitários de API do Dev 2, o broker apenas registra o log no console sem lançar erro.

### 2.3. Como o Dev 3 (Backend B) consome o Banco SQLite sem conflitar com o Dev 2
O arquivo [`src/server/db/connection.ts`](file:///C:/Script/Pessoal/ConectaLab/src/server/db/connection.ts) já entrega a instância `db` (`better-sqlite3`) configurada com `WAL` e `schema.sql` + `seeds.sql` carregados automaticamente. O **Dev 3** pode testar o comando de `unlock`, o evento `DOOR_CLOSED_EVENT` e o `master-unlock` manipulando diretamente os registros pré-populados pelo seed ou pelo script `npm run db:reset`.

---

## 3. Quadro de Tarefas (Cards Estilo Trello)

---

### 🎨 TRILHA 1: DEV 1 — Frontend (Mobile App, Simulador Digital Twin & Admin)
**Diretório Exclusivo:** `src/client/**`

---

#### Card `FE-01`: Autenticação Institucional e Catálogo em Tempo Real (Telas 1 e 2)
- **Prioridade:** MVP | **Requisitos:** RF01, RF02, RF03, RNF03, RNF06
- **Arquivos Afetados:**
  - `src/client/pages/app/LoginPage.tsx`
  - `src/client/pages/app/CatalogPage.tsx`
- **Descrição Técnica:**
  1. Implementar o formulário de login rápido (`Nome`, `RA`, `E-mail Institucional`) com validação client-side para `@faculdade.edu.br` / `@aluno.faculdade.edu.br`.
  2. Incluir 2 botões de preenchimento rápido (*1-Click Demo Fill*: "Lucas Andrade" e "Beatriz Silva") para agilizar a apresentação ao vivo.
  3. Na tela de Catálogo, permitir selecionar o Bloco/Armário, listar os cards das portas com badges coloridos por status (`AVAILABLE`, `RESERVED`, `OCCUPIED_RENTED`, `IN_PREPARATION`, `MAINTENANCE`).
  4. Em portas `AVAILABLE`, exibir seletor de plano (`Por Hora` vs `Diária`), seletor de quantidade (`1` a `8`) e cálculo automático do preço em Reais (`R$`).
  5. Escutar o evento WebSocket `CATALOG_STOCK_UPDATED` para atualizar a disponibilidade das portas em tempo real sem recarregar a página.
- **Critérios de Aceite:**
  - [ ] E-mails fora do domínio institucional exibem erro amigável e não avançam.
  - [ ] Trocar entre "Por Hora" e "Diária" atualiza o preço total instantaneamente no botão de reserva.
  - [ ] Quando uma porta muda de status via WebSocket, o card correspondente atualiza seu badge e bloqueia/libera o botão na hora.

---

#### Card `FE-02`: Checkout PIX Mock e Painel de Locação Ativa (Telas 3 e 4)
- **Prioridade:** MVP | **Requisitos:** RF04, RF05, RF06, RF07, RF08, RN03, RN04, RNF06
- **Arquivos Afetados:**
  - `src/client/pages/app/CheckoutPixPage.tsx`
  - `src/client/pages/app/ActiveRentalPage.tsx`
- **Descrição Técnica:**
  1. Na `CheckoutPixPage`, exibir os dados da porta reservada, um cronômetro regressivo de expiração da reserva (`reservationExpiresAt`), um QR Code visual, o código "PIX Copia e Cola" com botão de copiar e o botão de destaque **"⚡ Simular Confirmação do Banco (PIX Pago)"**.
  2. Ao aprovar o PIX (via clique no botão ou recebimento do evento WS `RENTAL_STATUS_UPDATED`), redirecionar automaticamente para `/app/rental/:rentalId`.
  3. Na `ActiveRentalPage`, renderizar a interface conforme a máquina de estados da locação:
     - Se `PAID_READY_FOR_PICKUP`: exibir card de destaque com Bloco e Número da Porta e o botão gigante pulsante **"🔓 DESTRAVAR ARMÁRIO (PORTA #XX)"**.
     - Após clicar em destravar (`lockState === 'UNLOCKED'`): exibir alerta *"Porta Aberta! Retire seu objeto e feche a porta no armário"*.
     - Quando a porta for fechada no Simulador (`status === 'IN_USE'`): iniciar o **Cronômetro Regressivo** até `expectedReturnAt` e habilitar o botão **"📦 Devolver Objeto"**.
     - Ao clicar em **"Devolver Objeto"**: chamar `api.returnUnlockRental(id)`, exibir instrução *"Guarde o objeto na Porta #XX e feche a porta"* e, quando receber `status === 'COMPLETED'`, exibir tela de recibo de conclusão.
- **Critérios de Aceite:**
  - [ ] O botão "Destravar Armário" nunca fica habilitado se o status for `AWAITING_PAYMENT` (RN03).
  - [ ] O fechamento da porta no Simulador (`/locker`) transiciona automaticamente a tela do celular para o cronômetro regressivo sem precisar dar F5.

---

#### Card `FE-03`: Funcionalidades Extras do Aluno (Prorrogação e Vistoria Expressa 2 min)
- **Prioridade:** Extra | **Requisitos:** RF09, RF10
- **Arquivos Afetados:**
  - `src/client/pages/app/ActiveRentalPage.tsx`
- **Descrição Técnica:**
  1. Adicionar na `ActiveRentalPage` (quando `status === 'IN_USE'`) o botão **"⏱️ Prorrogar Horário (+1h / +1 Dia)"**, que chama `api.extendRental()` e atualiza o cronômetro regressivo.
  2. Adicionar o botão **"⚠️ Reportar Defeito / Vistoria Expressa"** com um sub-cronômetro regressivo visível apenas durante os primeiros **120 segundos** após `firstUnlockedAt` (`inspectionWindowEndsAt`).
  3. Ao confirmar o reporte de defeito (ex: "Item descarregado/avariado"), chamar `api.reportRentalIssue()`, cancelar a cobrança e instruir o fechamento da porta.
- **Critérios de Aceite:**
  - [ ] Passados 2 minutos da primeira abertura, o botão de Vistoria Expressa fica desabilitado com indicação de prazo de vistoria encerrado.
  - [ ] A prorrogação soma imediatamente o tempo contratado ao cronômetro da tela.

---

#### Card `FE-04`: Simulador do Armário — Digital Twin no Projetor + Web Audio API
- **Prioridade:** MVP (Crítico para Apresentação) | **Requisitos:** RF11, RF12, RF13, RNF01
- **Arquivos Afetados:**
  - `src/client/pages/locker/LockerSimulatorPage.tsx`
  - `src/client/lib/solenoid-audio.ts`
- **Descrição Técnica:**
  1. Construir a interface em *Dark Mode* de alto contraste otimizada para tela cheia no projetor (`F11`).
  2. Incluir barra superior com seletor de Armário (`Bloco B` / `Bloco A`), indicador de conexão WebSocket (`ONLINE / OFFLINE`), botão **"🔊 Ativar Som do Armário (Testar Trava)"** (que desbloqueia o `AudioContext` do navegador) e gerador/exibidor de link para acesso mobile.
  3. Renderizar o Grid de Portas Numeradas:
     - Estado `LOCKED`: Borda vermelha, ícone de cadeado fechado (`🔒 TRANCADO`), status comercial do estoque e nome do objeto.
     - Estado `UNLOCKED`: Borda verde neon pulsante, ícone de cadeado aberto (`🔓 ABERTO`), animação visual de porta destravada e o botão de destaque **"🤚 Simular Fechamento Físico da Porta #XX"**.
  4. Ao receber `DOOR_UNLOCK_COMMAND` via WebSocket:
     - Mudar o estado visual da porta para `UNLOCKED` (verde) imediatamente (`< 500ms`).
     - Chamar `playSolenoidUnlockSound()` em `solenoid-audio.ts` (som mecânico sintetizado de impacto metálico + zumbido de bobina 60Hz).
     - Enviar automaticamente pelo WebSocket o evento `DOOR_OPENED_ACK` com a latência medida em milissegundos.
  5. Ao clicar em **"🤚 Simular Fechamento Físico da Porta"**:
     - Reproduzir som de porta fechando (`playDoorCloseSound()`), voltar visual para `LOCKED` (vermelho) e emitir o evento WebSocket `DOOR_CLOSED_EVENT` para o servidor.
  6. Exibir no rodapé um console de **Telemetria em Tempo Real** listando os últimos eventos WebSocket recebidos/enviados com timestamps de milissegundos.
- **Critérios de Aceite:**
  - [ ] A mudança visual de `TRANCADO` (vermelho) para `ABERTO` (verde) + efeito sonoro ocorre instantaneamente ao receber `DOOR_UNLOCK_COMMAND`.
  - [ ] O botão "Simular Fechamento Físico da Porta" só aparece nas portas que estão fisicamente abertas (`UNLOCKED`).

---

#### Card `FE-05`: Painel Administrativo, Liberação de Higienização e Master Unlock
- **Prioridade:** MVP & Extra | **Requisitos:** RF14, RF15, RF16, RF17
- **Arquivos Afetados:**
  - `src/client/pages/admin/AdminDashboardPage.tsx`
- **Descrição Técnica:**
  1. Exibir KPIs no topo (Total de Portas, Disponíveis, Em Uso, Em Preparação, Em Manutenção).
  2. Exibir tabela gerencial com todas as portas e botões de operação rápida por linha:
     - **"🔓 Destravar Porta (Master)"** (RF15): Aciona `api.adminMasterUnlock(doorId)`, abrindo a porta no Simulador do Projetor imediatamente.
     - **"✅ Concluir Higienização/Recarga"** (RF17): Visível quando a porta está `IN_PREPARATION` (ex: após devolução de Jaleco ou Powerbank), voltando o status para `AVAILABLE`.
     - **"🛠️ Alternar Manutenção"** (RF15): Alterna entre `MAINTENANCE` e `AVAILABLE`.
  3. Incluir botões globais de suporte à apresentação: **"🔄 Resetar Demo (Seeds)"** e **"⏱️ Forçar Varredura de Expiração TTL (RF16)"**.
- **Critérios de Aceite:**
  - [ ] Clicar em "Master Unlock" no Admin abre a respectiva porta no Simulador (`/locker`) em tempo real.
  - [ ] Clicar em "Concluir Higienização/Recarga" libera o item imediatamente no catálogo do aluno.

---

### ⚙️ TRILHA 2: DEV 2 — Backend A (Core Comercial, SQLite, Reserva, PIX & TTL)
**Diretórios Exclusivos:** `src/server/db/**`, `auth.routes.ts`, `lockers.routes.ts`, `rentals.routes.ts`, `payments.routes.ts`, `ttl-worker.ts`

---

#### Card `BE1-01`: Camada de Persistência SQLite (WAL Mode) e Seeds de Demonstração
- **Prioridade:** MVP | **Requisitos:** RNF04, RN01
- **Arquivos Afetados:**
  - `src/server/db/connection.ts`
  - `src/server/db/schema.sql`
  - `src/server/db/seeds.sql`
- **Descrição Técnica:**
  1. Garantir que a inicialização do banco execute `PRAGMA journal_mode = WAL;` e `PRAGMA foreign_keys = ON;`.
  2. Validar as constraints das 7 tabelas (`users`, `lockers`, `items`, `doors`, `rentals`, `payments`, `door_events`) e criar funções utilitárias de transação imediata (`runImmediateTransaction`).
  3. Garantir que o comando `npm run db:reset` limpe o estado atual e recarregue os seeds iniciais sem erros.
- **Critérios de Aceite:**
  - [ ] Rodar `npm run db:reset` cria `data/conectalab.db` com os 2 armários (Bloco A e B) e as 6 portas vinculadas 1:1 aos itens.

---

#### Card `BE1-02`: Endpoint de Autenticação Institucional Rápida (RF01)
- **Prioridade:** MVP | **Requisitos:** RF01, RNF05
- **Arquivos Afetados:**
  - `src/server/routes/auth.routes.ts`
- **Descrição Técnica:**
  1. Implementar `POST /api/auth/quick-login` recebendo `{ name, ra, email }`.
  2. Validar via Regex se o e-mail termina com `@faculdade.edu.br` ou `@aluno.faculdade.edu.br` (case-insensitive). Caso contrário, retornar `HTTP 400` com `{ error: 'INVALID_INSTITUTIONAL_EMAIL', message: '...' }`.
  3. Fazer *Upsert* do aluno na tabela `users` (se o `email` já existir, retornar o usuário existente atualizando `name`/`ra`; se não existir, inserir novo `STUDENT`).
  4. Verificar se o aluno já possui alguma locação ativa (`status IN ('AWAITING_PAYMENT', 'PAID_READY_FOR_PICKUP', 'IN_USE', 'AWAITING_RETURN_CLOSE')`) e retornar `activeRentalId` junto com o `token` e o objeto `user`.
- **Critérios de Aceite:**
  - [ ] Login com `@faculdade.edu.br` responde `200 OK` em `< 50ms`.
  - [ ] Login com `@gmail.com` retorna `400 Bad Request`.

---

#### Card `BE1-03`: Endpoints de Listagem de Armários e Catálogo em Tempo Real (RF02)
- **Prioridade:** MVP | **Requisitos:** RF02, RF11, RF14, RN01
- **Arquivos Afetados:**
  - `src/server/routes/lockers.routes.ts`
- **Descrição Técnica:**
  1. Implementar `GET /api/lockers` retornando todos os armários com contagem agregada de portas totais e portas com `status = 'AVAILABLE'`.
  2. Implementar `GET /api/lockers/:lockerId/catalog` fazendo `JOIN` entre `doors`, `items` e (opcionalmente) `rentals` + `users` para informar o ocupante atual quando a porta estiver alugada.
- **Critérios de Aceite:**
  - [ ] Retorna lista ordenada por `door_number ASC` com preços em centavos e flag `requiresPreparation`.

---

#### Card `BE1-04`: Reserva Atômica com Bloqueio de Estoque e Cálculo de Preço (RF03, RF04, RN02)
- **Prioridade:** MVP | **Requisitos:** RF03, RF04, RF07, RN01, RN02
- **Arquivos Afetados:**
  - `src/server/routes/rentals.routes.ts`
- **Descrição Técnica:**
  1. Implementar `POST /api/rentals` recebendo `{ doorId, planType, durationUnits }`.
  2. Abrir uma transação `db.transaction(...).immediate()`:
     - Consultar a porta e o item vinculado (`SELECT ... FROM doors JOIN items ... WHERE doors.id = ?`).
     - Se `door.status !== 'AVAILABLE'`, abortar e retornar `HTTP 409 Conflict` (`DOOR_NOT_AVAILABLE`) — cumprindo **RN02**.
     - Calcular `totalAmountCents`: se `HOURLY`, `hourly_price_cents * durationUnits`; se `DAILY`, `daily_price_cents * durationUnits`.
     - Definir `reservationExpiresAt` para `NOW() + 10 minutos`.
     - Inserir registro em `rentals` com `status = 'AWAITING_PAYMENT'`.
     - Inserir registro em `payments` com `status = 'PENDING'` e payload EMV `pix_copy_paste`.
     - Atualizar `doors` para `status = 'RESERVED'` e `current_rental_id = rental.id`.
     - Inserir log em `door_events` (`STATUS_CHANGE`).
  3. Após o commit, chamar `broadcastCatalogStockUpdated(lockerId, updatedDoor)` do `broker.ts`.
  4. Implementar `GET /api/rentals/:rentalId` para consulta do painel de locação ativa (RF07).
- **Critérios de Aceite:**
  - [ ] Duas chamadas simultâneas para a mesma `doorId` resultam em exatamente uma resposta `201 Created` e uma `409 Conflict`.
  - [ ] O evento WebSocket `CATALOG_STOCK_UPDATED` é disparado para atualizar o catálogo dos demais alunos.

---

#### Card `BE1-05`: Webhook PIX Simulado e Rotas Extras (Prorrogação e Vistoria 2 min)
- **Prioridade:** MVP (PIX) & Extra (RF09, RF10) | **Requisitos:** RF05, RF09, RF10, RN03
- **Arquivos Afetados:**
  - `src/server/routes/payments.routes.ts`
  - `src/server/routes/rentals.routes.ts`
- **Descrição Técnica:**
  1. Em `payments.routes.ts`, implementar `POST /api/payments/pix-mock-webhook` recebendo `{ rentalId }`:
     - Em transação SQLite: validar que a locação está `AWAITING_PAYMENT`, atualizar `payments.status = 'PAID'`, `rentals.status = 'PAID_READY_FOR_PICKUP'` e `doors.status = 'AWAITING_PICKUP'`.
     - Invocar `sendRentalStatusUpdated` e `broadcastCatalogStockUpdated` no `broker.ts`.
  2. Em `rentals.routes.ts`, implementar `POST /api/rentals/:rentalId/extend` (RF09):
     - Validar que a locação está `IN_USE`, somar horas/dias ao `expected_return_at` e ao `total_amount_cents`, e notificar via WebSocket.
  3. Em `rentals.routes.ts`, implementar `POST /api/rentals/:rentalId/report-issue` (RF10):
     - Validar que o reporte ocorreu em até 120 segundos após `first_unlocked_at`.
     - Cancelar a locação (`status = 'CANCELLED'`, `cancel_reason = 'ISSUE_REPORTED'`), estornar pagamento (`REFUNDED`), colocar a porta em `MAINTENANCE` e disparar comando de abertura caso a porta já esteja trancada para devolução imediata do item avariado.
- **Critérios de Aceite:**
  - [ ] O webhook PIX muda o status da locação para `PAID_READY_FOR_PICKUP` e notifica o celular via WebSocket.
  - [ ] O reporte de defeito após 2 minutos da abertura retorna `HTTP 400` (`INSPECTION_WINDOW_EXPIRED`).

---

#### Card `BE1-06`: Worker de Expiração Automática de Reserva (TTL — RF16)
- **Prioridade:** Extra | **Requisitos:** RF16, RN02
- **Arquivos Afetados:**
  - `src/server/workers/ttl-worker.ts`
- **Descrição Técnica:**
  1. Implementar a função `expireOverdueReservations()` que busca todas as locações com `status = 'AWAITING_PAYMENT'` cujo `reservation_expires_at < NOW()`.
  2. Para cada reserva vencida, em transação: mudar `rentals.status = 'CANCELLED'`, `cancel_reason = 'EXPIRED_TTL'`, `payments.status = 'EXPIRED'` e devolver `doors.status = 'AVAILABLE'`, `current_rental_id = NULL`.
  3. Disparar `broadcastCatalogStockUpdated` e `sendRentalStatusUpdated` para cada reserva expirada.
  4. Executar automaticamente a cada 10 segundos em background via `setInterval`.
- **Critérios de Aceite:**
  - [ ] Reservas não pagas até o vencimento liberam a porta automaticamente para `AVAILABLE`.

---

### 🔌 TRILHA 3: DEV 3 — Backend B (Servidor Unificado, WebSockets, IoT Unlock & Admin)
**Diretórios Exclusivos:** `src/server/index.ts`, `src/server/ws/broker.ts`, `unlock.routes.ts`, `admin.routes.ts`

---

#### Card `BE2-01`: Servidor Unificado Single-Port (`:3000`) Pronto para Cloudflare Tunnel
- **Prioridade:** MVP | **Requisitos:** RNF01, RNF02, RNF04
- **Arquivos Afetados:**
  - `src/server/index.ts`
- **Descrição Técnica:**
  1. Configurar o servidor Fastify escutando em `0.0.0.0:3000` (compatível com localhost e `cloudflared`).
  2. Registrar `@fastify/cors`, `@fastify/websocket` (rota `/ws`) e `@fastify/static` (servindo `dist/client` com fallback `setNotFoundHandler` para `index.html` nas rotas SPA `/app/*`, `/locker` e `/admin`).
  3. Registrar todos os módulos de rotas sob `/api` e iniciar o `startTtlWorker()`.
- **Critérios de Aceite:**
  - [ ] Tanto `http://localhost:3000/api/lockers` quanto `ws://localhost:3000/ws` respondem na mesma porta `3000`.

---

#### Card `BE2-02`: Broker WebSocket Real-Time e Handlers do Simulador (`DOOR_OPENED_ACK` e `DOOR_CLOSED_EVENT`)
- **Prioridade:** MVP (Crítico) | **Requisitos:** RF11, RF12, RF13, RF17, RNF01
- **Arquivos Afetados:**
  - `src/server/ws/broker.ts`
- **Descrição Técnica:**
  1. Gerenciar o pool de conexões WebSocket separando clientes por `clientType` (`LOCKER`, `STUDENT`, `ADMIN`), `lockerId` e `userId`.
  2. Ao conectar um `LOCKER`, atualizar `lockers.is_online = 1` no SQLite e enviar imediatamente o evento `LOCKER_CONNECTED`.
  3. Processar mensagens recebidas do Simulador (`/locker`):
     - **`DOOR_OPENED_ACK` (RF12):** Gravar log de telemetria em `door_events` com a latência reportada pelo projetor (`renderLatencyMs`).
     - **`DOOR_CLOSED_EVENT` (RF13, RF07, RF08, RF17):** Quando o apresentador clicar em "Simular Fechamento Físico da Porta":
       - Atualizar `doors.lock_state = 'LOCKED'`.
       - Se a locação vinculada estava em `PAID_READY_FOR_PICKUP` (Retirada concluída): mudar `rentals.status = 'IN_USE'`, preencher `picked_up_at = NOW()` e `expected_return_at = NOW() + duração`, e mudar `doors.status = 'OCCUPIED_RENTED'`.
       - Se a locação vinculada estava em `AWAITING_RETURN_CLOSE` (Devolução concluída): mudar `rentals.status = 'COMPLETED'`, preencher `returned_at = NOW()`, limpar `doors.current_rental_id = NULL` e verificar `item.requires_preparation` (**RF17**): se `1` (Jaleco ou Powerbank), mudar `doors.status = 'IN_PREPARATION'`; se `0` (Calculadora ou Carregador), mudar `doors.status = 'AVAILABLE'`.
       - Emitir imediatamente `RENTAL_STATUS_UPDATED` para o celular do aluno e `CATALOG_STOCK_UPDATED` para todas as telas!
- **Critérios de Aceite:**
  - [ ] O fechamento da porta na retirada muda a locação para `IN_USE` e inicia o cronômetro no celular.
  - [ ] O fechamento da porta na devolução de um Jaleco/Powerbank coloca a porta em `IN_PREPARATION` automaticamente (RF17).

---

#### Card `BE2-03`: Comando Remoto de Destravamento para Retirada (RF06, RN03, RNF05)
- **Prioridade:** MVP (Crítico) | **Requisitos:** RF06, RN03, RNF01, RNF05
- **Arquivos Afetados:**
  - `src/server/routes/unlock.routes.ts`
- **Descrição Técnica:**
  1. Implementar `POST /api/rentals/:rentalId/unlock`.
  2. Validar segurança (**RNF05** e **RN03**):
     - O usuário autenticado (`x-user-id` ou Bearer token) deve ser o titular (`rental.user_id === userId`). Caso contrário, retornar `403 Forbidden`.
     - O status da locação deve ser `PAID_READY_FOR_PICKUP` (ou `IN_USE` caso precise reabrir a porta nos primeiros segundos). Se estiver `AWAITING_PAYMENT`, retornar `403 Forbidden`.
  3. Atualizar no SQLite: `doors.lock_state = 'UNLOCKED'`, definir `rentals.first_unlocked_at = COALESCE(first_unlocked_at, NOW())` e gravar evento `UNLOCK_PICKUP` em `door_events`.
  4. Disparar via WebSocket (`sendToLocker` + broadcast) o evento **`DOOR_UNLOCK_COMMAND`** (`actionContext: 'PICKUP'`, `playSoundEffect: true`) em `< 500ms`.
- **Critérios de Aceite:**
  - [ ] Dispara `DOOR_UNLOCK_COMMAND` para o Simulador em `< 50ms` após a chamada HTTP.
  - [ ] Nega com `403 Forbidden` qualquer tentativa de destravamento sem pagamento confirmado ou por usuário diferente do titular.

---

#### Card `BE2-04`: Comando Remoto de Destravamento para Devolução (RF08, RN04)
- **Prioridade:** MVP | **Requisitos:** RF08, RN04, RNF05
- **Arquivos Afetados:**
  - `src/server/routes/unlock.routes.ts`
- **Descrição Técnica:**
  1. Implementar `POST /api/rentals/:rentalId/return-unlock`.
  2. Validar que o aluno é o titular da locação e que `rental.status === 'IN_USE'`.
  3. Atualizar `rentals.status = 'AWAITING_RETURN_CLOSE'`, `doors.lock_state = 'UNLOCKED'` e registrar `UNLOCK_RETURN` em `door_events`.
  4. Disparar via WebSocket o evento **`DOOR_UNLOCK_COMMAND`** (`actionContext: 'RETURN'`, `playSoundEffect: true`) para a mesma porta de origem (**RN04**).
- **Critérios de Aceite:**
  - [ ] Destrava exclusivamente a porta de origem vinculada à locação e aguarda o evento `DOOR_CLOSED_EVENT` do Simulador para encerrar o contrato.

---

#### Card `BE2-05`: Rotas Administrativas, Master Unlock e Liberação Pós-Preparo (RF14, RF15, RF17)
- **Prioridade:** MVP & Extra | **Requisitos:** RF14, RF15, RF16, RF17
- **Arquivos Afetados:**
  - `src/server/routes/admin.routes.ts`
- **Descrição Técnica:**
  1. Implementar `POST /api/admin/doors/:doorId/master-unlock` (RF15):
     - Atualizar `doors.lock_state = 'UNLOCKED'`, gravar `MASTER_UNLOCK` em `door_events` e enviar `DOOR_UNLOCK_COMMAND` (`actionContext: 'MASTER_OVERRIDE'`) para o Simulador.
  2. Implementar `PATCH /api/admin/doors/:doorId/status` (RF14, RF15, RF17):
     - Permitir alterar o status de uma porta sem locação ativa (ex: de `IN_PREPARATION` ou `MAINTENANCE` para `AVAILABLE`) e emitir `CATALOG_STOCK_UPDATED`.
  3. Implementar `POST /api/admin/maintenance/expire-ttl` (aciona manualmente `expireOverdueReservations()` para demonstrar o RF16 ao vivo sem esperar 10 minutos) e `POST /api/admin/demo/reset` (reseta o banco para os seeds originais em 1 clique).
- **Critérios de Aceite:**
  - [ ] O botão Master Unlock abre qualquer porta no projetor com auditoria registrada em `door_events`.
  - [ ] O endpoint de reset restaura todas as portas para `AVAILABLE` / `LOCKED` instantaneamente durante os ensaios da apresentação.
