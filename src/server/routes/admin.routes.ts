import type { FastifyInstance } from 'fastify';
import type {
  AdminDashboardSummaryResponse,
  AdminMasterUnlockResponse,
  AdminUpdateDoorStatusRequest,
  AdminUpdateDoorStatusResponse,
  ApiErrorResponse,
} from '../../shared/types.js';
import { resetDatabaseWithSeeds } from '../db/connection.js';
import { expireOverdueReservations } from '../workers/ttl-worker.js';
import { sendDoorUnlockCommand, broadcastCatalogStockUpdated } from '../ws/broker.js';

/**
 * Rotas Administrativas, Estoque, Higienização/Recarga e Master Unlock (RF14, RF15, RF16, RF17)
 * Responsável Exclusivo: Dev 3 (Backend B)
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  void sendDoorUnlockCommand;
  void broadcastCatalogStockUpdated;

  /**
   * GET /api/admin/dashboard — Visão Geral de Portas, Estoque e Logs de Auditoria
   *
   * // TODO: [BE2-05] (Dev 3 - Backend B):
   * - Retornar todos os armários, todas as portas com seus itens/ocupantes e os últimos 30 registros de `door_events`.
   */
  app.get<{
    Reply: AdminDashboardSummaryResponse;
  }>('/api/admin/dashboard', async (_request, reply) => {
    // TODO: [BE2-05] Implementar query completa do painel administrativo.
    return reply.status(200).send({
      lockers: [],
      doors: [],
      recentEvents: [],
    });
  });

  /**
   * POST /api/admin/doors/:doorId/master-unlock — Abertura Master de Contingência (RF15)
   *
   * // TODO: [BE2-05] (Dev 3 - Backend B):
   * 1. Atualizar `doors.lock_state = 'UNLOCKED'` no SQLite.
   * 2. Inserir log `MASTER_UNLOCK` na tabela `door_events`.
   * 3. Disparar `sendDoorUnlockCommand` com `actionContext: 'MASTER_OVERRIDE'` e `playSoundEffect: true`.
   */
  app.post<{
    Params: { doorId: string };
    Reply: AdminMasterUnlockResponse | ApiErrorResponse;
  }>('/api/admin/doors/:doorId/master-unlock', async (_request, reply) => {
    // TODO: [BE2-05] Implementar comando Master Unlock para abrir porta no projetor.
    return reply.status(501).send({
      error: 'NOT_IMPLEMENTED',
      message: 'TODO [BE2-05]: Implementar POST /api/admin/doors/:doorId/master-unlock',
    });
  });

  /**
   * PATCH /api/admin/doors/:doorId/status — Liberação Pós-Higienização/Recarga ou Manutenção (RF14, RF15, RF17)
   *
   * // TODO: [BE2-05] (Dev 3 - Backend B):
   * - Atualizar `doors.status` (ex: de `IN_PREPARATION` ou `MAINTENANCE` para `AVAILABLE`).
   * - Disparar `broadcastCatalogStockUpdated` para liberar a porta no catálogo dos alunos em tempo real.
   */
  app.patch<{
    Params: { doorId: string };
    Body: AdminUpdateDoorStatusRequest;
    Reply: AdminUpdateDoorStatusResponse | ApiErrorResponse;
  }>('/api/admin/doors/:doorId/status', async (_request, reply) => {
    // TODO: [BE2-05] Implementar atualização administrativa de status da porta.
    return reply.status(501).send({
      error: 'NOT_IMPLEMENTED',
      message: 'TODO [BE2-05]: Implementar PATCH /api/admin/doors/:doorId/status',
    });
  });

  /**
   * POST /api/admin/maintenance/expire-ttl — Acionamento Manual de Expiração de Reserva (RF16)
   */
  app.post('/api/admin/maintenance/expire-ttl', async (_request, reply) => {
    const expiredCount = expireOverdueReservations();
    return reply.status(200).send({
      success: true,
      expiredCount,
      message: `${expiredCount} reserva(s) vencida(s) expirada(s) com sucesso.`,
    });
  });

  /**
   * POST /api/admin/demo/reset — Reset Rápido do Banco para Apresentação Ao Vivo
   */
  app.post('/api/admin/demo/reset', async (_request, reply) => {
    resetDatabaseWithSeeds();
    return reply.status(200).send({
      success: true,
      message: 'Banco de dados restaurado para o estado inicial da demonstração.',
    });
  });
}
