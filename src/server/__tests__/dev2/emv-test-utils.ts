/**
 * Parser TLV de BR Code (EMV) usado só pelos testes, para validar o PIX copia-e-cola
 * sem reaproveitar o código de produção que o gera.
 */
export interface EmvField {
  id: string;
  value: string;
}

export function parseEmvTlv(payload: string): EmvField[] {
  const fields: EmvField[] = [];
  let cursor = 0;
  while (cursor < payload.length) {
    const id = payload.slice(cursor, cursor + 2);
    const lengthText = payload.slice(cursor + 2, cursor + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lengthText)) {
      throw new Error(`TLV malformado na posição ${cursor}: "${payload.slice(cursor, cursor + 8)}"`);
    }
    const length = Number(lengthText);
    const value = payload.slice(cursor + 4, cursor + 4 + length);
    if (value.length !== length) {
      throw new Error(`Campo ${id} declara ${length} caracteres mas só tem ${value.length}`);
    }
    fields.push({ id, value });
    cursor += 4 + length;
  }
  return fields;
}

export function emvValue(fields: EmvField[], id: string): string | undefined {
  return fields.find((field) => field.id === id)?.value;
}
