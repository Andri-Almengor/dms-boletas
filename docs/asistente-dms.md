# Asistente DMS

El Asistente DMS es una función interna de solo lectura para técnicos y administradores.

## Fuentes disponibles

- Clientes.
- Boletas.
- Mantenimientos y dispositivos.
- Encuestas, únicamente para administradores.
- Artículos publicados de la base de conocimientos.

## Consultas de ejemplo

- `¿Qué pasó esta semana en RN?`
- `¿Cuál fue la última boleta de Asamblea?`
- `¿Qué se hizo en el último mantenimiento de Confluent?`
- `Dame las cámaras malas del último mantenimiento de BCR.`
- `¿Cuántas cámaras esperaban y cuántas registraron en AstraZeneca?`
- `¿Cuál es el promedio de encuestas del Banco Central?`
- `¿Cómo se instala MorphoManager?`

## Resolución de clientes

El backend acepta nombres completos, coincidencias parciales y abreviaciones. Incluye inicialmente:

- `RN` y `Registro` → Junta Administrativa del Registro Nacional.
- `Asamblea` → Asamblea Legislativa de Costa Rica.
- `BCR` → Banco de Costa Rica.
- `BCCR` → Banco Central de Costa Rica.
- `ICE`, `INS`, `AyA` y `CCSS`.

Cuando existen varias coincidencias, el asistente devuelve opciones y no ejecuta la consulta hasta que el usuario seleccione una.

Se pueden agregar alias sin modificar código mediante una fila en `Configuracion`:

- `Clave`: `ASISTENTE_CLIENTE_ALIASES_JSON`
- `Valor`: objeto JSON donde la clave es el alias y el valor es el nombre oficial o una lista de nombres posibles.

Ejemplo:

```json
{
  "Confluent": "Nitinol Devices and Components CR SRL (Confluent)",
  "AZ": "AstraZeneca"
}
```

## Contexto

La interfaz conserva localmente:

- Último cliente resuelto.
- Última boleta.
- Último mantenimiento.
- Última categoría consultada.
- Historial breve de conversación.

Al abrir el asistente desde una boleta, mantenimiento o tutorial, la ruta actual se envía como contexto.

## Seguridad

- El modelo no recibe tokens, contraseñas, webhooks ni credenciales de Google.
- Gemini no consulta Sheets directamente; el backend ejecuta consultas deterministas.
- Los cálculos y ordenamientos se realizan en Node.js.
- Las respuestas incluyen enlaces a las fuentes internas.
- Los artículos se tratan como contenido no confiable para evitar instrucciones incrustadas.
- Se limita la frecuencia a 12 consultas por minuto por usuario.
- Las consultas se registran en Auditoría sin guardar el texto completo de la pregunta.

## Funcionamiento con Gemini no disponible

Si Gemini no puede interpretar o redactar temporalmente, el backend usa reglas locales para las consultas principales y genera una respuesta determinista con los datos obtenidos.
