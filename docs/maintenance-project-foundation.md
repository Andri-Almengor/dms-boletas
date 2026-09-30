# Mantenimientos tipo Proyecto — base arquitectónica

Esta etapa prepara el modelo sin alterar el flujo histórico de los mantenimientos normales.

## Compatibilidad

- Todo mantenimiento histórico o nuevo sin tipo explícito se interpreta como `MANTENIMIENTO`.
- `PROYECTO` queda disponible en el modelo para la siguiente etapa de interfaz operativa.
- Las preguntas históricas siguen siendo `SI_NO` y aplican a `MANTENIMIENTO`.
- No se crean permisos nuevos. La configuración reutiliza `CATALOGOS_GESTIONAR`.
- Los tipos relacionados reutilizan `TiposDispositivo`; marcas, modelos y relaciones continúan usando los catálogos existentes.

## Preguntas configurables

`TipoDispositivoPreguntas` ahora puede definir:

- `AplicaModo`: `MANTENIMIENTO`, `PROYECTO` o `AMBOS`.
- `TipoRespuesta`: `SI_NO`, `TEXTO`, `NUMERO`, `CANTIDAD`, `MAC` o `RELACION_DISPOSITIVO`.
- `TipoDispositivoRelacionadoID`: tipo existente que se ligará al dispositivo principal.
- `ConfiguracionJSON`: metadatos extensibles; inicialmente guarda los campos que debe solicitar una relación (cantidad, fabricante, modelo, serie y MAC).

Las relaciones de dispositivo se validan en backend contra el catálogo existente. No se permite configurar una relación solamente para el modo Mantenimiento para evitar alterar el checklist tradicional.

## Próxima etapa

Activar `PROYECTO` en el formulario y construir el editor de dispositivos relacionados reutilizando `MaintenanceDeviceCatalogFields`, los catálogos dependientes tipo → fabricante → modelo y el ciclo de persistencia/offline actual.
