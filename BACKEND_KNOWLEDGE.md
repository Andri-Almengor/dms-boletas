# Contrato de backend — Base de conocimientos

El frontend React utiliza estas rutas de Google Apps Script. Todas deben validar `sessionToken` y permisos en el servidor.

## Tablas sugeridas

### KnowledgeCategories
`CategoriaConocimientoID`, `Nombre`, `Descripcion`, `Activo`, `CreatedAt`, `UpdatedAt`, `CreatedBy`

### KnowledgeArticles
`TutorialID`, `Titulo`, `CategoriaConocimientoID`, `ProblemaResuelto`, `ContenidoHTML`, `VideosJSON`, `Estado` (`BORRADOR`/`PUBLICADO`), `AutorUsuarioID`, `CreatedAt`, `UpdatedAt`

### KnowledgeAttachments
`AdjuntoID`, `TutorialID`, `Nombre`, `MimeType`, `Size`, `DriveFileID`, `DriveURL`, `CreatedAt`, `CreatedBy`

## Rutas

- `knowledge.list`: filtros `search`, `categoriaId`, `autorUsuarioId`, `includeDrafts`, paginación y orden.
- `knowledge.get`: `tutorialId`.
- `knowledge.create`: título, categoría, problema, HTML, videos, estado y autor.
- `knowledge.update`: `tutorialId` y los mismos campos editables.
- `knowledge.delete`: borrado lógico, solo administrador o permiso de gestión.
- `knowledge.attachments.upload`: `tutorialId`, `nombre`, `mimeType`, `size`, `dataUrl`. Debe guardar el archivo en Drive y registrar el adjunto.
- `knowledge.attachments.delete`: `tutorialId`, `adjuntoId`.
- `knowledge.media.get`: `tutorialId`, `adjuntoId`; devuelve `url` autorizada o contenido descargable.
- `knowledge.categories.list`: permite consulta a técnicos.
- `knowledge.categories.create`: solo administrador.
- `knowledge.categories.update`: solo administrador.

El backend puede usar también los alias en español definidos en `src/services/moduleApi.js`.

## Permisos sugeridos

- `CONOCIMIENTO_VER`
- `CONOCIMIENTO_CREAR`
- `CONOCIMIENTO_EDITAR_PROPIO`
- `CONOCIMIENTO_GESTIONAR`
- `CONOCIMIENTO_CATEGORIAS_GESTIONAR`

Mientras se incorporan estos permisos, el frontend considera `BOLETAS_CREAR` como autorización para que un técnico cree tutoriales y `USUARIOS_GESTIONAR` como autorización administrativa. El backend debe aplicar su propia validación y nunca confiar únicamente en la interfaz.
