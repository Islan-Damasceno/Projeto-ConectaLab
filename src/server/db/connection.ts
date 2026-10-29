import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DoorEventType } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DEFAULT_DB_FILE_PATH = path.join(DATA_DIR, 'conectalab.db');

/**
 * Permite sobrescrever o caminho do banco via `CONECTALAB_DB_PATH` em suítes de testes
 * unitários e de regressão, garantindo isolamento total sem alterar `data/conectalab.db`.
 */
export const DB_FILE_PATH = process.env.CONECTALAB_DB_PATH
  ? process.env.CONECTALAB_DB_PATH === ':memory:'
    ? ':memory:'
    : path.resolve(process.env.CONECTALAB_DB_PATH)
  : DEFAULT_DB_FILE_PATH;

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SEEDS_PATH = path.join(__dirname, 'seeds.sql');

// Garante que o diretório pai exista antes de abrir o arquivo SQLite
if (DB_FILE_PATH !== ':memory:') {
  const targetDir = path.dirname(DB_FILE_PATH);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

/**
 * Instância singleton do SQLite em modo WAL (ADR-002 / RNF04)
 * Pronta para uso imediato pelo Dev 2 (Backend A) e Dev 3 (Backend B).
 */
export const db = new Database(DB_FILE_PATH);

// Configurações obrigatórias de concorrência e integridade referencial
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * Inicializa as tabelas do banco e aplica os seeds caso o banco esteja vazio.
 */
export function initDatabase(): void {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schemaSql);

  const countRow = db.prepare('SELECT COUNT(*) as count FROM lockers').get() as { count: number };
  if (countRow.count === 0) {
    const seedsSql = fs.readFileSync(SEEDS_PATH, 'utf-8');
    db.exec(seedsSql);
    console.log('[DB] Banco SQLite inicializado em modo WAL com seeds padrão.');
  }
}

/**
 * Reseta completamente os dados para o estado inicial da demonstração.
 * Pode ser chamado via CLI (`npm run db:reset`), pela rota Admin (`POST /api/admin/demo/reset`)
 * ou no `beforeEach` das suítes de testes.
 */
export function resetDatabaseWithSeeds(): void {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  const seedsSql = fs.readFileSync(SEEDS_PATH, 'utf-8');

  // Garante que o schema exista antes da transação de limpeza e seed
  db.exec(schemaSql);

  const runReset = db.transaction(() => {
    db.exec(seedsSql);
    const hasSeq = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")
      .get();
    if (hasSeq) {
      db.prepare("DELETE FROM sqlite_sequence WHERE name = 'door_events'").run();
    }
  });

  runReset.immediate();
  console.log('[DB] Estado do banco resetado com sucesso para os seeds de demonstração.');
}

/**
 * Helper para executar uma função dentro de uma transação IMMEDIATE (RN02 - evita dupla locação).
 */
export function runImmediateTransaction<T>(fn: () => T): T {
  const tx = db.transaction(fn);
  return tx.immediate();
}

/**
 * Locação em andamento do usuário: reserva ainda no prazo de pagamento, paga aguardando retirada,
 * em uso ou em devolução. Cada aluno só pode ter uma (POST /api/rentals); devolve a mais recente.
 */
export function findActiveRentalId(userId: string, nowIso: string): string | null {
  const row = db
    .prepare(
      `SELECT id
       FROM rentals
       WHERE user_id = ?
         AND status IN ('AWAITING_PAYMENT', 'PAID_READY_FOR_PICKUP', 'IN_USE', 'AWAITING_RETURN_CLOSE')
         AND (status != 'AWAITING_PAYMENT' OR reservation_expires_at > ?)
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(userId, nowIso) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Devolve um segredo aleatório desta instalação, criado na primeira chamada e guardado no próprio
 * arquivo SQLite (que fica fora do Git). Sobrevive a reinícios e ao reset da demo, porque
 * `seeds.sql` não limpa a tabela `app_secrets`.
 */
export function getOrCreateLocalSecret(key: string): string {
  db.exec(
    `CREATE TABLE IF NOT EXISTS app_secrets (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     )`,
  );
  db.prepare('INSERT OR IGNORE INTO app_secrets (key, value) VALUES (?, ?)').run(
    key,
    crypto.randomBytes(32).toString('base64url'),
  );
  const row = db.prepare('SELECT value FROM app_secrets WHERE key = ?').get(key) as {
    value: string;
  };
  return row.value;
}

export interface InsertDoorEventParams {
  doorId: string;
  rentalId?: string | null;
  userId?: string | null;
  eventType: DoorEventType;
  details?: Record<string, unknown> | null;
  createdAt?: string;
}

/**
 * Registra um evento auditável na tabela `door_events` (RF14).
 */
export function insertDoorEvent(params: InsertDoorEventParams): number {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const detailsJson = params.details ? JSON.stringify(params.details) : null;

  const result = db
    .prepare(
      `INSERT INTO door_events (door_id, rental_id, user_id, event_type, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.doorId,
      params.rentalId ?? null,
      params.userId ?? null,
      params.eventType,
      detailsJson,
      createdAt,
    );

  return Number(result.lastInsertRowid);
}
