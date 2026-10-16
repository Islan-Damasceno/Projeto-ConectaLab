import { resetDatabaseWithSeeds } from './connection.js';

try {
  resetDatabaseWithSeeds();
  console.log('✅ [ConectaLab] Reset do banco SQLite (data/conectalab.db) concluído!');
  process.exit(0);
} catch (error) {
  console.error('❌ [ConectaLab] Erro ao resetar banco SQLite:', error);
  process.exit(1);
}
