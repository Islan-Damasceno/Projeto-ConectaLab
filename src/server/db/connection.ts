import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE_PATH = path.join(DATA_DIR, 'conectalab.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SEEDS_PATH = path.join(__dirname, 'seeds.sql');

// Garante que a pasta data/ exista antes de abrir o arquivo SQLite
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
 * Pode ser chamado via CLI (`npm run db:reset`) ou pela rota Admin (`POST /api/admin/demo/reset`).
 */
export function resetDatabaseWithSeeds(): void {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  const seedsSql = fs.readFileSync(SEEDS_PATH, 'utf-8');

  const runReset = db.transaction(() => {
    db.exec(schemaSql);
    db.exec(seedsSql);
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

// TODO: [BE1-01] Dev 2 pode adicionar helpers ou queries preparadas compartilhadas aqui se desejar.
