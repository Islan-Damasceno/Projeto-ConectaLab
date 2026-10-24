import Database from 'better-sqlite3';
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
