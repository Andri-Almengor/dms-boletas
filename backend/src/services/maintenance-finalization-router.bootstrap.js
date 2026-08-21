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
