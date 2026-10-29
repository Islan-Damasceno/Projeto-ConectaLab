import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Segredo HS256 do RNF05: sem CONECTALAB_JWT_SECRET, cada instalação gera o próprio segredo
 * e o guarda no arquivo SQLite (fora do repositório público). Cada processo filho simula
 * um reinício do servidor apontando para o mesmo banco ou para outro.
 */
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'jwt-cli.ts');
const TMP_DIR = path.join(os.tmpdir(), 'conectalab-dev2-tests');
const createdDbs: string[] = [];

function newTempDbPath(): string {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const dbPath = path.join(TMP_DIR, `jwt-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`);
  createdDbs.push(dbPath);
  return dbPath;
}

function runServerProcess(dbPath: string, args: string[], jwtSecret?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, CONECTALAB_DB_PATH: dbPath };
  delete env.CONECTALAB_JWT_SECRET;
  if (jwtSecret !== undefined) env.CONECTALAB_JWT_SECRET = jwtSecret;
  return spawnSync(process.execPath, ['--import', 'tsx', FIXTURE, ...args], {
    env,
    encoding: 'utf8',
  });
}

function signIn(dbPath: string, jwtSecret?: string): string {
  const result = runServerProcess(dbPath, ['sign'], jwtSecret);
  assert.equal(result.status, 0, `processo de assinatura falhou: ${result.stderr}`);
  return result.stdout;
}

function verifyIn(dbPath: string, token: string): string {
  const result = runServerProcess(dbPath, ['verify', token]);
  assert.equal(result.status, 0, `processo de verificação falhou: ${result.stderr}`);
  return result.stdout;
}

describe('RNF05 — Segredo JWT local por instalação (sem segredo fixo no código)', () => {
  after(() => {
    for (const dbPath of createdDbs) {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.unlinkSync(`${dbPath}${suffix}`);
        } catch {
          // arquivo inexistente ou ainda bloqueado no Windows
        }
      }
    }
  });

  it('mantém o mesmo segredo entre reinícios do servidor e depois do reset da demo', () => {
    const dbPath = newTempDbPath();
    const token = signIn(dbPath);

    assert.equal(verifyIn(dbPath, token), 'VALID', 'token deveria valer após reiniciar o servidor');

    const reset = runServerProcess(dbPath, ['reset']);
    assert.equal(reset.status, 0, `reset falhou: ${reset.stderr}`);
    assert.equal(verifyIn(dbPath, token), 'VALID', 'reset da demo não pode derrubar as sessões');
  });

  it('gera um segredo diferente em cada instalação: token de um banco não vale em outro', () => {
    const tokenFromInstallA = signIn(newTempDbPath());
    assert.equal(verifyIn(newTempDbPath(), tokenFromInstallA), 'INVALID');
  });

  it('assina com CONECTALAB_JWT_SECRET quando a variável está definida', () => {
    const secret = 'segredo-da-apresentacao-com-mais-de-32-caracteres';
    const token = signIn(newTempDbPath(), secret);
    const [header, payload, signature] = token.split('.');
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    assert.equal(signature, expected);
  });

  it('recusa iniciar com CONECTALAB_JWT_SECRET curto demais', () => {
    const result = runServerProcess(newTempDbPath(), ['sign'], 'curto');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CONECTALAB_JWT_SECRET/);
  });
});
