import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';

/**
 * IMPORTANTE: Deve ser importado na PRIMEIRA LINHA de cada arquivo `.test.ts`
 * antes de qualquer import de `connection.ts` ou rotas do servidor.
 *
 * Cria um arquivo SQLite temporário exclusivo por processo de teste em modo WAL,
 * garantindo zero interferência entre suítes paralelas e preservando `data/conectalab.db`.
 */
const TEST_TMP_DIR = path.join(os.tmpdir(), 'conectalab-dev2-tests');

if (!process.env.CONECTALAB_DB_PATH) {
  fs.mkdirSync(TEST_TMP_DIR, { recursive: true });
  process.env.CONECTALAB_DB_PATH = path.join(
    TEST_TMP_DIR,
    `test-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`,
  );
}

export const ACTIVE_TEST_DB_PATH = process.env.CONECTALAB_DB_PATH;

export function cleanupTestDb(dbInstance: Database.Database): void {
  try {
    if (dbInstance.open) {
      dbInstance.close();
    }
  } catch {
    // Ignora se já fechado
  }

  if (ACTIVE_TEST_DB_PATH && ACTIVE_TEST_DB_PATH !== ':memory:') {
    for (const suffix of ['', '-wal', '-shm']) {
      const target = `${ACTIVE_TEST_DB_PATH}${suffix}`;
      try {
        if (fs.existsSync(target)) {
          fs.unlinkSync(target);
        }
      } catch {
        // Ignora bloqueios transitórios de arquivo no Windows
      }
    }
  }
}
