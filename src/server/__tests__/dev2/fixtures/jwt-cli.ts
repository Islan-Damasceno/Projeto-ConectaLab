/**
 * Processo auxiliar dos testes de segredo JWT (unit.jwt-secret.test.ts).
 * Cada execução equivale a um reinício do servidor usando o banco de CONECTALAB_DB_PATH.
 *
 *   sign             imprime um token do Lucas (usr-student-01)
 *   verify <token>   imprime VALID ou INVALID
 *   reset            aplica o reset da demo (seeds) no banco
 */
import { resetDatabaseWithSeeds } from '../../../db/connection.js';
import { signAuthToken, verifyAuthToken } from '../../../db/auth-helper.js';

const [mode, token] = process.argv.slice(2);

if (mode === 'sign') {
  process.stdout.write(
    signAuthToken({
      id: 'usr-student-01',
      name: 'Lucas Andrade',
      ra: '20261045',
      email: 'lucas.andrade@faculdade.edu.br',
      role: 'STUDENT',
    }),
  );
} else if (mode === 'verify') {
  process.stdout.write(verifyAuthToken(token ?? '') ? 'VALID' : 'INVALID');
} else if (mode === 'reset') {
  resetDatabaseWithSeeds();
} else {
  process.stderr.write(`Modo desconhecido: ${String(mode)}`);
  process.exitCode = 2;
}
