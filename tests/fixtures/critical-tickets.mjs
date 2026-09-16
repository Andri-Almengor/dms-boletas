export function criticalTickets(count) {
  const Boletas = Array.from({ length: count }, (_, i) => ({
    __rowNumber: i + 2, BoletaUID: `b${i}`, BoletaID: i % 9 ? String(i % 300) : 'invalid',
    Fecha: i % 17 ? `2026-09-${String(i % 28 + 1).padStart(2, '0')}` : '',
    FechaCreacion: i % 5 ? '2026-09-01T10:00:00Z' : 'invalid',
    Estado: ['PENDIENTE', 'FINALIZADA', 'finalizado', ' pendiente ', 'ANULADA', 'OTRO'][i % 6],
    Activo: i % 13 ? true : 'false', ClienteID: `c${i % 3}`, CategoriaID: `cat${i % 2}`,
    TipoDispositivoID: 'd1', FabricanteID: 'f1', ModeloID: 'm1', Titulo: `Cámara ${i % 7}`,
    GrupoVisitaID: `b${i}`, BoletaPrincipalUID: `b${i}`, NumeroVisita: 1, EsVisitaPrincipal: true,
  }));
  const BoletaAsignados = Boletas.flatMap((row, i) => [
    { BoletaUID: row.BoletaUID, UsuarioID: `u${i % 3}`, Activo: true },
    { BoletaUID: row.BoletaUID, UsuarioID: 'u0', Activo: 'false' },
  ]);
  return { Boletas, BoletaAsignados };
}
