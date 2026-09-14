// Valores conservadores para la instancia de Render. Se aplican solo cuando el
// entorno no trae un valor explícito, por lo que siguen siendo configurables.
process.env.SHEETS_GLOBAL_MAX_CONCURRENT_READS ||= '1';
process.env.MAINTENANCE_FINALIZATION_WORKER_DELAY_MS ||= '2000';
process.env.MAINTENANCE_FINALIZATION_DRIVE_ITEMS_PER_STEP ||= '1';
process.env.MAINTENANCE_FINALIZATION_DRIVE_MAX_IMAGES_PER_STEP ||= '15';

// Carga primero la protección de memoria de Google Sheets. El repositorio puede
// solicitar muchas hojas A:ZZ en el mismo tick; dividir esas lecturas antes de
// cargar la finalización evita respuestas gigantes retenidas en ArrayBuffers.
await import('./sheets-memory-guard.service.js');

// Carga toda la cadena de parches de finalización antes de que action-router.js
// construya su Map de rutas. Esto evita que maintenance.finalize capture una
// referencia histórica al finalizador monolítico durante el arranque de ESM.
//
// maintenance-finalization-resume.patch.js termina cargando, en orden:
// - archive-only para boletas de mantenimiento
// - optimización de finalización
// - worker escalonado persistente
// - descubrimiento/reanudación del job
//
// Al usar este archivo con `node --import`, todo lo anterior queda instalado
// antes de importar src/server.js y, por consecuencia, antes de registrar las
// rutas en action-router.js.
await import('./maintenance-finalization-resume.patch.js');
