# ConectaLab — Smart Lockers Universitários (IoT Digital Twin)

Plataforma Web/Mobile de empréstimo e aluguel de objetos de uso comum na faculdade (**Calculadora Científica**, **Jaleco**, **Powerbank** e **Carregador USB-C**) integrada a armários inteligentes em tempo real via WebSockets (`< 500ms`).

---

## 📚 Documentação de Engenharia e Produto

1. **[Especificação Funcional e de Produto (`docs/SPEC.md`)](./docs/SPEC.md)**  
   Value Proposition Canvas, Personas, Regras de Negócio (`RN01-RN04`), Requisitos Não Funcionais (`RNF01-RNF06`), User Stories em Gherkin (`RF01-RF17`), Máquinas de Estado e Wireframes.
2. **[Documento de Arquitetura Técnica (`docs/ADT.md`)](./docs/ADT.md)**  
   ADRs, Stack Tecnológica Single-Port (`:3000`), Diagramas C4 e de Sequência, Modelo Físico SQLite (`WAL Mode`), Contratos REST e Protocolo WebSocket Real-Time.
3. **[Plano de Trabalho Paralelo para 3 Devs (`docs/WORKPLAN_3_DEVS.md`)](./docs/WORKPLAN_3_DEVS.md)**  
   Matriz de isolamento de arquivos (zero conflito de Git), uso de `USE_MOCK` e Cards detalhados (`FE-01..05`, `BE1-01..06`, `BE2-01..05`).
4. **[Documentação Técnica e de Testes — Dev 2 (`docs/DEV2_BACKEND_CORE.md`)](./docs/DEV2_BACKEND_CORE.md)**  
   Referência completa do Core Comercial (SQLite `WAL`, JWT `HS256`, Catálogo, Reserva Atômica `RN02`, PIX Mock, Prorrogação, Vistoria 2m, Worker TTL) e catálogo dos 39 testes automatizados (unitários e regressão E2E).

---

## 🚀 Como Rodar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. Inicializar/Resetar o banco SQLite (data/conectalab.db) com os Seeds
npm run db:reset

# 3. Executar suíte de testes unitários e de regressão (Dev 2)
npm test

# 4. Rodar em modo desenvolvimento (Servidor Fastify :3000 + Vite :5173)
npm run dev
```

### Modo Apresentação Ao Vivo (Porta Única `:3000` + Cloudflare Tunnel)

```bash
# 1. Compilar o Frontend e subir o Servidor Unificado na porta 3000
npm run start:demo

# 2. Em outro terminal, abrir o túnel HTTPS/WSS gratuito para acesso via 4G/5G
cloudflared tunnel --url http://localhost:3000
```

- **App do Aluno (Mobile):** `http://localhost:3000/app`
- **Simulador do Armário (Projetor):** `http://localhost:3000/locker`
- **Painel Admin (Backoffice):** `http://localhost:3000/admin`
