import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { initDatabase } from './db/connection.js';
import { registerWsConnection } from './ws/broker.js';
import { startTtlWorker } from './workers/ttl-worker.js';
import { authRoutes } from './routes/auth.routes.js';
import { lockersRoutes } from './routes/lockers.routes.js';
import { rentalsRoutes } from './routes/rentals.routes.js';
import { paymentsRoutes } from './routes/payments.routes.js';
import { unlockRoutes } from './routes/unlock.routes.js';
import { adminRoutes } from './routes/admin.routes.js';

/**
 * Servidor Unificado ConectaLab (HTTP REST + WebSocket + Static SPA na Porta :3000)
 * Compatível com Cloudflare Quick Tunnel (`cloudflared tunnel --url http://localhost:3000`)
 * Responsável Exclusivo: Dev 3 (Backend B — Card BE2-01)
 */
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function bootstrapServer() {
  // 1. Inicializa o banco SQLite em modo WAL e aplica seeds se necessário
  initDatabase();

  const app = Fastify({
    logger: {
      transport: undefined,
      level: 'info',
    },
  });

  // 2. Habilita CORS e WebSockets na mesma porta HTTP
  await app.register(cors, { origin: true });
  await app.register(websocket);

  // 3. Endpoint WebSocket Real-Time (/ws)
  app.get('/ws', { websocket: true }, (socket, req) => {
    const query = (req.query as Record<string, string>) || {};
    registerWsConnection(socket, {
      clientType: query.clientType,
      lockerId: query.lockerId,
      userId: query.userId,
    });
  });

  // 4. Registra todas as rotas da API REST (Dev 2 + Dev 3 sem conflito de arquivos)
  await app.register(authRoutes);
  await app.register(lockersRoutes);
  await app.register(rentalsRoutes);
  await app.register(paymentsRoutes);
  await app.register(unlockRoutes);
  await app.register(adminRoutes);

  // 5. Serve o Frontend compilado (dist/client) na mesma origem para o Cloudflare Tunnel (ADR-001)
  const clientDistPath = path.resolve(process.cwd(), 'dist', 'client');
  if (fs.existsSync(clientDistPath)) {
    await app.register(fastifyStatic, {
      root: clientDistPath,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) {
        return reply.status(404).send({
          error: 'ROUTE_NOT_FOUND',
          message: `Rota ${req.method} ${req.url} não encontrada.`,
        });
      }
      return reply.sendFile('index.html');
    });
  }

  // 6. Inicia Worker de Expiração de Reservas (TTL - RF16)
  startTtlWorker();

  // TODO: [BE2-01] Dev 3 pode adicionar middlewares de autenticação ou healthcheck adicional aqui.
  await app.listen({ port: PORT, host: HOST });
  console.log(`\n🚀 [ConectaLab Server] Rodando em http://localhost:${PORT}`);
  console.log(`🔌 [WebSocket Broker] Escutando em ws://localhost:${PORT}/ws`);
  console.log(`☁️  [Cloudflare Tunnel] Comando: cloudflared tunnel --url http://localhost:${PORT}\n`);
}

bootstrapServer().catch((err) => {
  console.error('Erro fatal ao iniciar o servidor ConectaLab:', err);
  process.exit(1);
});
