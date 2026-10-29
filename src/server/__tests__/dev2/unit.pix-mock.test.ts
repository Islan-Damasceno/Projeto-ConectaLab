import './setup-test-db.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPixCopyPastePayload, crc16Ccitt } from '../../db/pix-mock.js';

/**
 * Valores esperados calculados fora do código de produção, com Python:
 *   binascii.crc_hqx(payload.encode(), 0xFFFF)  ->  CRC-16/CCITT-FALSE exigido pelo BR Code
 */
describe('BE1-04 — PIX Mock: BR Code EMV válido (RF05)', () => {
  it('crc16Ccitt reproduz o valor de verificação padrão do CRC-16/CCITT-FALSE', () => {
    assert.equal(crc16Ccitt('123456789'), '29B1');
  });

  it('crc16Ccitt reproduz o CRC do exemplo de BR Code do Manual de Padrões do Pix (BCB)', () => {
    assert.equal(
      crc16Ccitt(
        '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304',
      ),
      '1D3D',
    );
  });

  it('gera o BR Code completo com o tamanho certo em cada campo e CRC calculado', () => {
    assert.equal(
      buildPixCopyPastePayload('rnt-0123456789ab', 800),
      '00020126580014BR.GOV.BCB.PIX0136conectalab-pix-mock-rnt-0123456789ab52040000530398654048.005802BR5910CONECTALAB6008SAOPAULO62070503***6304115D',
    );
  });

  it('formata os centavos no campo 54 com ponto e duas casas decimais', () => {
    const cases: Array<[string, number, string]> = [
      [
        'rnt-0123456789ab',
        1,
        '00020126580014BR.GOV.BCB.PIX0136conectalab-pix-mock-rnt-0123456789ab52040000530398654040.015802BR5910CONECTALAB6008SAOPAULO62070503***6304F866',
      ],
      [
        'rnt-0123456789ab',
        99,
        '00020126580014BR.GOV.BCB.PIX0136conectalab-pix-mock-rnt-0123456789ab52040000530398654040.995802BR5910CONECTALAB6008SAOPAULO62070503***6304D968',
      ],
      [
        'rnt-0123456789ab',
        123456,
        '00020126580014BR.GOV.BCB.PIX0136conectalab-pix-mock-rnt-0123456789ab52040000530398654071234.565802BR5910CONECTALAB6008SAOPAULO62070503***6304DF90',
      ],
      [
        'rnt-ffffffffffff',
        36000,
        '00020126580014BR.GOV.BCB.PIX0136conectalab-pix-mock-rnt-ffffffffffff5204000053039865406360.005802BR5910CONECTALAB6008SAOPAULO62070503***63044AC7',
      ],
    ];

    for (const [rentalId, amountCents, expected] of cases) {
      assert.equal(buildPixCopyPastePayload(rentalId, amountCents), expected, `${amountCents} centavos`);
    }
  });

  it('recusa valor que não seja um inteiro positivo de centavos', () => {
    for (const invalid of [0, -100, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => buildPixCopyPastePayload('rnt-0123456789ab', invalid), RangeError);
    }
  });

  it('recusa identificador que estouraria o limite de 99 caracteres de um campo EMV', () => {
    assert.throws(() => buildPixCopyPastePayload(`rnt-${'f'.repeat(80)}`, 800), RangeError);
  });
});
