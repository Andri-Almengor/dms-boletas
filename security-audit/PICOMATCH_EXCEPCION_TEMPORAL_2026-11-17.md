# Excepción temporal de seguridad — GHSA-fc5q-39xc-vjpf

**Fecha de evaluación:** 17 de noviembre de 2026  
**Vencimiento:** 17 de diciembre de 2026 (UTC)  
**Ámbito:** solo herramientas de desarrollo/compilación del frontend de DMS Boletas, no el backend, la base de datos, ni el JavaScript operativo desplegado.

## Hallazgo y evidencia

La auditoría completa de npm del PR #389 señala cuatro paquetes con gravedad alta por una **única vulnerabilidad transitiva** de `picomatch`, ReDoS en patrones extglob repetidos: `picomatch`, `fdir`, `tinyglobby` y `vite`. Los cuatro están identificados como `dev: true` en `package-lock.json`. Son cuatro entradas de árbol, no cuatro causas distintas.

Aviso: https://github.com/advisories/GHSA-fc5q-39xc-vjpf  
Archivo de respaldo: artefacto `final-validation` de GitHub Actions, `npm-audit-frontend-all.json`.

**No hay versión parcheada de `picomatch` declarada por el aviso a la fecha de evaluación.** `npm audit` propone retroceder Vite a 6.2.7; no se aplica porque reintroduce otros avisos de seguridad conocidos en Vite y cambia el sistema de compilación sin necesidad. Actualizar a Vite 8 por sí solo tampoco elimina todas las dependencias afectadas, y supone una migración mayor no justificada para un informe de métricas.

## Riesgo y controles

- Afecta patrones glob procesados por herramientas de compilación. El frontend desplegado es estático; el servidor operativo de DMS utiliza Node/Express y PostgreSQL, no Vite en tiempo de atención de solicitudes.
- **No se acepta usar el servidor de desarrollo Vite en redes públicas ni procesar patrones de búsqueda suministrados por usuarios no confiables.** El comando `npm run dev` existente se ejecuta únicamente en un entorno de desarrollo local. Evitar habilitar `--host 0.0.0.0` o exponer el proxy dev sin medidas adicionales.
- `npm run audit:security` permanece intacto y bloquea vulnerabilidades altas/críticas en dependencias de producción.
- El CI sigue ejecutando `npm audit --json` **completo**, guardando los informes, y valida una excepción acotada. Una vulnerabilidad crítica, otro aviso alto, otra dependencia, algún paquete de producción, un cambio de alcance, un informe inválido o el vencimiento de la excepción **hacen fallar CI**.
- Se añadieron pruebas específicas de rechazo para todos esos casos. La excepción no modifica roles, permisos, políticas de datos ni comportamiento de aplicación.

## Plan de retiro

Antes del 18 de diciembre de 2026:
1. Consultar el aviso y la publicación de una versión corregida de `picomatch` o una versión del bundler que ya no dependa del paquete vulnerable.
2. Actualizar de manera reproducible `package.json` y `package-lock.json` en PR separado, sin reinstalaciones automáticas en producción.
3. Ejecutar `npm ci`, compilación, caracterización, PostgreSQL y auditoría de dependencias de desarrollo/producción.
4. Retirar la excepción de `scripts/check-dependency-audit.mjs` y exigir nuevamente cero altas/críticas en todo el árbol.

**Estado:** excepción de riesgo técnica, temporal y visible; no se informa que existan cero vulnerabilidades en las dependencias de desarrollo.
