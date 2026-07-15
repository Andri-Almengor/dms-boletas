import { readTable } from '../infra/sheets.repository.js';

let sequenceQueue = Promise.resolve();
let lastReservedNumber = 0;

export function reserveNextTicketNumber() {
  const task = sequenceQueue.then(async () => {
    const rows = await readTable('Boletas', { force: true });
    const currentMaximum = Math.max(
      0,
      ...rows.map((row) => Number(row.BoletaID || 0)).filter(Number.isFinite),
    );
    lastReservedNumber = Math.max(lastReservedNumber, currentMaximum) + 1;
    return lastReservedNumber;
  });

  sequenceQueue = task.then(() => undefined, () => undefined);
  return task;
}
