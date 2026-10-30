// Operaciones de interfaz para preguntas dinámicas. Sin estado ni efectos:
// compartidas por el checklist y el administrador de preguntas.
export function toggleMaintenanceQuestionChoice(current, chosen) {
  return String(current ?? '') === String(chosen) ? '' : chosen;
}

export function moveMaintenanceQuestionIds(ids, sourceId, targetId) {
  const reordered = [...ids];
  const from = reordered.indexOf(sourceId);
  const to = reordered.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return reordered;
  reordered.splice(from, 1);
  reordered.splice(to, 0, sourceId);
  return reordered;
}
