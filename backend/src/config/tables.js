export const TABLES = Object.freeze({
  Configuracion: { id: 'Clave' },
  Usuarios: { id: 'UsuarioID' }, Roles: { id: 'RolID' }, Permisos: { id: 'PermisoID' },
  RolPermisos: { id: 'RolPermisoID' }, UsuarioPermisos: { id: 'UsuarioPermisoID' }, Sesiones: { id: 'SesionID' },
  Clientes: { id: 'ClienteID' }, ClienteUbicaciones: { id: 'UbicacionID' }, ClienteUbicacionesEquipo: { id: 'UbicacionEquipoID' }, ClienteContactos: { id: 'ContactoID' },
  Categorias: { id: 'CategoriaID' }, TiposDispositivo: { id: 'TipoDispositivoID' }, Fabricantes: { id: 'FabricanteID' }, Modelos: { id: 'ModeloID' }, TiposFalla: { id: 'TipoFallaID' }, TipoDispositivoFabricantes: { id: 'RelacionID' },
  Boletas: { id: 'BoletaUID' }, BoletaAsignados: { id: 'BoletaAsignadoID' }, EvidenciasBoleta: { id: 'EvidenciaID' }, RespuestasBoleta: { id: 'RespuestaID' }, Consecutivos: { id: 'ConsecutivoID' }, FirmaSolicitudes: { id: 'SolicitudFirmaID' },
  Mantenimiento: { id: 'MantenimientoID' }, Evidencia_Mantenimientos: { id: 'EvidenciaMantenimientoID' }, 'Mantenimiento imagenes': { id: 'FotoDispositivoID' }, FirmaMantenimientoSolicitudes: { id: 'SolicitudFirmaMantenimientoID' },
  KnowledgeCategories: { id: 'CategoriaConocimientoID' }, KnowledgeArticles: { id: 'TutorialID' }, KnowledgeAttachments: { id: 'AdjuntoID' }, KnowledgeArticleCategories: { id: 'RelacionArticuloCategoriaID' },
  EncuestaPreguntas: { id: 'PreguntaID' }, Encuestas: { id: 'EncuestaID' }, EncuestaRespuestas: { id: 'RespuestaEncuestaID' },
  Notificaciones: { id: 'NotificacionID' }, Auditoria: { id: 'AuditoriaID' }, Archivos: { id: 'ArchivoIDInterno' },
});

export const DATE_FIELDS = new Set([
  'Fecha','FechaTrabajo','FechaFinalizacion','FechaCreacion','FechaActualizacion','FechaInicio','FechaExpiracion','FechaRevocacion','FechaEnvio','FechaRespuesta','FinalizadaEn','UltimoAcceso','BloqueadoHasta','FechaFirma','FirmaFecha'
]);
export const TIME_FIELDS = new Set(['HoraInicio','HoraFinal']);
