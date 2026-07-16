# Sincronización offline

La aplicación intenta sincronizar automáticamente cuando:

- regresa la conexión;
- se agrega una operación a la cola mientras hay internet;
- la aplicación vuelve al primer plano;
- la ventana recupera el foco;
- transcurren 30 segundos con cambios pendientes y la aplicación visible.

La pantalla **Más** incluye la acción **Forzar sincronización** para revisar la cola y reintentar manualmente.
