import crypto from 'node:crypto';

/**
 * PIX Mock (RF05): BR Code EMV "copia e cola" e QR ilustrativo do checkout.
 *
 * Segue o Manual de Padrões para Iniciação do Pix (BCB): cada campo é ID (2 dígitos) + tamanho
 * (2 dígitos) + valor, e o campo 63 fecha com o CRC-16/CCITT-FALSE de todo o conteúdo anterior,
 * incluindo o próprio "6304". A chave é fictícia, então nenhum banco consegue liquidar o pagamento.
 */

const MAX_EMV_FIELD_LENGTH = 99;

/** CRC-16/CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF) em 4 dígitos hexadecimais maiúsculos. */
export function crc16Ccitt(text: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function emvField(id: string, value: string): string {
  if (value.length > MAX_EMV_FIELD_LENGTH) {
    throw new RangeError(`Campo EMV ${id} excede ${MAX_EMV_FIELD_LENGTH} caracteres.`);
  }
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function formatAmount(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError('O valor do PIX precisa ser um inteiro positivo de centavos.');
  }
  return `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, '0')}`;
}

export function buildPixCopyPastePayload(rentalId: string, amountCents: number): string {
  const merchantAccount =
    emvField('00', 'BR.GOV.BCB.PIX') + emvField('01', `conectalab-pix-mock-${rentalId}`);

  const withoutCrc =
    emvField('00', '01') +
    emvField('26', merchantAccount) +
    emvField('52', '0000') +
    emvField('53', '986') +
    emvField('54', formatAmount(amountCents)) +
    emvField('58', 'BR') +
    emvField('59', 'CONECTALAB') +
    emvField('60', 'SAOPAULO') +
    emvField('62', emvField('05', '***')) +
    '6304';

  return withoutCrc + crc16Ccitt(withoutCrc);
}

/**
 * Padrão 8x8 derivado do id da reserva, só para ilustrar o checkout. Não é um QR Code
 * escaneável: o app, se quiser um QR real, deve gerá-lo a partir do copia-e-cola.
 */
export function buildMockPixQrSvg(rentalId: string): string {
  const hash = crypto.createHash('sha256').update(rentalId).digest();
  const rects: string[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const bit = (hash[row] >> col) & 1;
      if (bit === 1) {
        rects.push(
          `<rect x="${16 + col * 11}" y="${16 + row * 11}" width="9" height="9" fill="#0f172a"/>`,
        );
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="8" fill="#ffffff"/>${rects.join('')}</svg>`;
}
