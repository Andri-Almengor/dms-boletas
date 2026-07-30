# Etapa 0 — Baseline y pruebas de caracterización

## Objetivo

Esta etapa crea una red de seguridad antes de reestructurar la aplicación. No cambia la interfaz, los flujos, las consultas ni la lógica operativa. Su propósito es detectar regresiones cuando comiencen las extracciones de componentes, hooks, servicios y repositorios.

## Punto de partida

- Rama base: `main`
- Commit base: `d2a238ddfdea29df364e2fd1bd9cc060e8afe64d`
- Rama de trabajo: `refactor/stage-0-characterization-baseline`
- Alcance: pruebas, medición reproducible, CI y documentación.

## Contratos protegidos inicialmente

Las pruebas de caracterización fijan el comportamiento actual de:

1. Estados manuales y automáticos de checklist de mantenimientos.
2. Campos obligatorios y preguntas históricas de dispositivos.
3. Fechas civiles de Costa Rica y cambio de día UTC-6.
4. Hash PBKDF2, compatibilidad de hashes heredados y escape HTML.
5. Modo offline desactivado por defecto.
6. Carga diferida, recuperación global y runtime offline opcional.
7. Permisos visibles de rutas críticas.
8. Permisos backend de cierre, evidencias y rutas públicas.
9. Caché y deduplicación actuales del cliente HTTP.
10. Persistencia de borradores en IndexedDB y respaldo local.
11. Compresión, Helmet y límite actual de payload del backend.

Estos contratos describen el sistema vigente. No significan que cada decisión actual sea definitiva; cualquier cambio intencional debe modificar primero la especificación y después las pruebas.

## Comandos

```bash
npm ci
npm --prefix backend ci
npm run test:characterization
npm run check:backend
npm run build
npm run baseline
```

Para ejecutar toda la verificación:

```bash
npm run verify:stage0
```

## Baseline reproducible

`scripts/collect-baseline.mjs` genera `.artifacts/refactor-baseline.json` con:

- Cantidad de archivos, líneas y bytes del frontend y backend.
- Veinte archivos más grandes por líneas.
- Archivos que superan 500 líneas.
- Conteos de hotspots como `useEffect`, `useState`, `requestAvailable`, `apiRequest`, `localStorage`, `FileReader`, `window.confirm` y componentes `Field` o `Select` locales.
- Tamaño normal y gzip de cada paquete JavaScript y CSS generado en `dist/assets`.
- Commit y versión de Node usados en la medición.

El archivo generado se ignora localmente y se publica como artefacto de GitHub Actions por 30 días.

## Integración continua

El workflow `.github/workflows/stage-0-characterization.yml` se ejecuta en:

- Pull Requests.
- Cambios en `main`.
- Ramas `refactor/**`.

La validación instala frontend y backend, ejecuta las pruebas de caracterización, verifica la sintaxis del backend, compila la aplicación y genera el baseline.

## Reglas para las siguientes etapas

- No cambiar comportamiento y estructura en el mismo commit sin una prueba que lo cubra.
- No eliminar aliases, columnas históricas, permisos ni claves de borradores sin una migración explícita.
- Mantener el diseño visual actual durante las extracciones.
- Dividir las migraciones por dominio y conservar PR pequeños y reversibles.
- Comparar cada PR con el baseline anterior.
- Marcar como regresión cualquier aumento no justificado de solicitudes, tamaño inicial o memoria.

## Siguiente etapa

La Etapa 1 extraerá utilidades neutrales y patrones repetidos de listados sin modificar los flujos funcionales. Antes de hacerlo deben estar en verde:

- `npm run test:characterization`
- `npm run check:backend`
- `npm run build`
- `npm run baseline`
