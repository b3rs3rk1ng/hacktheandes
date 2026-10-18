import { validateField } from './protocol.js';

/** Metadata from a completely assembled field; never reports partial packets. */
export function fieldReceptionSummary(record) {
  const field = validateField(record?.field);
  if (typeof record?.receivedAt !== 'string' || !Number.isFinite(Date.parse(record.receivedAt))) {
    throw new Error('Fecha de recepción inválida.');
  }
  const receivedAt = new Date(record.receivedAt).toISOString();
  const { id, context, variable, observedAt, cols, rows } = field;
  return {
    id, context, variable, observedAt, receivedAt, cols, rows,
    label: `Señal completa · ${id} · ${context} · ${cols} × ${rows} celdas. Variable ${variable}. Observación ${observedAt}. Recibido ${receivedAt}.`,
  };
}
