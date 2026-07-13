export const TABLES = Object.freeze({
  Configuracion: { id: 'Clave' },
  Usuarios: { id: 'UsuarioID' }, Roles: { id: 'RolID' }, Permisos: { id: 'PermisoID' },
  RolPermisos: { id: 'RolPermisoID' }, UsuarioPermisos: { id: 'UsuarioPermisoID' }, Sesiones: { id: 'SesionID' },
  Clientes: { id: 'ClienteID' }, ClienteUbicaciones: { id: 'UbicacionID' }, ClienteUbicacionesEquipo: { id: 'UbicacionEquipoID' }, ClienteContactos: { id: 'ContactoID' },
  Categorias: { id: 'CategoriaID' }, TiposDispositivo: { id: 'TipoDispositivoID' }, Fabricantes: { id: 'FabricanteID' }, Modelos: { id: 'ModeloID' }, TiposFalla: { id: 'TipoFallaID' }, TipoDispositivoFabricantes: { id: 'RelacionID' },
  Boletas: { id: 'BoletaUID' }, BoletaAsignados: { id: 'BoletaAsignadoID' }, EvidenciasBoleta: { id: 'EvidenciaID' }, RespuestasBoleta: { id: 'RespuestaID' }, Consecutivos: { id: 'ConsecutivoID' },
  Mantenimiento: { id: 'MantenimientoID' }, Evidencia_Mantenimientos: { id: 'EvidenciaMantenimientoID' }, 'Mantenimiento imagenes': { id: 'FotoDispositivoID' },
  KnowledgeCategories: { id: 'CategoriaConocimientoID' }, KnowledgeArticles: { id: 'TutorialID' }, KnowledgeAttachments: { id: 'AdjuntoID' },
  Notificaciones: { id: 'NotificacionID' }, Auditoria: { id: 'AuditoriaID' }, Archivos: { id: 'ArchivoIDInterno' },
});

export const DATE_FIELDS = new Set([
  'Fecha','FechaFinalizacion','FechaCreacion','FechaActualizacion','FechaInicio','FechaExpiracion','FechaRevocacion','FechaEnvio','FinalizadaEn','UltimoAcceso','BloqueadoHasta'
]);
export const TIME_FIELDS = new Set(['HoraInicio','HoraFinal']);
