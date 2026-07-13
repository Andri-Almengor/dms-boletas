# Backend — Base de conocimientos

El módulo compatible con el backend actual está incluido en:

```text
apps-script/KnowledgeBase.gs
```

## Instalación en Google Apps Script

1. Abra el proyecto de Apps Script que publica la API de DMS Boletas.
2. Cree un archivo llamado `KnowledgeBase.gs`.
3. Copie allí el contenido de `apps-script/KnowledgeBase.gs`.
4. Copie las rutas indicadas en el encabezado de ese archivo dentro del objeto `ROUTES` de `Code.gs`.
5. Ejecute manualmente `setupKnowledgeBaseModule()` una sola vez y autorice Sheets/Drive.
6. Confirme que se crearon las hojas `KnowledgeCategories`, `KnowledgeArticles` y `KnowledgeAttachments`.
7. Confirme que se creó la carpeta de Drive “Base de conocimientos”.
8. En Apps Script, seleccione **Implementar > Administrar implementaciones > Editar > Nueva versión** y vuelva a publicar el Web App.

`setupKnowledgeBaseModule()` no limpia ni reemplaza las hojas existentes. Solo crea las tablas faltantes, agrega encabezados faltantes y registra las categorías iniciales Lenel, Milestone, Axis, Barco y General cuando la tabla está vacía.

## Tablas

### KnowledgeCategories

`CategoriaConocimientoID`, `Nombre`, `Descripcion`, `Activo`, `CreadoPor`, `FechaCreacion`, `ActualizadoPor`, `FechaActualizacion`

### KnowledgeArticles

`TutorialID`, `Titulo`, `CategoriaConocimientoID`, `ProblemaResuelto`, `ContenidoHTML`, `VideosJSON`, `Estado`, `Activo`, `AutorUsuarioID`, `CreadoPor`, `FechaCreacion`, `ActualizadoPor`, `FechaActualizacion`

Los estados admitidos son `BORRADOR` y `PUBLICADO`.

### KnowledgeAttachments

`AdjuntoID`, `TutorialID`, `Nombre`, `MimeType`, `Size`, `DriveFileID`, `DriveURL`, `Activo`, `CreadoPor`, `FechaCreacion`

## Rutas implementadas

- `knowledge.list`: búsqueda, categoría, autor, borradores, paginación y orden.
- `knowledge.get`: obtiene el tutorial con categoría, autor, videos y adjuntos.
- `knowledge.create`: crea un borrador o tutorial publicado.
- `knowledge.update`: permite al autor editar su contenido; el administrador puede editar cualquiera.
- `knowledge.delete`: borrado lógico administrativo.
- `knowledge.attachments.upload`: guarda archivos en Drive, hasta 20 MB por archivo.
- `knowledge.attachments.delete`: mueve el archivo a la papelera y desactiva su registro.
- `knowledge.media.get`: devuelve el enlace autorizado del documento.
- `knowledge.categories.list`: consulta de categorías para técnicos.
- `knowledge.categories.create`: creación administrativa.
- `knowledge.categories.update`: edición y activación administrativa.

## Permisos

Para que funcione inmediatamente con los roles ya existentes, el módulo usa:

- `BOLETAS_VER`: consultar tutoriales, categorías y adjuntos.
- `BOLETAS_CREAR`: crear tutoriales, editar los propios y gestionar sus adjuntos.
- `USUARIOS_GESTIONAR`: administrar categorías, moderar o eliminar cualquier tutorial.

La función `assertCanEditKnowledge_` valida además que un técnico solo pueda modificar tutoriales cuyo `AutorUsuarioID` sea el suyo.

Como ampliación futura pueden agregarse permisos específicos:

- `CONOCIMIENTO_VER`
- `CONOCIMIENTO_CREAR`
- `CONOCIMIENTO_EDITAR_PROPIO`
- `CONOCIMIENTO_GESTIONAR`
- `CONOCIMIENTO_CATEGORIAS_GESTIONAR`

La interfaz ya reconoce varios de esos códigos, manteniendo compatibilidad temporal con los permisos actuales. La validación definitiva siempre se ejecuta en Apps Script.
